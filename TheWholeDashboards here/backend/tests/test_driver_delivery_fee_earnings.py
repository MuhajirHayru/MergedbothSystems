"""Driver delivery-fee earnings: marketplace-authoritative driver wallet credits."""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.management.base import CommandError
from django.utils import timezone

from payments.models import (
    MarketplaceDeliveryFeeAgreement,
    OrderShipmentDetails,
    Wallet,
    WalletPayoutRequest,
    WalletTransaction,
    WalletTransactionType,
)
from payments.financial_models import DeliveryFeePayment
from payments.freight_models import FreightJob
from payments.shipment_feed import _apply_page
from registrations.models import AdministrativeLocation, LocationLevel
from tests.conftest import make_user
from tests.test_shipment_feed import authorized_shipment, page_for, shipment_event
from users.models import AuditLog, Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def driver(db):
    return make_user(Role.DRIVER, "driver@test.et", "Dawit Driver", location="Amhara")


@pytest.fixture
def shipment_details(order):
    region = AdministrativeLocation.objects.create(
        source_id="driver-fee-region",
        name="Driver Fee Region",
        level=LocationLevel.REGION,
    )
    now = timezone.now()
    return OrderShipmentDetails.objects.create(
        order=order,
        pickup_region=region,
        pickup_address_line="Pickup",
        destination_region=region,
        destination_address_line="Destination",
        cargo_weight_kg="12.50",
        packaging_details="Sealed crates",
        delivery_fee_proposal_amount="250.00",
        delivery_fee_proposal_currency="ETB",
        delivery_fee_proposal_version=1,
        buyer_confirmed_revision=1,
        seller_confirmed_revision=1,
        authorized_at=now,
        driver_shipment_id=42,
    )


@pytest.fixture
def delivery_fee_agreement(order, driver, shipment_details):
    now = timezone.now()
    return MarketplaceDeliveryFeeAgreement.objects.create(
        order=order,
        source_event_id=uuid.uuid4(),
        driver_shipment_id=42,
        driver_payee=driver,
        driver_external_user_id=str(driver.pk),
        driver_proposal_version=1,
        amount="250.00",
        currency="ETB",
        buyer_accepted_at=now,
        driver_accepted_at=now,
    )


def review_url(agreement):
    return f"/api/v1/payments/delivery-fee-agreements/{agreement.pk}/review/"


