"""Atomic wallet movements for manually verified funding and escrow."""

import secrets
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from users.models import AuditLog

from .chapa import initiate_payout_transfer
from .financial_models import FinancialJournalEntry
from .financial_services import post_journal_entry
from .models import (
    AgreementStatus,
    BusinessAgreement,
    FundingStatus,
    Order,
    OrderPaymentStatus,
    OrderStatus,
    PayoutStatus,
    Wallet,
    WalletFundingRequest,
    WalletPayoutRequest,
    WalletTransaction,
    WalletTransactionType,
)


def transaction_reference(prefix):
    return f"{prefix}-{secrets.token_hex(12).upper()}"


def wallet_for(user, *, lock=False):
    wallet, _ = Wallet.objects.get_or_create(user=user)
    if lock:
        return Wallet.objects.select_for_update().get(pk=wallet.pk)
    return wallet


def driver_delivery_fee_reference(agreement):
    """Stable ledger reference so an approved delivery fee is credited only once."""
    return f"DRIVER-FEE-{agreement.pk}"


@transaction.atomic
def credit_driver_delivery_fee(agreement, financial_manager):
    """Pay an approved delivery fee into the driver's marketplace wallet exactly once.

    The marketplace wallet remains the single authoritative driver balance. Nothing
    here settles an order, releases escrow, or creates a payout; an approved fee only
    becomes spendable balance that the driver can withdraw through the normal payout
    request flow.
    """
    if agreement.driver_payee_id is None:
        return None
    reference = driver_delivery_fee_reference(agreement)
    existing = WalletTransaction.objects.filter(reference=reference).first()
    if existing is not None:
        return existing
    wallet = wallet_for(agreement.driver_payee, lock=True)
    amount = agreement.amount
    if wallet.currency != agreement.currency:
        raise ValidationError(
            {"wallet": "The delivery-fee currency does not match the wallet currency."}
        )
    wallet.available_balance += amount
    wallet.save(update_fields=["available_balance", "updated_at"])
    entry = WalletTransaction.objects.create(
        wallet=wallet,
        order=agreement.order,
        transaction_type=WalletTransactionType.DELIVERY_FEE_EARNING,
        amount=amount,
        available_delta=amount,
        reference=reference,
        external_reference=str(agreement.source_event_id),
        actor=financial_manager,
        description=(
            f"Approved delivery fee for order {agreement.order.reference} "
            f"(driver shipment {agreement.driver_shipment_id})"
        ),
    )
    if not FinancialJournalEntry.objects.filter(idempotency_key=f"driver-fee:{agreement.pk}").exists():
        post_journal_entry(
            reference=f"driver-fee:{agreement.pk}", category="DELIVERY_FEE_EARNING",
            amount=amount, currency=agreement.currency,
            debit_code="EXPENSE:DELIVERY", debit_name="Delivery fee expense", debit_category="EXPENSE",
            credit_code="LIABILITY:DRIVER_WALLET", credit_name="Driver wallet liability", credit_category="LIABILITY",
            source="DELIVERY_FEE_AGREEMENT", source_reference=str(agreement.pk), actor=financial_manager,
            description=f"Approved marketplace delivery fee for order {agreement.order.reference}",
            related_user=agreement.driver_payee,
        )
    AuditLog.objects.create(
        actor=financial_manager,
        action="driver_delivery_fee_credited",
        target=str(agreement.source_event_id),
        detail=(
            f"Credited {amount:.2f} {agreement.currency} to the approved driver "
            f"payee for order {agreement.order.reference}."
        ),
    )
    return entry


def payout_reservation_is_active(payout):
    references = (
        f"PAYOUT-HOLD-{payout.pk}",
        f"PAYOUT-{payout.pk}",
        f"PAYOUT-RETURN-{payout.pk}",
    )
    hold_exists = WalletTransaction.objects.filter(
        wallet_id=payout.wallet_id,
        reference=references[0],
        transaction_type=WalletTransactionType.PAYOUT_RESERVATION,
        amount=payout.amount,
        available_delta=-payout.amount,
        held_delta=payout.amount,
    ).exists()
    settlement_exists = WalletTransaction.objects.filter(
        wallet_id=payout.wallet_id,
        reference__in=references[1:],
    ).exists()
    return hold_exists and not settlement_exists


