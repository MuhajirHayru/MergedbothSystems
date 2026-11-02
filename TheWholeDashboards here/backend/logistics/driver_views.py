from pathlib import PurePosixPath

from django.conf import settings
from django.db import models, transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema

from .models import DriverApplication, DriverDocument, DriverProfile
from .permissions import (
    IsDriver,
    IsDriverReviewer,
    application_in_scope,
    applications_in_reviewer_scope,
)
from .serializers import (
    DocumentUploadSerializer,
    DocumentVerificationSerializer,
    DriverApplicationInputSerializer,
    DriverApplicationSerializer,
    DriverAvailabilityInputSerializer,
    DriverDocumentMetadataSerializer,
    ReviewerDriverApplicationSerializer,
    ReviewActionSerializer,
)
from .services import record_audit, review_driver_application, submit_driver_application, verify_driver_document


def owned_application(user):
    return get_object_or_404(
        DriverApplication.objects.select_related("profile__user"),
        profile__user=user,
    )


def require_local_application_authority():
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        raise PermissionDenied(
            "Driver registration and application changes are managed by GreenPath Marketplace."
        )


class DriverApplicationView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    @extend_schema(responses=DriverApplicationSerializer)
    def get(self, request):
        return Response(DriverApplicationSerializer(owned_application(request.user)).data)

    @extend_schema(request=DriverApplicationInputSerializer, responses=DriverApplicationSerializer)
    @transaction.atomic
    def patch(self, request):
        require_local_application_authority()
        application = owned_application(request.user)
        serializer = DriverApplicationInputSerializer(
            application, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        record_audit(
            request.user,
            "driver_application.updated",
            "driver_application",
            updated.pk,
            {"fields": sorted(serializer.validated_data.keys())},
        )
        return Response(DriverApplicationSerializer(updated).data)


class DriverAvailabilityView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    def get(self, request):
        profile = owned_application(request.user).profile
        authorized = _driver_can_accept_work(request.user)
        return Response({"available": profile.is_available, "eligible": authorized})

    @transaction.atomic
    def patch(self, request):
        serializer = DriverAvailabilityInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = DriverProfile.objects.select_for_update().filter(user=request.user).first()
        if profile is None:
            raise PermissionDenied("A complete driver profile is required.")
        if serializer.validated_data["available"] and not _driver_can_accept_work(request.user):
            raise PermissionDenied("Only an approved, active, authorized driver can accept work.")
        profile.is_available = serializer.validated_data["available"]
        profile.save(update_fields=["is_available", "updated_at"])
        record_audit(
            request.user,
            "driver.availability_changed",
            "driver_profile",
            profile.pk,
            {"available": profile.is_available},
        )
        return Response({"available": profile.is_available, "eligible": _driver_can_accept_work(request.user)})


def _driver_can_accept_work(user):
    from django.utils import timezone
    from .models import MarketplaceDriverIdentity

    application = DriverApplication.objects.filter(profile__user=user).first()
    if (
        not user.is_active
        or user.role != "driver"
        or application is None
        or application.status != DriverApplication.Status.APPROVED
        or application.license_expiry is None
        or application.license_expiry <= timezone.localdate()
    ):
        return False
    if settings.MARKETPLACE_INTEGRATION_ENABLED:
        return MarketplaceDriverIdentity.objects.filter(
            user=user,
            driver_authorized=True,
            account_active=True,
            account_status="APPROVED",
            application_status="approved",
            documents_verified=True,
            license_expiry__gt=timezone.localdate(),
        ).exists()
    from .configuration import required_driver_document_types

    valid_documents = set(
        application.documents.filter(
            is_current=True,
            verification_status="verified",
        ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.localdate()))
        .values_list("document_type", flat=True)
    )
    return set(required_driver_document_types()).issubset(valid_documents)


class SubmitDriverApplicationView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]

    @extend_schema(request=None, responses=DriverApplicationSerializer)
    def post(self, request):
        require_local_application_authority()
        application = submit_driver_application(owned_application(request.user), request.user)
        return Response(DriverApplicationSerializer(application).data)


