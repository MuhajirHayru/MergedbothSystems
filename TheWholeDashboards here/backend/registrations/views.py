from datetime import date
import json
from pathlib import Path

from django.db import transaction
from django.db.models import Count, Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import generics, permissions, status, views, viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from notifications.services import notify
from users.models import AccountStatus, AuditLog, PlatformSettings, Role, User
from users.permissions import IsSuperAdmin

from .authentication import RegistrationCompletionAuthentication
from .models import (
    AgriculturalProductType,
    AdministratorScope,
    AdministrativeLocation,
    ProductAlias,
    ProductCatalogCategory,
    ProductSuggestion,
    ProductVariety,
    RegistrationFieldConfiguration,
    RegistrationDocument,
    RegistrationReview,
    RegistrationStatus,
    UserRegistration,
)
from .serializers import (
    AgriculturalProductTypeSerializer,
    LicenseVerificationSerializer,
    ManagedAdministrativeLocationSerializer,
    ManagedAgriculturalProductTypeSerializer,
    ProductAliasSerializer,
    ProductCatalogCategorySerializer,
    ProductSuggestionSerializer,
    SuperAdminProductSuggestionSerializer,
    ProductVarietySerializer,
    LocationSerializer,
    RegistrationDecisionSerializer,
    RegistrationDetailsSerializer,
    RegistrationDocumentSerializer,
    RegistrationDocumentUploadSerializer,
    RegistrationDraftSerializer,
    RegistrationFieldConfigurationSerializer,
    RegistrationSubmissionSerializer,
    registration_can_be_submitted,
)
from .services import (
    enqueue_driver_authorization_update,
    manageable_admins_for,
    location_descendant_ids,
    record_registration_decision,
    required_license_types_for_role,
    users_visible_to_admin,
)