def reserve_order_funds(order, actor):
    """Move order funds from spendable to held balance exactly once."""
    wallet = wallet_for(order.buyer, lock=True)
    amount = order.payable_amount
    if wallet.available_balance < amount:
        shortfall = amount - wallet.available_balance
        raise ValidationError(
            {
                "wallet": (
                    f"Insufficient available balance. Add at least "
                    f"{shortfall:.2f} ETB before placing this order."
                )
            }
        )
    wallet.available_balance -= amount
    wallet.held_balance += amount
    wallet.save(update_fields=["available_balance", "held_balance", "updated_at"])
    WalletTransaction.objects.create(
        wallet=wallet,
        order=order,
        transaction_type=WalletTransactionType.ORDER_RESERVATION,
        amount=amount,
        available_delta=-amount,
        held_delta=amount,
        reference=transaction_reference("ORDER-HOLD"),
        actor=actor,
        description=f"Escrow held for order {order.reference}",
    )
    post_journal_entry(
        reference=f"order-reservation:{order.pk}", category="ORDER_RESERVATION",
        amount=amount, currency=wallet.currency,
        debit_code="LIABILITY:BUYER_WALLET", debit_name="Buyer wallet liability", debit_category="LIABILITY",
        credit_code="LIABILITY:BUYER_ESCROW", credit_name="Buyer escrow liability", credit_category="LIABILITY",
        source="ORDER_RESERVATION", source_reference=order.reference, actor=actor,
        description=f"Held buyer funds in escrow for order {order.reference}",
    )
    order.payment_status = OrderPaymentStatus.HELD
    order.save(update_fields=["payment_status", "updated_at"])


@transaction.atomic
def release_order_reservation(order, actor, *, transaction_type, description):
    wallet = Wallet.objects.select_for_update().get(user=order.buyer)
    amount = order.payable_amount
    if wallet.held_balance < amount:
        raise ValidationError({"wallet": "Held order funds are not available."})
    wallet.held_balance -= amount
    wallet.available_balance += amount
    wallet.save(update_fields=["held_balance", "available_balance", "updated_at"])
    WalletTransaction.objects.create(
        wallet=wallet,
        order=order,
        transaction_type=transaction_type,
        amount=amount,
        available_delta=amount,
        held_delta=-amount,
        reference=transaction_reference("ORDER-RETURN"),
        actor=actor,
        description=description,
    )
    order.payment_status = OrderPaymentStatus.REFUNDED
    order.save(update_fields=["payment_status", "updated_at"])
    key = f"order-refund:{order.pk}"
    if not FinancialJournalEntry.objects.filter(idempotency_key=key).exists():
        post_journal_entry(
            reference=key, category="ORDER_REFUND", amount=amount, currency=wallet.currency,
            debit_code="LIABILITY:BUYER_ESCROW", debit_name="Buyer escrow liability", debit_category="LIABILITY",
            credit_code="LIABILITY:BUYER_WALLET", credit_name="Buyer wallet liability", credit_category="LIABILITY",
            source="ORDER_REFUND", source_reference=order.reference, actor=actor,
            description=description,
        )
    from .integration import enqueue_payment_snapshot

    enqueue_payment_snapshot(order.pk, actor)


