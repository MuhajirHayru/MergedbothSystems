"""Wallet escrow, manual settlement and verified-review workflow tests."""
from decimal import Decimal

import pytest

from users.models import AuditLog

from payments.models import (
    BusinessAgreement,
    Order,
    OrderPaymentStatus,
    OrderStatus,
    Review,
    Wallet,
    WalletTransaction,
    WalletFundingRequest,
    WalletPayoutRequest,
)

pytestmark = pytest.mark.django_db


def test_order_requires_funded_wallet_without_reserving_stock(
    api, wholesaler, farmer_product
):
    wallet = Wallet.objects.get(user=wholesaler)
    wallet.available_balance = Decimal("0")
    wallet.save(update_fields=["available_balance"])

    api.force_authenticate(user=wholesaler)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.id), "quantity": "2"},
        format="json",
    )

    assert response.status_code == 400
    assert Order.objects.count() == 0
    farmer_product.refresh_from_db()
    wallet.refresh_from_db()
    assert farmer_product.quantity == Decimal("200")
    assert wallet.available_balance == Decimal("0")
    assert wallet.held_balance == Decimal("0")


def test_retailer_can_purchase_wholesaler_listing(api, retailer, wholesaler_product):
    api.force_authenticate(user=retailer)
    response = api.post(
        "/api/v1/orders/",
        {"product": str(wholesaler_product.id), "quantity": "3"},
        format="json",
    )

    assert response.status_code == 201, response.data
    order = Order.objects.get()
    assert order.retailer_id == retailer.id
    assert order.farmer_id is None
    assert order.seller.pk == wholesaler_product.owner_id
    assert order.status == OrderStatus.PENDING_SELLER_APPROVAL
    wallet = Wallet.objects.get(user=retailer)
    assert wallet.available_balance == Decimal("99910.00")
    assert wallet.held_balance == Decimal("90.00")


def test_funding_is_pending_until_finance_verifies(api, farmer, financial_manager):
    api.force_authenticate(user=farmer)
    response = api.post(
        "/api/v1/wallet/funding/",
        {
            "amount": "250.00",
            "payment_method": "Telebirr",
            "external_reference": "TEL-VERIFY-001",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    funding_id = response.data["id"]
    wallet = Wallet.objects.get(user=farmer)
    assert wallet.available_balance == 0
    assert not WalletTransaction.objects.filter(wallet=wallet).exists()

    api.force_authenticate(user=financial_manager)
    review = api.post(
        f"/api/v1/wallet/funding/{funding_id}/review/",
        {"approve": True, "notes": "Transfer confirmed"},
        format="json",
    )
    assert review.status_code == 200, review.data
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("250.00")
    assert WalletTransaction.objects.filter(
        wallet=wallet, transaction_type="FUNDING"
    ).count() == 1


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/wallet/funding/00000000-0000-0000-0000-000000000000/review/",
            {"approve": False, "notes": "Not found"},
        ),
        (
            "/api/v1/wallet/payouts/00000000-0000-0000-0000-000000000000/review/",
            {"approve": False, "notes": "Not found"},
        ),
    ],
)
def test_wallet_reviews_return_404_for_missing_requests(
    api, financial_manager, path, payload
):
    api.force_authenticate(user=financial_manager)
    response = api.post(path, payload, format="json")
    assert response.status_code == 404, response.data