class LocationOptionsView(generics.ListAPIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    serializer_class = LocationSerializer
    pagination_class = None

    def get_queryset(self):
        parent_id = self.request.query_params.get("parent_id")
        queryset = AdministrativeLocation.objects.filter(active=True)
        if parent_id:
            parent = get_object_or_404(queryset, pk=parent_id)
            return queryset.filter(parent=parent).order_by("name", "source_id")
        return queryset.filter(parent__isnull=True).order_by("name", "source_id")


class ProductTypeOptionsView(generics.ListAPIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    serializer_class = AgriculturalProductTypeSerializer
    pagination_class = None
    queryset = AgriculturalProductType.objects.filter(active=True).filter(
        Q(
            catalog_category__parent__registration_enabled=True,
            catalog_category__parent__active=True,
            catalog_category__active=True,
        )
        | Q(
            catalog_category__parent__isnull=True,
            catalog_category__registration_enabled=True,
            catalog_category__active=True,
        )
        | Q(
            catalog_category__isnull=True,
            category__in=ProductCatalogCategory.objects.filter(
                parent__isnull=True,
                registration_enabled=True,
                active=True,
            ).values("name_en"),
        )
        | Q(catalog_category__isnull=True, category="Root Crops")
    ).order_by("category", "name")


class RegistrationFormFieldsView(views.APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        stage = request.query_params.get("stage")
        role = request.query_params.get("role")
        if stage not in RegistrationFieldConfiguration.Stage.values:
            raise ValidationError({"stage": "Choose INITIAL or PROFILE."})
        if role not in Role.values:
            raise ValidationError({"role": "Choose a supported account role."})
        fields = [
            field
            for field in RegistrationFieldConfiguration.objects.filter(stage=stage)
            if role in field.roles
        ]
        if stage == RegistrationFieldConfiguration.Stage.INITIAL:
            configured = {field.field_key: field for field in fields}
            identity_fields_ready = all(
                key in configured
                and configured[key].visible
                and configured[key].required
                for key in ("full_name", "email")
            )
            if not identity_fields_ready or "phone" not in configured:
                return Response(
                    {
                        "success": False,
                        "error": {
                            "registration_settings": [
                                "Required initial registration fields are not configured for this role. Contact a Marketplace administrator."
                            ]
                        },
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
        serializer = RegistrationFieldConfigurationSerializer(fields, many=True)
        return Response({"results": serializer.data})


class RegistrationDraftView(views.APIView):
    authentication_classes = [
        RegistrationCompletionAuthentication,
        JWTAuthentication,
    ]
    permission_classes = [permissions.IsAuthenticated]

    def get_registration(self, user):
        return get_object_or_404(
            UserRegistration.objects.select_related("location", "user").prefetch_related(
                "documents", "product_selections__product_type", "review_history__reviewer"
            ),
            user=user,
        )

    def get(self, request):
        registration = self.get_registration(request.user)
        return Response(RegistrationDetailsSerializer(registration).data)

    def patch(self, request):
        registration = self.get_registration(request.user)
        if registration.status not in (
            RegistrationStatus.DRAFT,
            RegistrationStatus.CHANGES_REQUESTED,
            RegistrationStatus.REJECTED,
            RegistrationStatus.APPROVED,
        ):
            return Response(
                {"success": False, "error": "This registration can no longer be edited."},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = RegistrationDraftSerializer(
            data=request.data,
            partial=True,
            context={"request": request, "registration": registration},
        )
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            registration = serializer.update(
                registration, serializer.validated_data
            )
            if registration.user.role == Role.DRIVER:
                enqueue_driver_authorization_update(registration.user)
        return Response(RegistrationDetailsSerializer(registration).data)


class RegistrationDocumentView(views.APIView):
    authentication_classes = [RegistrationCompletionAuthentication]
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        registration = get_object_or_404(UserRegistration, user=request.user)
        serializer = RegistrationDocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded = serializer.validated_data["file"]
        allowed_document_types = required_license_types_for_role(request.user.role)
        document_type = serializer.validated_data.get("document_type")
        if document_type is None and len(allowed_document_types) == 1:
            document_type = allowed_document_types[0]
        if document_type not in allowed_document_types:
            raise ValidationError({"document_type": "This document is not required for your registration role."})
        document = RegistrationDocument.objects.create(
            registration=registration,
            document_type=document_type,
            original_filename=Path(uploaded.name).name[:255],
            file=uploaded,
        )
        return Response(
            RegistrationDocumentSerializer(document).data,
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request, document_id):
        registration = get_object_or_404(UserRegistration, user=request.user)
        document = get_object_or_404(
            RegistrationDocument, id=document_id, registration=registration
        )
        document.file.delete(save=False)
        document.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SubmitRegistrationView(views.APIView):
    authentication_classes = [RegistrationCompletionAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        registration = get_object_or_404(
            UserRegistration.objects.select_related("location", "user"),
            user=request.user,
        )
        serializer = RegistrationSubmissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        registration_can_be_submitted(registration, request.user)

        config = PlatformSettings.load()
        with transaction.atomic():
            registration.status = RegistrationStatus.SUBMITTED
            registration.submitted_at = timezone.now()
            registration.save(update_fields=["status", "submitted_at", "updated_at"])

            if request.user.status == AccountStatus.REJECTED:
                request.user.status = AccountStatus.PENDING
                request.user.rejection_reason = ""
                request.user.is_active = False
                request.user.save(
                    update_fields=["status", "rejection_reason", "is_active", "updated_at"]
                )

            if not config.require_approval:
                registration.status = RegistrationStatus.APPROVED
                registration.save(update_fields=["status", "updated_at"])
                request.user.approve()
            else:
                reviewers = _reviewer_ids_for_registration(registration)
                if reviewers:
                    notify(
                        user_ids=reviewers,
                        type="REGISTRATION",
                        message=(
                            f"New {request.user.get_role_display().lower()} registration "
                            f"awaiting review: {request.user.full_name}"
                        ),
                        actor=request.user,
                    )
                notify(
                    user_ids=[request.user.id],
                    type="REGISTRATION",
                    message="Your complete registration was submitted for admin review.",
                    actor=None,
                )
        if request.user.role == Role.DRIVER and config.require_approval:
            enqueue_driver_authorization_update(request.user)
        return Response(
            {
                "success": True,
                "message": (
                    "Registration complete and approved."
                    if not config.require_approval
                    else "Registration submitted. It is awaiting admin review."
                ),
                "status": registration.status,
            }
        )


def _reviewer_ids_for_registration(registration):
    candidates = User.objects.filter(role=Role.SUPER_ADMIN, status=AccountStatus.APPROVED)
    scopes = AdministratorScope.objects.filter(
        user__status=AccountStatus.APPROVED
    ).select_related("location")
    location_ids = set()
    location = registration.location
    while location is not None:
        location_ids.add(location.pk)
        location = location.parent
    scoped_user_ids = scopes.filter(
        Q(level=AdministratorScope.Level.GLOBAL)
        | Q(level=AdministratorScope.Level.LOCATION, location_id__in=location_ids)
    ).values_list("user_id", flat=True)
    return list(set(candidates.values_list("id", flat=True)) | set(scoped_user_ids))


def _scoped_registrations(user):
    visible_users = users_visible_to_admin(user)
    return UserRegistration.objects.filter(user__in=visible_users).select_related(
        "user", "location", "location__parent"
    ).prefetch_related(
        "documents", "product_selections__product_type", "review_history__reviewer"
    )


def _filter_registrations(queryset, params):
    role = params.get("role")
    if role:
        if role not in (Role.FARMER, Role.WHOLESALER, Role.RETAILER, Role.DRIVER):
            raise ValidationError({"role": "Choose a commercial registration role."})
        queryset = queryset.filter(user__role=role)
    registration_status = params.get("status")
    if registration_status:
        valid_statuses = {choice.value for choice in RegistrationStatus}
        if registration_status not in valid_statuses:
            raise ValidationError({"status": "Unknown registration status."})
        queryset = queryset.filter(status=registration_status)
    search = (params.get("search") or "").strip()
    if search:
        queryset = queryset.filter(
            Q(user__full_name__icontains=search)
            | Q(user__email__icontains=search)
            | Q(user__phone__icontains=search)
            | Q(location__name__icontains=search)
        )
    location_id = params.get("location_id")
    if location_id:
        location = get_object_or_404(AdministrativeLocation, pk=location_id, active=True)
        queryset = queryset.filter(location_id__in=location_descendant_ids(location))
    for parameter, lookup in (
        ("submitted_from", "submitted_at__date__gte"),
        ("submitted_to", "submitted_at__date__lte"),
    ):
        raw = params.get(parameter)
        if raw:
            try:
                date.fromisoformat(raw)
            except ValueError as exc:
                raise ValidationError({parameter: "Use an ISO date (YYYY-MM-DD)."}) from exc
            queryset = queryset.filter(**{lookup: raw})
    return queryset


class RegistrationListView(generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = RegistrationDetailsSerializer

    def get_queryset(self):
        if self.request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return UserRegistration.objects.none()
        queryset = _scoped_registrations(self.request.user)
        if not self.request.query_params.get("status"):
            queryset = queryset.filter(
                status__in=(
                    RegistrationStatus.SUBMITTED,
                    RegistrationStatus.CHANGES_REQUESTED,
                )
            )
        return _filter_registrations(queryset, self.request.query_params)


class RegistrationDetailView(generics.RetrieveAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = RegistrationDetailsSerializer
    lookup_url_kwarg = "registration_id"

    def get_queryset(self):
        if self.request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return UserRegistration.objects.none()
        return _scoped_registrations(self.request.user)


class RegistrationDecisionView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, registration_id):
        if request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)
        registration = get_object_or_404(
            _scoped_registrations(request.user),
            pk=registration_id,
        )
        serializer = RegistrationDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action = serializer.validated_data["action"]
        reason = serializer.validated_data["reason"]
        registration = record_registration_decision(
            registration.pk,
            request.user,
            action,
            reason,
        )
        return Response(
            {
                "success": True,
                "registration": RegistrationDetailsSerializer(registration).data,
            }
        )


class RegistrationDocumentAccessView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, document_id):
        if request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)
        document = get_object_or_404(
            RegistrationDocument.objects.select_related(
                "registration__user", "registration__location"
            ),
            pk=document_id,
        )
        if not users_visible_to_admin(request.user).filter(
            pk=document.registration.user_id
        ).exists():
            raise NotFound()
        extension = Path(document.original_filename).suffix.lower()
        content_type = {
            ".pdf": "application/pdf",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
        }[extension]
        response = FileResponse(
            document.file.open("rb"),
            as_attachment=True,
            filename=Path(document.original_filename).name,
            content_type=content_type,
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class VerifyRegistrationDocumentView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, document_id):
        if request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)
        document = get_object_or_404(
            RegistrationDocument.objects.select_related("registration__user"),
            pk=document_id,
        )
        if not users_visible_to_admin(request.user).filter(
            pk=document.registration.user_id
        ).exists():
            raise NotFound()
        serializer = LicenseVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verified = serializer.validated_data["verified"]
        note = serializer.validated_data.get("note", "").strip()
        with transaction.atomic():
            document.verification_status = (
                RegistrationDocument.VerificationStatus.VERIFIED
                if verified
                else RegistrationDocument.VerificationStatus.REJECTED
            )
            document.verification_note = note
            document.verified_by = request.user
            document.verified_at = timezone.now()
            document.save(
                update_fields=[
                    "verification_status",
                    "verification_note",
                    "verified_by",
                    "verified_at",
                ]
            )
            RegistrationReview.objects.create(
                registration=document.registration,
                reviewer=request.user,
                action=(
                    RegistrationReview.Action.LICENSE_VERIFIED
                    if verified
                    else RegistrationReview.Action.LICENSE_REJECTED
                ),
                reason=note,
            )
            AuditLog.objects.create(
                actor=request.user,
                action="registration_license_verified" if verified else "registration_license_rejected",
                target=document.registration.user.email,
                detail=note,
            )
            if not verified:
                notify(
                    user_ids=[document.registration.user_id],
                    type="REGISTRATION",
                    message=f"Your license needs correction. Reason: {note}",
                    actor=request.user,
                )
            if document.registration.user.role == Role.DRIVER:
                enqueue_driver_authorization_update(document.registration.user)
        return Response(RegistrationDocumentSerializer(document).data)


class RegistrationReportView(views.APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)
        queryset = _scoped_registrations(request.user)
        queryset = _filter_registrations(queryset, request.query_params)
        rows = queryset.values("status", "user__role").annotate(total=Count("id"))
        by_status = {value: 0 for value, _ in RegistrationStatus.choices}
        by_role = {value: 0 for value, _ in Role.choices}
        for row in rows:
            by_status[row["status"]] += row["total"]
            by_role[row["user__role"]] += row["total"]
        return Response(
            {
                "total": sum(by_status.values()),
                "by_status": by_status,
                "by_role": by_role,
            }
        )


class AdministratorScopeListCreateView(generics.ListCreateAPIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return AdministratorScope.objects.none()
        visible_users = manageable_admins_for(
            self.request.user,
            User.objects.all(),
        ).values("pk")
        return (
            AdministratorScope.objects.select_related("user", "location")
            .filter(user_id__in=visible_users)
            .order_by("user__full_name")
        )

    def get_serializer_class(self):
        from .serializers import AdminScopeSerializer

        return AdminScopeSerializer

    def perform_create(self, serializer):
        user = serializer.validated_data["user"]
        if user.status != AccountStatus.APPROVED:
            raise ValidationError({"user": "Only active User Admin accounts can be scoped."})
        existing = AdministratorScope.objects.filter(user=user).first()
        previous = (
            str(existing.location or "Nationwide")
            if existing
            else "Unassigned"
        )
        if existing:
            serializer.instance = existing
        scope = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="admin_scope_assigned",
            target=user.email,
            detail=f"{previous} -> {scope.location or 'Nationwide'}",
        )


class AdministratorScopeDetailView(generics.RetrieveUpdateAPIView):
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "user_id"
    lookup_url_kwarg = "user_id"

    def get_queryset(self):
        if self.request.user.role not in (Role.USER_ADMIN, Role.SUPER_ADMIN):
            return AdministratorScope.objects.none()
        visible_users = manageable_admins_for(
            self.request.user,
            User.objects.all(),
        ).values("pk")
        return AdministratorScope.objects.select_related(
            "user", "location"
        ).filter(user_id__in=visible_users)

    def get_serializer_class(self):
        from .serializers import AdminScopeSerializer

        return AdminScopeSerializer

    def perform_update(self, serializer):
        previous = str(serializer.instance.location or "Nationwide")
        scope = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="admin_scope_updated",
            target=scope.user.email,
            detail=f"{previous} -> {scope.location or 'Nationwide'}",
        )


class SuperAdminLocationViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = ManagedAdministrativeLocationSerializer
    queryset = AdministrativeLocation.objects.select_related("parent").all()
    pagination_class = None

    def perform_create(self, serializer):
        location = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="administrative_location_created",
            target=str(location.pk),
            detail=json.dumps(
                {
                    "source_id": location.source_id,
                    "name": location.name,
                    "level": location.level,
                    "parent": location.parent_id,
                    "active": location.active,
                },
                sort_keys=True,
                default=str,
            ),
        )

    def perform_update(self, serializer):
        location = serializer.instance
        previous = {
            "source_id": location.source_id,
            "name": location.name,
            "level": location.level,
            "parent": location.parent_id,
            "active": location.active,
        }
        location = serializer.save()
        current = {
            "source_id": location.source_id,
            "name": location.name,
            "level": location.level,
            "parent": location.parent_id,
            "active": location.active,
        }
        if previous != current:
            AuditLog.objects.create(
                actor=self.request.user,
                action="administrative_location_updated",
                target=str(location.pk),
                detail=json.dumps(
                    {"previous": previous, "new": current},
                    sort_keys=True,
                    default=str,
                ),
            )

    def perform_destroy(self, instance):
        if instance.children.filter(active=True).exists():
            raise ValidationError(
                {"active": "Deactivate child locations before deactivating this parent."}
            )
        if instance.active:
            instance.active = False
            instance.save(update_fields=["active"])
            AuditLog.objects.create(
                actor=self.request.user,
                action="administrative_location_deactivated",
                target=str(instance.pk),
                detail=json.dumps(
                    {"name": instance.name, "source_id": instance.source_id},
                    sort_keys=True,
                ),
            )


class SuperAdminRegistrationFieldViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = RegistrationFieldConfigurationSerializer
    queryset = RegistrationFieldConfiguration.objects.all()
    pagination_class = None
    http_method_names = ["get", "patch", "head", "options"]

    def perform_update(self, serializer):
        field = serializer.instance
        previous = {
            "label": field.label,
            "description": field.description,
            "required": field.required,
            "visible": field.visible,
            "display_order": field.display_order,
            "roles": field.roles,
            "options": field.options,
            "editable_after_approval": field.editable_after_approval,
        }
        field = serializer.save(updated_by=self.request.user)
        current = {
            "label": field.label,
            "description": field.description,
            "required": field.required,
            "visible": field.visible,
            "display_order": field.display_order,
            "roles": field.roles,
            "options": field.options,
            "editable_after_approval": field.editable_after_approval,
        }
        if previous != current:
            AuditLog.objects.create(
                actor=self.request.user,
                action="registration_field_configuration_updated",
                target=f"{field.stage}:{field.field_key}",
                detail=json.dumps(
                    {"previous": previous, "new": current},
                    sort_keys=True,
                ),
            )


class SuperAdminProductTypeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = ManagedAgriculturalProductTypeSerializer
    queryset = AgriculturalProductType.objects.all()
    pagination_class = None

    def perform_create(self, serializer):
        product_type = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="registration_product_option_created",
            target=str(product_type.pk),
            detail=json.dumps(
                {
                    "code": product_type.code,
                    "name": product_type.name,
                    "category": product_type.category,
                    "active": product_type.active,
                },
                sort_keys=True,
            ),
        )

    def perform_update(self, serializer):
        product_type = serializer.instance
        previous = {
            "code": product_type.code,
            "name": product_type.name,
            "name_am": product_type.name_am,
            "name_am_latin": product_type.name_am_latin,
            "category": product_type.category,
            "catalog_category": str(product_type.catalog_category_id),
            "supports_varieties": product_type.supports_varieties,
            "mapping_needs_review": product_type.mapping_needs_review,
            "review_note": product_type.review_note,
            "active": product_type.active,
        }
        product_type = serializer.save()
        current = {
            "code": product_type.code,
            "name": product_type.name,
            "name_am": product_type.name_am,
            "name_am_latin": product_type.name_am_latin,
            "category": product_type.category,
            "catalog_category": str(product_type.catalog_category_id),
            "supports_varieties": product_type.supports_varieties,
            "mapping_needs_review": product_type.mapping_needs_review,
            "review_note": product_type.review_note,
            "active": product_type.active,
        }
        if previous != current:
            AuditLog.objects.create(
                actor=self.request.user,
                action="registration_product_option_updated",
                target=str(product_type.pk),
                detail=json.dumps(
                    {"previous": previous, "new": current},
                    sort_keys=True,
                ),
            )

    def perform_destroy(self, instance):
        if instance.active:
            instance.active = False
            instance.save(update_fields=["active"])
            AuditLog.objects.create(
                actor=self.request.user,
                action="registration_product_option_deactivated",
                target=str(instance.pk),
                detail=json.dumps(
                    {
                        "code": instance.code,
                        "name": instance.name,
                        "category": instance.category,
                    },
                    sort_keys=True,
                ),
            )


class SuperAdminProductCatalogCategoryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = ProductCatalogCategorySerializer
    queryset = ProductCatalogCategory.objects.select_related("parent").all()
    pagination_class = None

    def _audit(self, action, category, detail):
        AuditLog.objects.create(
            actor=self.request.user,
            action=action,
            target=str(category.pk),
            detail=json.dumps(detail, sort_keys=True, default=str),
        )

    def perform_create(self, serializer):
        category = serializer.save()
        self._audit("product_catalog_category_created", category, serializer.data)

    def perform_update(self, serializer):
        category = serializer.instance
        previous = ProductCatalogCategorySerializer(category).data
        category = serializer.save()
        current = ProductCatalogCategorySerializer(category).data
        if previous != current:
            self._audit(
                "product_catalog_category_updated",
                category,
                {"previous": previous, "new": current},
            )

    def perform_destroy(self, instance):
        if instance.active:
            instance.active = False
            instance.save(update_fields=["active"])
            self._audit(
                "product_catalog_category_deactivated",
                instance,
                {"active": False},
            )


class SuperAdminProductVarietyViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = ProductVarietySerializer
    queryset = ProductVariety.objects.select_related("product").all()
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        product_id = self.request.query_params.get("product")
        return queryset.filter(product_id=product_id) if product_id else queryset

    def perform_create(self, serializer):
        variety = serializer.save(review_status=ProductVariety.ReviewStatus.APPROVED)
        AuditLog.objects.create(
            actor=self.request.user,
            action="product_variety_created",
            target=str(variety.pk),
            detail=json.dumps(ProductVarietySerializer(variety).data, sort_keys=True),
        )

    def perform_update(self, serializer):
        variety = serializer.instance
        previous = ProductVarietySerializer(variety).data
        variety = serializer.save()
        current = ProductVarietySerializer(variety).data
        if previous != current:
            AuditLog.objects.create(
                actor=self.request.user,
                action="product_variety_updated",
                target=str(variety.pk),
                detail=json.dumps(
                    {"previous": previous, "new": current},
                    sort_keys=True,
                ),
            )

    def perform_destroy(self, instance):
        if instance.active:
            instance.active = False
            instance.save(update_fields=["active"])
            AuditLog.objects.create(
                actor=self.request.user,
                action="product_variety_deactivated",
                target=str(instance.pk),
                detail=json.dumps({"active": False}, sort_keys=True),
            )


class SuperAdminProductAliasViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = ProductAliasSerializer
    queryset = ProductAlias.objects.select_related("product", "variety").all()
    pagination_class = None

    def get_queryset(self):
        queryset = super().get_queryset()
        product_id = self.request.query_params.get("product")
        return queryset.filter(product_id=product_id) if product_id else queryset

    def perform_create(self, serializer):
        alias = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="product_alias_created",
            target=str(alias.pk),
            detail=json.dumps(ProductAliasSerializer(alias).data, sort_keys=True),
        )

    def perform_update(self, serializer):
        alias = serializer.instance
        previous = ProductAliasSerializer(alias).data
        alias = serializer.save()
        current = ProductAliasSerializer(alias).data
        if previous != current:
            AuditLog.objects.create(
                actor=self.request.user,
                action="product_alias_updated",
                target=str(alias.pk),
                detail=json.dumps(
                    {"previous": previous, "new": current},
                    sort_keys=True,
                ),
            )

    def perform_destroy(self, instance):
        AuditLog.objects.create(
            actor=self.request.user,
            action="product_alias_deactivated",
            target=str(instance.pk),
            detail=json.dumps({"alias": instance.alias}, sort_keys=True),
        )
        instance.delete()