class DriverDocumentUploadView(APIView):
    permission_classes = [IsAuthenticated, IsDriver]
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "driver_document_upload"

    @extend_schema(request=DocumentUploadSerializer, responses=DriverDocumentMetadataSerializer)
    @transaction.atomic
    def post(self, request):
        require_local_application_authority()
        application = owned_application(request.user)
        application = DriverApplication.objects.select_for_update().get(pk=application.pk)
        if application.status not in {
            DriverApplication.Status.DRAFT,
            DriverApplication.Status.ADDITIONAL_INFO_REQUIRED,
        }:
            raise ValidationError("Documents cannot be changed while an application is under review.")

        serializer = DocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        current = DriverDocument.objects.filter(
            application=application,
            document_type=serializer.validated_data["document_type"],
            is_current=True,
        )
        replaced = current.exists()
        current.update(is_current=False)
        document = DriverDocument.objects.create(
            application=application,
            uploaded_by=request.user,
            **serializer.validated_data,
        )
        record_audit(
            request.user,
            "driver_document.uploaded",
            "driver_document",
            document.pk,
            {"document_type": document.document_type, "replaced": replaced},
        )
        return Response(
            DriverDocumentMetadataSerializer(document).data,
            status=status.HTTP_201_CREATED,
        )


class DriverDocumentDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, document_id):
        document = get_object_or_404(
            DriverDocument.objects.select_related("application__profile__user"),
            pk=document_id,
            is_current=True,
        )
        owner = document.application.profile.user_id == request.user.pk
        reviewer = application_in_scope(request.user, document.application)
        if not (owner or reviewer):
            raise Http404
        try:
            content = document.file.open("rb")
        except (OSError, ValueError):
            raise Http404
        response = FileResponse(
            content,
            as_attachment=True,
            filename=f"driver-document-{document.pk}{PurePosixPath(document.file.name).suffix}",
            content_type="application/octet-stream",
        )
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, no-store"
        return response


class ReviewerApplicationPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class ReviewerApplicationListView(APIView):
    permission_classes = [IsAuthenticated, IsDriverReviewer]
    pagination_class = ReviewerApplicationPagination

    @extend_schema(responses=ReviewerDriverApplicationSerializer(many=True))
    def get(self, request):
        applications = applications_in_reviewer_scope(request.user)
        status_filter = request.query_params.get("status")
        valid_statuses = {choice for choice, _label in DriverApplication.Status.choices}
        if status_filter:
            if status_filter not in valid_statuses:
                raise ValidationError({"status": "Unsupported application status filter."})
            applications = applications.filter(status=status_filter)
        search = request.query_params.get("search", "").strip()
        if search:
            applications = applications.filter(
                models.Q(legal_full_name__icontains=search)
                | models.Q(profile__user__username__icontains=search)
                | models.Q(profile__user__email__icontains=search)
            )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(applications, request, view=self)
        serializer = ReviewerDriverApplicationSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class ReviewerApplicationDetailView(APIView):
    permission_classes = [IsAuthenticated, IsDriverReviewer]

    def get_application(self, request, application_id):
        return get_object_or_404(
            applications_in_reviewer_scope(request.user), pk=application_id
        )

    @extend_schema(responses=ReviewerDriverApplicationSerializer)
    def get(self, request, application_id):
        application = self.get_application(request, application_id)
        return Response(ReviewerDriverApplicationSerializer(application).data)


class ReviewerApplicationDecisionView(APIView):
    permission_classes = [IsAuthenticated, IsDriverReviewer]

    @extend_schema(request=ReviewActionSerializer, responses=ReviewerDriverApplicationSerializer)
    def post(self, request, application_id):
        application = get_object_or_404(
            applications_in_reviewer_scope(request.user), pk=application_id
        )
        serializer = ReviewActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reviewed = review_driver_application(
            application.pk,
            request.user,
            serializer.validated_data["status"],
            serializer.validated_data["reason"],
        )
        return Response(ReviewerDriverApplicationSerializer(reviewed).data)


class ReviewerDocumentVerificationView(APIView):
    permission_classes = [IsAuthenticated, IsDriverReviewer]

    @extend_schema(request=DocumentVerificationSerializer, responses=DriverDocumentMetadataSerializer)
    def post(self, request, document_id):
        document = get_object_or_404(
            DriverDocument.objects.select_related("application__profile__user"),
            pk=document_id,
            is_current=True,
        )
        if not application_in_scope(request.user, document.application):
            raise Http404
        serializer = DocumentVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verified = verify_driver_document(
            document,
            request.user,
            serializer.validated_data["verification_status"],
            serializer.validated_data["reason"],
        )
        return Response(DriverDocumentMetadataSerializer(verified).data)