def test_funding_approval_is_single_credit_and_refreshes_financial_manager_queue(
    api, farmer, financial_manager
):
    wallet = Wallet.objects.create(user=farmer, available_balance="35.00", held_balance="12.00")
    funding = WalletFundingRequest.objects.create(
        wallet=wallet,
        amount="80.00",
        payment_method="Bank Transfer",
        external_reference="APPROVE-FUNDING-INTEGRATION-001",
    )
    api.force_authenticate(user=financial_manager)

    queue_before = api.get("/api/v1/wallet/funding/")
    assert queue_before.status_code == 200
    assert str(funding.pk) in {row["id"] for row in queue_before.data["results"]}

    response = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": True, "notes": "Test transfer confirmed."},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert response.data["funding_request"]["status"] == "VERIFIED"
    wallet.refresh_from_db()
    funding.refresh_from_db()
    assert wallet.available_balance == Decimal("115.00")
    assert wallet.held_balance == Decimal("12.00")
    assert funding.reviewed_by_id == financial_manager.pk
    assert funding.review_notes == "Test transfer confirmed."
    transactions = WalletTransaction.objects.filter(
        wallet=wallet, transaction_type="FUNDING", reference=f"FUNDING-{funding.pk}"
    )
    assert transactions.count() == 1
    transaction = transactions.get()
    assert transaction.amount == Decimal("80.00")
    assert transaction.available_delta == Decimal("80.00")
    assert AuditLog.objects.filter(
        actor=financial_manager,
        action="wallet_funding_verified",
        target=str(funding.pk),
    ).count() == 1

    duplicate = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": True, "notes": "Duplicate approval must fail."},
        format="json",
    )
    assert duplicate.status_code == 400
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("115.00")
    assert transactions.count() == 1
    assert AuditLog.objects.filter(
        actor=financial_manager,
        action="wallet_funding_verified",
        target=str(funding.pk),
    ).count() == 1

    pending_after = api.get("/api/v1/wallet/funding/?status=PENDING")
    assert pending_after.status_code == 200
    assert str(funding.pk) not in {row["id"] for row in pending_after.data["results"]}
    operations = api.get("/api/v1/dashboard/financial-operations/")
    assert operations.status_code == 200
    role = operations.data["wallets"]["by_role"]["FARMER"]
    assert Decimal(role["available_balance"]) >= Decimal("115.00")


def test_funding_rejection_preserves_balance_and_records_review(
    api, farmer, financial_manager
):
    wallet = Wallet.objects.create(user=farmer, available_balance="35.00")
    funding = WalletFundingRequest.objects.create(
        wallet=wallet,
        amount="80.00",
        payment_method="Bank Transfer",
        external_reference="REJECT-FUNDING-001",
    )
    api.force_authenticate(user=financial_manager)
    response = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": False, "notes": "Transfer evidence is invalid."},
        format="json",
    )
    assert response.status_code == 200, response.data
    funding.refresh_from_db()
    wallet.refresh_from_db()
    assert funding.status == "REJECTED"
    assert funding.reviewed_by_id == financial_manager.pk
    assert funding.review_notes == "Transfer evidence is invalid."
    assert wallet.available_balance == Decimal("35.00")
    assert not WalletTransaction.objects.filter(wallet=wallet).exists()
    assert AuditLog.objects.filter(
        actor=financial_manager, action="wallet_funding_rejected", target=str(funding.pk)
    ).count() == 1
    queue = api.get("/api/v1/wallet/funding/?status=PENDING")
    assert queue.status_code == 200
    assert str(funding.pk) not in {row["id"] for row in queue.data["results"]}
    duplicate = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": False, "notes": "Duplicate rejection must fail."},
        format="json",
    )
    assert duplicate.status_code == 400
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("35.00")
    assert AuditLog.objects.filter(
        actor=financial_manager, action="wallet_funding_rejected", target=str(funding.pk)
    ).count() == 1


def test_funding_rejection_requires_reason_and_preserves_pending_request(
    api, farmer, financial_manager
):
    wallet = Wallet.objects.create(user=farmer, available_balance="35.00")
    funding = WalletFundingRequest.objects.create(
        wallet=wallet,
        amount="80.00",
        payment_method="Bank Transfer",
        external_reference="REJECT-FUNDING-INTEGRATION-002",
    )
    api.force_authenticate(user=financial_manager)
    response = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": False, "notes": "  "},
        format="json",
    )
    assert response.status_code == 400
    funding.refresh_from_db()
    wallet.refresh_from_db()
    assert funding.status == "PENDING"
    assert wallet.available_balance == Decimal("35.00")
    assert not WalletTransaction.objects.filter(wallet=wallet).exists()
    assert not AuditLog.objects.filter(target=str(funding.pk)).exists()


def test_payout_review_requires_financial_manager_role(api, farmer):
    api.force_authenticate(user=farmer)
    response = api.post(
        "/api/v1/wallet/payouts/00000000-0000-0000-0000-000000000000/review/",
        {"approve": False, "notes": "Not allowed"},
        format="json",
    )
    assert response.status_code == 403