class SuperAdminProductSuggestionViewSet(viewsets.ModelViewSet):
    permission_classes = [IsSuperAdmin]
    serializer_class = SuperAdminProductSuggestionSerializer
    queryset = ProductSuggestion.objects.select_related(
        "suggested_by",
        "suggested_category",
        "parent_product",
        "resolved_product",
        "resolved_variety",
    )
    pagination_class = None
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_filter = self.request.query_params.get("status")
        return queryset.filter(status=status_filter) if status_filter else queryset

    def perform_update(self, serializer):
        suggestion = serializer.instance
        new_status = serializer.validated_data.get("status", suggestion.status)
        resolved_product = serializer.validated_data.get(
            "resolved_product", suggestion.resolved_product
        )
        resolved_variety = serializer.validated_data.get(
            "resolved_variety", suggestion.resolved_variety
        )
        with transaction.atomic():
            if new_status == ProductSuggestion.ReviewStatus.APPROVED:
                if suggestion.suggestion_type == ProductSuggestion.SuggestionType.PRODUCT:
                    if resolved_product:
                        if resolved_product.category != suggestion.suggested_category.name_en:
                            raise ValidationError(
                                {"resolved_product": "The product must belong to the suggested category."}
                            )
                        _approve_product_suggestion_as_alias(
                            suggestion, resolved_product
                        )
                    elif suggestion.language == ProductAlias.Language.ENGLISH:
                        resolved_product = _create_product_from_suggestion(suggestion)
                    else:
                        raise ValidationError(
                            {"resolved_product": "Select a canonical product before approving this translation."}
                        )
                elif resolved_variety:
                    if resolved_variety.product_id != suggestion.parent_product_id:
                        raise ValidationError(
                            {"resolved_variety": "The variety must belong to the suggested product."}
                        )
                    _approve_variety_suggestion_as_alias(
                        suggestion, resolved_variety
                    )
                elif suggestion.language == ProductAlias.Language.ENGLISH:
                    resolved_variety = _create_variety_from_suggestion(suggestion)
                else:
                    raise ValidationError(
                        {"resolved_variety": "Select a canonical variety before approving this translation."}
                    )

        suggestion = serializer.save(
            reviewed_by=self.request.user,
            reviewed_at=timezone.now(),
            resolved_product=resolved_product,
            resolved_variety=resolved_variety,
        )
        AuditLog.objects.create(
            actor=self.request.user,
            action="product_catalog_suggestion_reviewed",
            target=str(suggestion.pk),
            detail=json.dumps(
                {
                    "suggestion_type": suggestion.suggestion_type,
                    "name": suggestion.name,
                    "status": suggestion.status,
                    "resolved_product": suggestion.resolved_product_id,
                    "resolved_variety": suggestion.resolved_variety_id,
                },
                sort_keys=True,
                default=str,
            ),
        )


