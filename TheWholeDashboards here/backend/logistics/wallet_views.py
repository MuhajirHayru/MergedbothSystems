"""DriverApp views that surface the authoritative Marketplace wallet.

The DriverApp has no money of its own. Every figure shown here comes from the
Marketplace wallet for the signed-in driver, so the driver sees exactly what
the financial manager approved, what is still held, and what is waiting on a
payout review.
"""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, InvalidOperation

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .marketplace_client import (
    MARKETPLACE_PAYOUTS_PATH,
    MARKETPLACE_TRANSACTIONS_PATH,
    MARKETPLACE_WALLET_PATH,
    MarketplaceUnavailable,
    MarketplaceUnauthenticated,
    marketplace_credential,
    marketplace_get,
    marketplace_post,
)
from .models import (
    LogisticsUser,
    MarketplaceDeliveryFeeReview,
    MarketplaceShipmentEvent,
    ShipmentFeeAgreement,
)
from .services import record_audit


def _driver_or_403(user):
    if user.role != LogisticsUser.Role.DRIVER:
        raise PermissionDenied("Only driver accounts can read the driver wallet.")


def _unlinked_response():
    return Response(
        {
            "linked": False,
            "wallet": None,
            "summary": None,
            "transactions": [],
            "payouts": [],
            "detail": (
                "Open DriverApp from your Marketplace driver account to see your "
                "earnings and payout status."
            ),
        }
    )


def _marketplace_error_response(error):
    if isinstance(error, MarketplaceUnauthenticated):
        return Response({"detail": str(error)}, status=status.HTTP_401_UNAUTHORIZED)
    return Response(
        {"detail": str(error)}, status=status.HTTP_503_SERVICE_UNAVAILABLE
    )


def _decimal(value):
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _money(value):
    return str(_decimal(value).quantize(Decimal("0.01")))


def _wallet_summary(wallet, transactions, payouts):
    currency = wallet.get("currency") or "ETB"
    available = _decimal(wallet.get("available_balance"))
    held = _decimal(wallet.get("held_balance"))
    earnings = wallet.get("incoming_total")
    if earnings is None:
        earnings = sum(
            (
                _decimal(transaction.get("amount"))
                for transaction in transactions
                if _decimal(transaction.get("amount")) > 0
            ),
            start=Decimal("0.00"),
        )
    paid_total = sum(
        (
            _decimal(payout.get("amount"))
            for payout in payouts
            if str(payout.get("status") or "").upper() == "PAID"
        ),
        start=Decimal("0.00"),
    )
    pending_total = sum(
        (
            _decimal(payout.get("amount"))
            for payout in payouts
            if str(payout.get("status") or "").upper() == "PENDING"
        ),
        start=Decimal("0.00"),
    )
    return {
        "currency": currency,
        "available_balance": _money(available),
        "pending_balance": _money(held),
        "withdrawable_balance": _money(available),
        "total_earnings": _money(earnings),
        "total_withdrawn": _money(paid_total),
        "pending_withdrawals": _money(pending_total),
        "pending_withdrawal_count": sum(
            1
            for payout in payouts
            if str(payout.get("status") or "").upper() == "PENDING"
        ),
    }


class DriverWalletView(APIView):
    """Marketplace-authoritative wallet, transactions, payouts, and bank accounts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _driver_or_403(request.user)
        token = marketplace_credential(request)
        if token is None:
            return _unlinked_response()
        try:
            with ThreadPoolExecutor(max_workers=3) as pool:
                wallet_future = pool.submit(
                    marketplace_get, MARKETPLACE_WALLET_PATH, token
                )
                transactions_future = pool.submit(
                    marketplace_get, MARKETPLACE_TRANSACTIONS_PATH, token
                )
                payouts_future = pool.submit(
                    marketplace_get, MARKETPLACE_PAYOUTS_PATH, token
                )
                wallet = wallet_future.result()
                transactions = transactions_future.result()
                payouts = payouts_future.result()
        except (MarketplaceUnavailable, MarketplaceUnauthenticated) as error:
            return _marketplace_error_response(error)
        transaction_list = _results(transactions)
        payout_list = _results(payouts)
        return Response(
            {
                "linked": True,
                "wallet": wallet,
                "summary": _wallet_summary(wallet, transaction_list, payout_list),
                "transactions": transaction_list,
                "payouts": payout_list,
                "detail": "",
            }
        )


class DriverFeeAgreementListView(APIView):
    """DriverApp's own fee agreements and their Marketplace review decisions."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _driver_or_403(request.user)
        agreements = (
            ShipmentFeeAgreement.objects.filter(driver=request.user)
            .select_related("shipment", "proposal")
            .order_by("-created_at")[:50]
        )
        shipment_ids = [agreement.shipment_id for agreement in agreements]
        agreement_events = {
            event.shipment_id: event.event_id
            for event in MarketplaceShipmentEvent.objects.filter(
                shipment_id__in=shipment_ids,
                event_type="delivery_fee.agreed",
            )
        }
        reviews = {
            review.agreement_event_id: review
            for review in MarketplaceDeliveryFeeReview.objects.filter(
                shipment_id__in=shipment_ids
            )
        }
        payload = []
        for agreement in agreements:
            event_id = agreement_events.get(agreement.shipment_id)
            review = reviews.get(event_id) if event_id else None
            payload.append(
                {
                    "shipment_id": agreement.shipment_id,
                    "reference": agreement.shipment.external_order_reference,
                    "amount": str(agreement.amount),
                    "currency": agreement.currency,
                    "status": agreement.shipment.fee_agreement_status,
                    "buyer_accepted_at": agreement.buyer_accepted_at,
                    "driver_accepted_at": agreement.driver_accepted_at,
                    "review_decision": review.decision if review else None,
                    "review_message": review.message if review else "",
                    "reviewed_at": review.occurred_at if review else None,
                }
            )
        return Response({"count": len(payload), "agreements": payload})


class DriverPayoutRequestView(APIView):
    """Create a Marketplace payout request for the signed-in driver."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        _driver_or_403(request.user)
        token = marketplace_credential(request)
        if token is None:
            return Response(
                {
                    "detail": (
                        "Open DriverApp from your Marketplace driver account before "
                        "requesting a payout."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        payload = request.data or {}
        idempotency_key = (request.headers.get("Idempotency-Key") or "").strip()
        headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
        try:
            created = marketplace_post(
                MARKETPLACE_PAYOUTS_PATH, token, payload, headers=headers
            )
        except MarketplaceUnauthenticated as error:
            return _marketplace_error_response(error)
        except MarketplaceUnavailable as error:
            return _marketplace_error_response(error)
        record_audit(
            request.user,
            "driver.payout_requested",
            "marketplace_wallet",
            str(created.get("id", "")),
            {"amount": str(payload.get("amount", ""))},
        )
        return Response(created, status=status.HTTP_201_CREATED)


def _results(payload):
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            return results
        return [payload] if payload else []
    if isinstance(payload, list):
        return payload
    return []