@transaction.atomic
def release_escrow(order, financial_manager, external_reference=""):
    """Pay an approved escrow into the seller's platform wallet once."""
    locked_order = Order.objects.select_for_update().select_related(
        "wholesaler", "farmer", "retailer"
    ).get(pk=order.pk)
    if locked_order.status != OrderStatus.AWAITING_PAYMENT_RELEASE:
        raise ValidationError(
            {"order": "Only quality-confirmed orders can be released."}
        )
    if locked_order.payment_status != OrderPaymentStatus.RELEASE_PENDING:
        raise ValidationError({"payment": "This payment is not awaiting release."})
    if locked_order.dispute_reason:
        raise ValidationError({"order": "A disputed order cannot be released."})

    buyer_wallet = Wallet.objects.select_for_update().get(user=locked_order.buyer)
    amount = locked_order.payable_amount
    if buyer_wallet.held_balance < amount:
        raise ValidationError({"wallet": "Held escrow funds do not cover this order."})
    seller_wallet = wallet_for(locked_order.seller, lock=True)
    buyer_wallet.held_balance -= amount
    buyer_wallet.save(update_fields=["held_balance", "updated_at"])

    WalletTransaction.objects.create(
        wallet=buyer_wallet,
        order=locked_order,
        transaction_type=WalletTransactionType.ESCROW_RELEASE,
        amount=amount,
        held_delta=-amount,
        reference=transaction_reference("ESCROW-OUT"),
        external_reference=external_reference,
        actor=financial_manager,
        description=f"Escrow released for order {locked_order.reference}",
    )
    if not FinancialJournalEntry.objects.filter(idempotency_key=f"escrow-release:{locked_order.pk}").exists():
        post_journal_entry(
            reference=f"escrow-release:{locked_order.pk}", category="ESCROW_RELEASE",
            amount=amount, currency=buyer_wallet.currency,
            debit_code="LIABILITY:BUYER_ESCROW", debit_name="Buyer escrow liability", debit_category="LIABILITY",
            credit_code="LIABILITY:SELLER_WALLET", credit_name="Seller wallet liability", credit_category="LIABILITY",
            source="ORDER_ESCROW", source_reference=locked_order.reference, actor=financial_manager,
            description=f"Escrow released to seller for order {locked_order.reference}", related_user=locked_order.seller,
        )
    locked_order.payment_status = OrderPaymentStatus.RELEASED
    locked_order.status = OrderStatus.COMPLETED
    locked_order.save(update_fields=["payment_status", "status", "updated_at"])
    from .financial_services import post_completed_order

    discount = locked_order.discount_amount or Decimal("0")
    funded_by = (locked_order.discount_snapshot or {}).get("funding_source", "")
    if discount and funded_by == "SELLER":
        # Seller funded: the seller's effective gross is the discounted total.
        snapshot = post_completed_order(
            locked_order, actor=financial_manager, gross_override=amount
        )
        promotion_topup = Decimal("0")
    elif discount and funded_by == "PLATFORM":
        # Platform funded: commission applies to the original gross; the
        # discount itself is booked as Green Path marketing expense below.
        snapshot = post_completed_order(locked_order, actor=financial_manager)
        promotion_topup = discount
    else:
        snapshot = post_completed_order(locked_order, actor=financial_manager)
        promotion_topup = Decimal("0")
    seller_proceeds = snapshot.seller_proceeds
    if promotion_topup > 0:
        post_journal_entry(
            reference=f"order-promotion:{locked_order.pk}",
            category="PROMOTION_EXPENSE",
            amount=promotion_topup, currency=buyer_wallet.currency,
            debit_code="EXPENSE:PROMOTIONS", debit_name="Platform promotion expense",
            debit_category="EXPENSE",
            credit_code="LIABILITY:SELLER_WALLET", credit_name="Seller wallet liability",
            credit_category="LIABILITY",
            source="ORDER_DISCOUNT", source_reference=locked_order.reference,
            actor=financial_manager,
            description=(
                f"Platform funded discount {locked_order.discount_snapshot.get('code')} "
                f"on order {locked_order.reference}"
            ),
            related_user=locked_order.seller,
            order_reference=locked_order.reference,
        )
    if seller_proceeds > 0:
        seller_wallet.available_balance += seller_proceeds
        seller_wallet.save(update_fields=["available_balance", "updated_at"])
        WalletTransaction.objects.create(
            wallet=seller_wallet, order=locked_order,
            transaction_type=WalletTransactionType.ESCROW_RELEASE,
            amount=seller_proceeds, available_delta=seller_proceeds,
            reference=transaction_reference("ESCROW-IN"),
            external_reference=external_reference, actor=financial_manager,
            description=f"Seller proceeds for order {locked_order.reference}",
        )
    BusinessAgreement.objects.filter(order=locked_order).update(
        status=AgreementStatus.COMPLETED,
        completed_at=timezone.now(),
    )
    AuditLog.objects.create(
        actor=financial_manager,
        action="escrow_released",
        target=locked_order.reference,
        detail=f"Released {amount:.2f} ETB; external settlement ref: {external_reference}",
    )
    from .integration import enqueue_payment_snapshot

    enqueue_payment_snapshot(locked_order.pk, financial_manager)
    return locked_order