def test_payout_reservation_is_returned_when_finance_rejects(
    api, farmer, financial_manager
):
    wallet = Wallet.objects.create(user=farmer, available_balance="500.00")
    api.force_authenticate(user=farmer)
    response = api.post(
        "/api/v1/wallet/payouts/",
        {"amount": "125.00", "destination": "Telebirr 0911000000"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="payout-test-key",
    )
    assert response.status_code == 201, response.data
    payout_id = response.data["id"]
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("375.00")
    assert wallet.held_balance == Decimal("125.00")

    duplicate_submission = api.post(
        "/api/v1/wallet/payouts/",
        {"amount": "125.00", "destination": "Telebirr 0911000000"},
        format="json",
        HTTP_IDEMPOTENCY_KEY="payout-test-key",
    )
    assert duplicate_submission.status_code == 200, duplicate_submission.data
    assert duplicate_submission.data["id"] == payout_id
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("375.00")
    assert wallet.held_balance == Decimal("125.00")

    api.force_authenticate(user=financial_manager)
    reviewed = api.post(
        f"/api/v1/wallet/payouts/{payout_id}/review/",
        {"approve": False, "notes": "Destination could not be verified"},
        format="json",
    )
    assert reviewed.status_code == 200, reviewed.data
    wallet.refresh_from_db()
    assert wallet.available_balance == Decimal("500.00")
    assert wallet.held_balance == Decimal("0")


def test_order_escrow_release_is_exactly_once_and_review_is_verified(
    api, wholesaler, farmer, farmer_product, financial_manager
):
    api.force_authenticate(user=wholesaler)
    created = api.post(
        "/api/v1/orders/",
        {"product": str(farmer_product.id), "quantity": "4"},
        format="json",
    )
    assert created.status_code == 201, created.data
    order = Order.objects.get()
    assert order.payment_status == OrderPaymentStatus.HELD

    api.force_authenticate(user=farmer)
    for next_status in (OrderStatus.ACCEPTED, OrderStatus.PROCESSING, OrderStatus.SHIPPED):
        result = api.patch(
            f"/api/v1/orders/{order.id}/status/",
            {"status": next_status},
            format="json",
        )
        assert result.status_code == 200, result.data

    api.force_authenticate(user=wholesaler)
    delivered = api.patch(
        f"/api/v1/orders/{order.id}/status/",
        {"status": OrderStatus.DELIVERED},
        format="json",
    )
    assert delivered.status_code == 200, delivered.data
    confirmed = api.post(f"/api/v1/orders/{order.id}/confirm-quality/")
    assert confirmed.status_code == 200, confirmed.data
    assert BusinessAgreement.objects.get(order=order).status == "ACTIVE"

    api.force_authenticate(user=financial_manager)
    released = api.post(
        f"/api/v1/orders/{order.id}/release/",
        {"external_reference": "BANK-SETTLEMENT-001"},
        format="json",
    )
    assert released.status_code == 200, released.data
    order.refresh_from_db()
    assert order.status == OrderStatus.COMPLETED
    assert order.payment_status == OrderPaymentStatus.RELEASED
    farmer_wallet = Wallet.objects.get(user=farmer)
    assert farmer_wallet.available_balance == Decimal("100.00")

    api.force_authenticate(user=wholesaler)
    order_receipt = api.get(f"/api/v1/orders/{order.id}/receipt/")
    assert order_receipt.status_code == 200, order_receipt.data
    assert order_receipt.data["receipt"]["order_reference"] == order.reference
    assert order_receipt.data["receipt"]["escrow_released"] == str(order.payable_amount)
    assert order_receipt.data["receipt"]["seller_proceeds"] == "100.00"

    api.force_authenticate(user=financial_manager)
    duplicate = api.post(
        f"/api/v1/orders/{order.id}/release/",
        {"external_reference": "BANK-SETTLEMENT-001"},
        format="json",
    )
    assert duplicate.status_code == 400
    farmer_wallet.refresh_from_db()
    assert farmer_wallet.available_balance == Decimal("100.00")

    api.force_authenticate(user=wholesaler)
    review = api.post(
        "/api/v1/wallet/reviews/",
        {"order": str(order.id), "rating": 5, "comment": "Good quality"},
        format="json",
    )
    assert review.status_code == 201, review.data
    assert Review.objects.filter(order=order, reviewer=wholesaler, reviewee=farmer).exists()

    listing = api.get(f"/api/v1/products/farmer-listings/{farmer_product.id}/")
    assert listing.status_code == 200, listing.data
    assert listing.data["owner_average_rating"] == 5.0
    assert listing.data["owner_review_count"] == 1