def test_approval_records_terms_without_early_driver_payment(
    api, financial_manager, delivery_fee_agreement, driver
):
    api.force_authenticate(user=financial_manager)

    response = api.post(
        review_url(delivery_fee_agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert not WalletTransaction.objects.filter(
        transaction_type=WalletTransactionType.DELIVERY_FEE_EARNING
    ).exists()
    wallet = Wallet.objects.filter(user=driver).first()
    assert wallet is None or wallet.available_balance == Decimal("0.00")


def test_approved_delivery_is_credited_only_after_verified_collection_and_delivery(
    api, financial_manager, delivery_fee_agreement, driver
):
    api.force_authenticate(user=financial_manager)
    payload = {"decision": "approved", "proposal_version": 1}

    first = api.post(review_url(delivery_fee_agreement), payload, format="json")
    retry = api.post(review_url(delivery_fee_agreement), payload, format="json")

    assert first.status_code == 201
    assert retry.status_code == 200
    assert not WalletTransaction.objects.filter(
        transaction_type=WalletTransactionType.DELIVERY_FEE_EARNING
    ).exists()
    fee_payment = DeliveryFeePayment.objects.create(
        agreement=delivery_fee_agreement, pricing_model="A", fee_type="FIXED",
        fee_value="50.00", customer_amount="250.00", driver_charge="200.00",
        platform_fee="50.00", payment_reference="DELIVERY-COLLECTED-1",
        status=DeliveryFeePayment.Status.VERIFIED,
    )
    FreightJob.objects.create(
        order=delivery_fee_agreement.order, status=FreightJob.Status.COMPLETED,
        assigned_driver=driver, delivery_status="DELIVERED",
    )
    from payments.financial_services import credit_driver_for_verified_delivery
    first_credit = credit_driver_for_verified_delivery(fee_payment, actor=financial_manager)
    retry_credit = credit_driver_for_verified_delivery(fee_payment, actor=financial_manager)
    assert first_credit.pk == retry_credit.pk
    assert WalletTransaction.objects.filter(reference=f"DRIVER-DELIVERY-PAYMENT-{fee_payment.pk}").count() == 1
    assert Wallet.objects.get(user=driver).available_balance == Decimal("200.00")
    fee_payment.refresh_from_db()
    assert fee_payment.compensation_payment_reference == f"WALLET:{fee_payment.payment_reference}"


def test_rejection_leaves_the_driver_wallet_untouched(
    api, financial_manager, delivery_fee_agreement, driver
):
    api.force_authenticate(user=financial_manager)

    response = api.post(
        review_url(delivery_fee_agreement),
        {
            "decision": "rejected",
            "proposal_version": 1,
            "rejection_reason": "The agreed fee needs correction.",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    assert WalletTransaction.objects.filter(
        transaction_type=WalletTransactionType.DELIVERY_FEE_EARNING
    ).count() == 0
    wallet = Wallet.objects.filter(user=driver).first()
    assert wallet is None or wallet.available_balance == Decimal("0.00")


def test_approval_without_a_resolved_payee_credits_nobody(
    api, financial_manager, order, shipment_details
):
    now = timezone.now()
    agreement = MarketplaceDeliveryFeeAgreement.objects.create(
        order=order,
        source_event_id=uuid.uuid4(),
        driver_shipment_id=42,
        driver_proposal_version=1,
        amount="250.00",
        currency="ETB",
        buyer_accepted_at=now,
        driver_accepted_at=now,
    )
    api.force_authenticate(user=financial_manager)

    response = api.post(
        review_url(agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert WalletTransaction.objects.filter(
        transaction_type=WalletTransactionType.DELIVERY_FEE_EARNING
    ).count() == 0


def test_driver_can_read_their_own_wallet(api, driver):
    api.force_authenticate(user=driver)

    response = api.get("/api/v1/wallet/")

    assert response.status_code == 200, response.data
    assert response.data["currency"] == "ETB"
    assert Decimal(str(response.data["available_balance"])) == Decimal("0.00")


def test_driver_cannot_withdraw_uncollected_or_undelivered_fee(
    api, financial_manager, delivery_fee_agreement, driver
):
    api.force_authenticate(user=financial_manager)
    api.post(
        review_url(delivery_fee_agreement),
        {"decision": "approved", "proposal_version": 1},
        format="json",
    )
    api.force_authenticate(user=driver)

    response = api.post(
        "/api/v1/wallet/payouts/",
        {"amount": "100.00", "destination": "Commercial Bank of Ethiopia 1234"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="driver-fee-payout-1",
    )

    assert response.status_code == 400, response.data
    assert WalletPayoutRequest.objects.count() == 0
    wallet = Wallet.objects.filter(user=driver).first()
    assert wallet is None or wallet.available_balance == Decimal("0.00")


def test_driver_cannot_read_another_participants_wallet(api, driver, wholesaler):
    api.force_authenticate(user=driver)

    response = api.get("/api/v1/wallet/transactions/")

    assert response.status_code == 200
    assert list(response.data["results"]) == []


def test_shipment_feed_resolves_the_driver_payee_from_the_canonical_id(
    order, driver, authorized_shipment
):
    accepted_at = (timezone.now() - timedelta(minutes=1)).isoformat()
    assigned = shipment_event(order.pk, cursor=1, status="assigned")
    event = shipment_event(order.pk, cursor=2, status="assigned")
    event["event_type"] = "delivery_fee.agreed"
    event["details"] = {
        "amount": "375.00",
        "currency": "ETB",
        "proposal_version": 2,
        "buyer_accepted_at": accepted_at,
        "driver_accepted_at": accepted_at,
        "driver_external_user_id": str(driver.pk),
    }

    _apply_page(page_for(assigned, event), 0)

    agreement = MarketplaceDeliveryFeeAgreement.objects.get(order=order)
    assert agreement.driver_payee_id == driver.pk
    assert agreement.driver_external_user_id == str(driver.pk)


def test_shipment_feed_fails_closed_for_an_unknown_driver_identity(
    order, authorized_shipment
):
    accepted_at = (timezone.now() - timedelta(minutes=1)).isoformat()
    assigned = shipment_event(order.pk, cursor=1, status="assigned")
    event = shipment_event(order.pk, cursor=2, status="assigned")
    event["event_type"] = "delivery_fee.agreed"
    event["details"] = {
        "amount": "375.00",
        "currency": "ETB",
        "proposal_version": 2,
        "buyer_accepted_at": accepted_at,
        "driver_accepted_at": accepted_at,
        "driver_external_user_id": str(uuid.uuid4()),
    }

    with pytest.raises(CommandError, match="unknown marketplace driver"):
        _apply_page(page_for(assigned, event), 0)


def test_shipment_feed_still_accepts_the_legacy_event_without_a_driver_identity(
    order, authorized_shipment
):
    accepted_at = (timezone.now() - timedelta(minutes=1)).isoformat()
    assigned = shipment_event(order.pk, cursor=1, status="assigned")
    event = shipment_event(order.pk, cursor=2, status="assigned")
    event["event_type"] = "delivery_fee.agreed"
    event["details"] = {
        "amount": "375.00",
        "currency": "ETB",
        "proposal_version": 2,
        "buyer_accepted_at": accepted_at,
        "driver_accepted_at": accepted_at,
    }

    _apply_page(page_for(assigned, event), 0)

    agreement = MarketplaceDeliveryFeeAgreement.objects.get(order=order)
    assert agreement.driver_payee_id is None
    assert agreement.driver_external_user_id == ""