@transaction.atomic
def flag_funding_request(request_id, financial_manager, *, reason):
    """Mark a deposit for investigation without crediting or rejecting it.

    Flagging is deliberately *not* a rejection: the wallet balance and ledger
    are untouched, the request stays reviewable, and the flag is recorded on
    the request plus the audit trail so a Financial Manager can resolve it
    later with ``review_funding_request``.
    """
    reason = (reason or "").strip()
    if not reason:
        raise ValidationError({"reason": "Provide a reason when flagging a deposit."})
    try:
        funding = WalletFundingRequest.objects.select_for_update().select_related(
            "wallet__user"
        ).get(pk=request_id)
    except (WalletFundingRequest.DoesNotExist, ValueError, TypeError):
        raise NotFound("Funding request not found.")
    if funding.status not in (
        FundingStatus.PENDING,
        FundingStatus.AWAITING_APPROVAL,
    ):
        raise ValidationError(
            {"status": "Only deposits awaiting verification can be flagged."}
        )
    previous_status = funding.status
    funding.status = FundingStatus.FLAGGED
    funding.reviewed_at = timezone.now()
    funding.reviewed_by = financial_manager
    funding.review_notes = reason
    funding.save(
        update_fields=["status", "reviewed_at", "reviewed_by", "review_notes"]
    )
    AuditLog.objects.create(
        actor=financial_manager,
        action="wallet_funding_flagged",
        target=str(funding.pk),
        detail=(
            f"Status: {previous_status} -> {funding.status}; "
            f"amount: {funding.amount:.2f} ETB; "
            f"external reference: {funding.external_reference}; reason: {reason}"
        ),
    )
    return funding


@transaction.atomic
def review_funding_request(request_id, financial_manager, *, approve, notes=""):
    try:
        funding = WalletFundingRequest.objects.select_for_update().select_related(
            "wallet__user"
        ).get(pk=request_id)
    except (WalletFundingRequest.DoesNotExist, ValueError, TypeError):
        raise NotFound("Funding request not found.")
    if funding.status not in (
        FundingStatus.PENDING,
        FundingStatus.AWAITING_APPROVAL,
        FundingStatus.FLAGGED,
    ):
        raise ValidationError({"status": "This funding request has already been reviewed."})
    if funding.payment_method == "Chapa" and approve:
        if not (
            funding.payment_mode == "TEST"
            and funding.payment_verified
            and funding.verified_amount == funding.amount
            and funding.verified_currency == funding.wallet.currency.upper()
            and funding.provider_status.lower() == "success"
        ):
            raise ValidationError(
                {"payment": "Chapa has not independently verified this deposit."}
            )
    funding.reviewed_at = timezone.now()
    funding.reviewed_by = financial_manager
    funding.review_notes = notes.strip()
    if approve:
        wallet = Wallet.objects.select_for_update().get(pk=funding.wallet_id)
        wallet.available_balance += funding.amount
        wallet.save(update_fields=["available_balance", "updated_at"])
        funding.status = (
            FundingStatus.APPROVED
            if funding.payment_method == "Chapa"
            else FundingStatus.VERIFIED
        )
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransactionType.FUNDING,
            amount=funding.amount,
            available_delta=funding.amount,
            reference=f"FUNDING-{funding.pk}",
            external_reference=funding.external_reference,
            actor=financial_manager,
            description=(
                "Financially approved Chapa test-mode deposit"
                if funding.payment_method == "Chapa"
                else "Manually verified wallet funding"
            ),
        )
        clearing_code = "ASSET:CHAPA_CLEARING" if funding.payment_method == "Chapa" else "ASSET:MANUAL_CLEARING"
        clearing_name = "Chapa clearing" if funding.payment_method == "Chapa" else "Manual funding clearing"
        post_journal_entry(
            reference=f"wallet-funding:{funding.pk}",
            category="WALLET_DEPOSIT",
            amount=funding.verified_amount if funding.payment_method == "Chapa" else funding.amount,
            currency=wallet.currency,
            debit_code=clearing_code, debit_name=clearing_name, debit_category="ASSET",
            credit_code="LIABILITY:USER_WALLET", credit_name="User wallet liability", credit_category="LIABILITY",
            source="CHAPA_FUNDING" if funding.payment_method == "Chapa" else "MANUAL_FUNDING",
            source_reference=funding.external_reference, actor=financial_manager,
            description="Verified wallet deposit; not platform revenue.",
        )
    else:
        funding.status = FundingStatus.REJECTED
    funding.save(
        update_fields=["status", "reviewed_at", "reviewed_by", "review_notes"]
    )
    AuditLog.objects.create(
        actor=financial_manager,
        action=(
            "wallet_funding_approved"
            if approve and funding.payment_method == "Chapa"
            else "wallet_funding_verified"
            if approve
            else "wallet_funding_rejected"
        ),
        target=str(funding.pk),
        detail=f"{funding.amount:.2f} ETB; {funding.external_reference}; {notes.strip()}",
    )
    return funding


