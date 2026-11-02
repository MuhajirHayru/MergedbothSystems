"""Driver payout-account proxies for the authoritative Marketplace wallet.

The DriverApp never stores bank details. Every read and write is forwarded to
the Marketplace, which owns encryption, masking, ownership, and review state.
"""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .marketplace_client import (
    MarketplaceInvalid,
    MarketplaceUnauthenticated,
    MarketplaceUnavailable,
    marketplace_credential,
    marketplace_delete,
    marketplace_get,
    marketplace_patch,
    marketplace_post,
)
from .marketplace_errors import marketplace_error_response
from .models import LogisticsUser
from .services import record_audit

MARKETPLACE_BANKS_PATH = "/api/v1/wallet/banks/"
MARKETPLACE_BANK_ACCOUNTS_PATH = "/api/v1/wallet/bank-accounts/"

ACCOUNT_WRITE_FIELDS = {
    "bank",
    "account_holder_name",
    "account_number",
    "confirm_account_number",
    "branch",
    "branch_code",
    "account_type",
    "nickname",
    "is_default",
}


def _driver_or_response(user):
    if user.role != LogisticsUser.Role.DRIVER:
        return Response(
            {"detail": "Only driver accounts manage payout accounts here."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


def _unlinked_response():
    return Response(
        {
            "linked": False,
            "count": 0,
            "results": [],
            "detail": (
                "Open DriverApp from your Marketplace driver account to manage payout "
                "accounts."
            ),
        }
    )


def _results(payload):
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            return payload
        return {"count": len(payload) if payload else 0, "results": [payload] if payload else []}
    if isinstance(payload, list):
        return {"count": len(payload), "results": payload}
    return {"count": 0, "results": []}


def _account_payload(data):
    return {
        key: data[key]
        for key in ACCOUNT_WRITE_FIELDS
        if key in data and data[key] not in (None, "")
    }


class DriverPayoutBankListView(APIView):
    """List banks the Marketplace accepts for payout accounts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _driver_or_response(request.user)
        if denied:
            return denied
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        try:
            return Response(_results(marketplace_get(MARKETPLACE_BANKS_PATH, token)))
        except (MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)


class DriverBankAccountListCreateView(APIView):
    """List or register the signed-in driver's Marketplace payout accounts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _driver_or_response(request.user)
        if denied:
            return denied
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        try:
            return Response(
                _results(marketplace_get(MARKETPLACE_BANK_ACCOUNTS_PATH, token))
            )
        except (MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)

    def post(self, request):
        denied = _driver_or_response(request.user)
        if denied:
            return denied
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        payload = _account_payload(request.data or {})
        try:
            created = marketplace_post(
                MARKETPLACE_BANK_ACCOUNTS_PATH,
                token,
                payload,
                surface_validation=True,
            )
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        record_audit(
            request.user,
            "driver.payout_account_registered",
            "marketplace_bank_account",
            str(created.get("id", "")) if isinstance(created, dict) else "",
            {"masked": (created or {}).get("masked_account_number", "")},
        )
        return Response(created, status=status.HTTP_201_CREATED)


class DriverBankAccountDetailView(APIView):
    """Update or remove one of the driver's own payout accounts."""

    permission_classes = [IsAuthenticated]

    def patch(self, request, account_id):
        denied = _driver_or_response(request.user)
        if denied:
            return denied
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        payload = _account_payload(request.data or {})
        if not payload:
            return Response(
                {"detail": "Provide at least one account field to update."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            updated = marketplace_patch(
                f"{MARKETPLACE_BANK_ACCOUNTS_PATH}{account_id}/",
                token,
                payload,
            )
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        record_audit(
            request.user,
            "driver.payout_account_updated",
            "marketplace_bank_account",
            str(account_id),
            {"fields": sorted(payload)},
        )
        return Response(updated)

    def delete(self, request, account_id):
        denied = _driver_or_response(request.user)
        if denied:
            return denied
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        try:
            marketplace_delete(f"{MARKETPLACE_BANK_ACCOUNTS_PATH}{account_id}/", token)
        except (MarketplaceInvalid, MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return marketplace_error_response(error)
        record_audit(
            request.user,
            "driver.payout_account_removed",
            "marketplace_bank_account",
            str(account_id),
            {},
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
