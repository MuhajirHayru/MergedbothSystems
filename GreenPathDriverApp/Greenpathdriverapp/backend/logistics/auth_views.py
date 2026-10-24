from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema

from .models import AuditEvent, DriverApplication, DriverProfile, LogisticsUser
from .serializers import (
    AccountActivationSerializer,
    ActionDetailSerializer,
    AuthCredentialsSerializer,
    CsrfTokenSerializer,
    CurrentUserSerializer,
    DriverRegistrationSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetResponseSerializer,
    PasswordResetRequestSerializer,
    RegistrationResponseSerializer,
)
from .services import record_audit

User = get_user_model()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(responses=CsrfTokenSerializer)
    def get(self, request):
        return Response({"csrf_token": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class DriverRegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_register"

    @extend_schema(
        request=DriverRegistrationSerializer,
        responses={201: RegistrationResponseSerializer},
    )
    @transaction.atomic
    def post(self, request):
        if settings.MARKETPLACE_INTEGRATION_ENABLED:
            return Response(
                {"detail": "Register and complete driver verification in GreenPath Marketplace."},
                status=status.HTTP_410_GONE,
            )
        serializer = DriverRegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        user = User.objects.create_user(
            username=values["username"],
            email=values["email"],
            password=values["password"],
            role=LogisticsUser.Role.DRIVER,
            is_active=False,
            email_verified=False,
        )
        profile = DriverProfile.objects.create(
            user=user,
            phone_number=values["phone_number"],
            preferred_language=values["preferred_language"],
        )
        DriverApplication.objects.create(
            profile=profile,
            legal_full_name=values["legal_full_name"],
        )
        record_audit(
            user,
            "driver_account.registered",
            "logistics_user",
            user.pk,
            {"role": LogisticsUser.Role.DRIVER},
        )
        uid = force_str(urlsafe_base64_encode(force_bytes(user.pk)))
        token = default_token_generator.make_token(user)
        response_data = {
            "detail": "Check your email to activate your driver account."
        }
        if settings.PASSWORD_RESET_DEBUG_DELIVERY:
            response_data["development_activation"] = {"uid": uid, "token": token}
        else:
            activation_url = (
                f"{settings.FRONTEND_BASE_URL.rstrip('/')}/activate-account"
                f"?uid={uid}&token={token}"
            )
            try:
                send_mail(
                    "Activate your GreenPath driver account",
                    f"Activate your account using this one-time link: {activation_url}",
                    settings.DEFAULT_FROM_EMAIL,
                    [user.email],
                    fail_silently=False,
                )
            except Exception as error:
                raise APIException(
                    "Account activation is temporarily unavailable."
                ) from error
        return Response(response_data, status=status.HTTP_201_CREATED)


@method_decorator(csrf_protect, name="dispatch")
class AccountActivationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_register"

    @extend_schema(request=AccountActivationSerializer, responses=CurrentUserSerializer)
    def post(self, request):
        uid = request.data.get("uid", "")
        token = request.data.get("token", "")
        if not uid or not token:
            raise ValidationError({"detail": "Activation details are required."})
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id, email_verified=False)
        except (User.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"detail": "Invalid or expired activation link."})
        if not default_token_generator.check_token(user, token):
            raise ValidationError({"detail": "Invalid or expired activation link."})

        user.email_verified = True
        user.is_active = True
        user.save(update_fields=["email_verified", "is_active"])
        record_audit(user, "auth.account_activated", "logistics_user", user.pk)
        login(request, user)
        request.session.set_expiry(settings.SESSION_COOKIE_AGE)
        return Response(CurrentUserSerializer(user).data)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_login"

    @extend_schema(
        request=AuthCredentialsSerializer,
        responses={200: CurrentUserSerializer, 401: ActionDetailSerializer},
    )
    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "")
        if not username or not password:
            raise ValidationError({"detail": "Username and password are required."})

        if "@" in username:
            candidate = User.objects.filter(email__iexact=username).values_list(
                "username", flat=True
            ).first()
            username = candidate or username
        user = authenticate(request, username=username, password=password)
        if user is None:
            AuditEvent.objects.create(
                action="auth.login_failed",
                object_type="authentication",
                details={"reason": "invalid_credentials"},
            )
            return Response(
                {"detail": "Invalid credentials or inactive account."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        login(request, user)
        request.session.set_expiry(settings.SESSION_COOKIE_AGE)
        record_audit(user, "auth.login_succeeded", "logistics_user", user.pk)
        if getattr(user, "role", "") == "driver":
            from .marketplace_client import marketplace_credential
            marketplace_credential(request)
        return Response(CurrentUserSerializer(user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        record_audit(request.user, "auth.logout", "logistics_user", request.user.pk)
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CurrentUserView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=CurrentUserSerializer)
    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_password_reset"

    @extend_schema(
        request=PasswordResetRequestSerializer,
        responses={200: PasswordResetResponseSerializer},
    )
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(
            email__iexact=serializer.validated_data["email"], is_active=True
        ).first()
        response_data = {
            "detail": "If an active account matches that email, recovery instructions have been sent."
        }
        if not user:
            return Response(response_data, status=status.HTTP_200_OK)

        uid = force_str(urlsafe_base64_encode(force_bytes(user.pk)))
        token = default_token_generator.make_token(user)
        if settings.PASSWORD_RESET_DEBUG_DELIVERY:
            response_data["development_reset"] = {"uid": uid, "token": token}
        else:
            frontend_url = settings.FRONTEND_BASE_URL.rstrip("/")
            reset_url = f"{frontend_url}/reset-password?uid={uid}&token={token}"
            try:
                send_mail(
                    "GreenPath account password reset",
                    f"Use this one-time link to reset your password: {reset_url}",
                    settings.DEFAULT_FROM_EMAIL,
                    [user.email],
                    fail_silently=False,
                )
            except Exception:
                AuditEvent.objects.create(
                    action="auth.password_reset_delivery_failed",
                    object_type="authentication",
                    details={"reason": "email_delivery_unavailable"},
                )
        return Response(response_data, status=status.HTTP_200_OK)


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_password_reset_confirm"

    @extend_schema(
        request=PasswordResetConfirmSerializer,
        responses={200: ActionDetailSerializer},
    )
    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        try:
            user_id = force_str(urlsafe_base64_decode(values["uid"]))
            user = User.objects.get(pk=user_id, is_active=True)
        except (User.DoesNotExist, ValueError, TypeError):
            raise ValidationError({"detail": "Invalid or expired reset link."})

        if not default_token_generator.check_token(user, values["token"]):
            raise ValidationError({"detail": "Invalid or expired reset link."})
        try:
            validate_password(values["new_password"], user=user)
        except DjangoValidationError as error:
            raise ValidationError({"new_password": error.messages}) from error

        user.set_password(values["new_password"])
        user.save(update_fields=["password"])
        record_audit(user, "auth.password_reset", "logistics_user", user.pk)
        return Response({"detail": "Password reset successfully."})