@transaction.atomic
def review_payout_request(
    request_id, financial_manager, *, approve, external_reference="", notes=""
):
    try:
        payout = WalletPayoutRequest.objects.select_for_update().select_related(
            "wallet__user", "payout_account__bank"
        ).get(pk=request_id)
    except (WalletPayoutRequest.DoesNotExist, ValueError, TypeError):
        raise NotFound("Payout request not found.")
    if payout.status != PayoutStatus.PENDING:
        raise ValidationError({"status": "This payout request has already been reviewed."})
    previous_status = payout.status
    wallet = Wallet.objects.select_for_update().get(pk=payout.wallet_id)
    if not payout_reservation_is_active(payout):
        raise ValidationError(
            {"wallet": "This payout does not have an active reservation ledger entry."}
        )
    if wallet.held_balance < payout.amount:
        raise ValidationError({"wallet": "Held payout funds are not available."})
    if approve:
        external_reference = external_reference.strip()
        notes = notes.strip()
        automatic_transfer = bool(
            payout.payout_account_id
            and not external_reference
            and settings.CHAPA_TEST_MODE
            and settings.CHAPA_SECRET_KEY.startswith("CHASECK_TEST-")
        )
        if automatic_transfer:
            external_reference = initiate_payout_transfer(payout)
            if not notes:
                notes = "Approved and disbursed through the Chapa sandbox transfer rail."
        else:
            if not external_reference:
                raise ValidationError(
                    {"external_reference": "Enter the verified bank or transfer reference."}
                )
            if not notes:
                raise ValidationError(
                    {
                        "notes": (
                            "Record the external confirmation evidence checked before "
                            "marking this payout paid."
                        )
                    }
                )
        wallet.held_balance -= payout.amount
        wallet.save(update_fields=["held_balance", "updated_at"])
        payout.status = PayoutStatus.PAID
        payout.external_reference = external_reference
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransactionType.PAYOUT,
            amount=payout.amount,
            held_delta=-payout.amount,
            reference=f"PAYOUT-{payout.pk}",
            external_reference=external_reference,
            actor=financial_manager,
            description=(
                "Chapa sandbox payout disbursed after financial approval"
                if automatic_transfer
                else "Manually settled wallet payout"
            ),
        )
    else:
        wallet.held_balance -= payout.amount
        wallet.available_balance += payout.amount
        wallet.save(
            update_fields=["held_balance", "available_balance", "updated_at"]
        )
        payout.status = PayoutStatus.REJECTED
        WalletTransaction.objects.create(
            wallet=wallet,
            transaction_type=WalletTransactionType.RESERVATION_RELEASE,
            amount=payout.amount,
            available_delta=payout.amount,
            held_delta=-payout.amount,
            reference=f"PAYOUT-RETURN-{payout.pk}",
            actor=financial_manager,
            description="Rejected payout returned to available balance",
        )
    if approve:
        post_journal_entry(
            reference=f"payout:{payout.pk}", category="PAYOUT_DISBURSEMENT",
            amount=payout.amount, currency=wallet.currency,
            debit_code="LIABILITY:USER_WALLET", debit_name="User wallet liability", debit_category="LIABILITY",
            credit_code="ASSET:SETTLEMENT_CLEARING", credit_name="Settlement clearing", credit_category="ASSET",
            source="WALLET_PAYOUT", source_reference=external_reference, actor=financial_manager,
            description="Verified wallet payout settlement; not an expense.",
            related_user=wallet.user,
        )
    payout.reviewed_at = timezone.now()
    payout.reviewed_by = financial_manager
    payout.review_notes = notes.strip()
    payout.save(
        update_fields=[
            "status", "reviewed_at", "reviewed_by", "external_reference",
            "review_notes",
        ]
    )
    AuditLog.objects.create(
        actor=financial_manager,
        action="wallet_payout_paid" if approve else "wallet_payout_rejected",
        target=str(payout.pk),
        detail=(
            f"Status: {previous_status} -> {payout.status}; "
            f"amount: {payout.amount:.2f} ETB; "
            f"external reference: {external_reference}; reason/note: {notes.strip()}"
        ),
    )
    return payout
