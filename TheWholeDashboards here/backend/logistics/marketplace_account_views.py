"""Driver account security actions delegated to the Marketplace.

The Marketplace owns the canonical driver account. The DriverApp therefore
forwards password changes to the Marketplace endpoint over the driver's own
server-side credential instead of keeping a second password store.
"""

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .marketplace_client import (
    MarketplaceInvalid,
    MarketplaceUnauthenticated,
    MarketplaceUnavailable,
    marketplace_credential,
    marketplace_post,
)
from .models import LogisticsUser
from .services import record_audit

MARKETPLACE_PASSWORD_CHANGE_PATH = "/api/v1/auth/password/change/"


class DriverPasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        write_only=True, trim_whitespace=False, max_length=256
    )
    new_password = serializers.CharField(
        write_only=True, trim_whitespace=False, min_length=8, max_length=256
    )
    confirm_password = serializers.CharField(
        write_only=True, trim_whitespace=False, max_length=256
    )

    def validate(self, attrs):
        if attrs["new_password"] != attrs["confirm_password"]:
            raise serializers.ValidationError(
                {"confirm_password": "The new passwords do not match."}
            )
        if attrs["new_password"] == attrs["current_password"]:
            raise serializers.ValidationError(
                {"new_password": "Choose a password you have not used before."}
            )
        return attrs


class DriverPasswordChangeView(APIView):
    """Change the signed-in driver's password through the Marketplace."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_password_change"

    @extend_schema(
        request=DriverPasswordChangeSerializer,
        responses=OpenApiTypes.OBJECT,
    )
    def post(self, request):
        if request.user.role != LogisticsUser.Role.DRIVER:
            return Response(
                {"detail": "Only driver accounts can change a driver password."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = DriverPasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = marketplace_credential(request)
        if token is None:
            return Response(
                {
                    "detail": (
                        "Approve this change in the Marketplace. Re-open DriverApp "
                        "from your Marketplace driver account to refresh access."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            marketplace_post(
                MARKETPLACE_PASSWORD_CHANGE_PATH,
                token,
                {
                    "current_password": serializer.validated_data["current_password"],
                    "new_password": serializer.validated_data["new_password"],
                },
                surface_validation=True,
            )
        except MarketplaceInvalid as error:
            return Response(
                {"detail": str(error), "errors": error.errors},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except MarketplaceUnauthenticated as error:
            return Response(
                {"detail": str(error)}, status=status.HTTP_401_UNAUTHORIZED
            )
        except MarketplaceUnavailable as error:
            return Response(
                {"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        record_audit(
            request.user,
            "auth.password_changed",
            "logistics_user",
            request.user.pk,
            {"via": "marketplace"},
        )
        return Response(
            {
                "success": True,
                "detail": (
                    "Your password was updated. Use the new password the next time "
                    "you sign in to the Marketplace or DriverApp."
                ),
            }
        )