def _normalize_product_alias(value):
    import unicodedata

    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _approve_product_suggestion_as_alias(suggestion, product):
    ProductAlias.objects.get_or_create(
        product=product,
        variety=None,
        normalized_alias=_normalize_product_alias(suggestion.name),
        defaults={
            "alias": suggestion.name,
            "language": suggestion.language or ProductAlias.Language.ENGLISH,
            "approved": True,
        },
    )


def _approve_variety_suggestion_as_alias(suggestion, variety):
    ProductAlias.objects.get_or_create(
        product=variety.product,
        variety=variety,
        normalized_alias=_normalize_product_alias(suggestion.name),
        defaults={
            "alias": suggestion.name,
            "language": suggestion.language or ProductAlias.Language.ENGLISH,
            "approved": True,
        },
    )


def _create_product_from_suggestion(suggestion):
    category = suggestion.suggested_category
    name = " ".join(suggestion.name.split())
    if AgriculturalProductType.objects.filter(
        category=category.name_en, name__iexact=name
    ).exists():
        raise ValidationError(
            {"resolved_product": "A product with this name already exists; select it as canonical."}
        )
    base_code = slugify(name)[:90] or "catalog-product"
    code = base_code
    suffix = 2
    while AgriculturalProductType.objects.filter(code=code).exists():
        code = f"{base_code}-{suffix}"
        suffix += 1
    product = AgriculturalProductType.objects.create(
        code=code,
        name=name,
        category=category.name_en,
        catalog_category=category,
        mapping_needs_review=True,
        review_note="Approved from a user suggestion; assign a verified subcategory.",
    )
    return product


def _create_variety_from_suggestion(suggestion):
    product = suggestion.parent_product
    name = " ".join(suggestion.name.split())
    if ProductVariety.objects.filter(product=product, name_en__iexact=name).exists():
        raise ValidationError(
            {"resolved_variety": "A variety with this name already exists; select it as canonical."}
        )
    product.supports_varieties = True
    product.save(update_fields=["supports_varieties"])
    variety = ProductVariety.objects.create(
        product=product,
        name_en=name,
        review_status=ProductVariety.ReviewStatus.APPROVED,
    )
    return variety
