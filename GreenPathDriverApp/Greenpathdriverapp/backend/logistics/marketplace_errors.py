"""Consistent DRF responses for failures reported by the Marketplace bridge."""

from rest_framework import status
from rest_framework.response import Response

from .marketplace_client import MarketplaceInvalid, MarketplaceUnauthenticated


def marketplace_error_response(error):
    """Translate a Marketplace client failure into a DRF response."""
    if isinstance(error, MarketplaceInvalid):
        return Response(
            {"detail": str(error), "errors": getattr(error, "errors", {})},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if isinstance(error, MarketplaceUnauthenticated):
        return Response({"detail": str(error)}, status=status.HTTP_401_UNAUTHORIZED)
    return Response({"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
