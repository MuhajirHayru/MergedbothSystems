"""Regression tests for the frontend/backend integration gaps.

Covers the deposit flagging workflow (flag is not a rejection), bilingual
product titles, and self-service business profile persistence.
"""

from decimal import Decimal

import pytest

from payments.models import (
    FundingStatus,
    Wallet,
    WalletFundingRequest,
    WalletTransaction,
)
from products.models import Product
from users.models import AuditLog

pytestmark = pytest.mark.django_db


def test_flagging_a_deposit_is_not_a_rejection(api, farmer, financial_manager):
    wallet = Wallet.objects.create(user=farmer, available_balance="10.00")
    funding = WalletFundingRequest.objects.create(
        wallet=wallet,
        amount="120.00",
        payment_method="Bank Transfer",
        external_reference="FLAG-TEST-001",
    )
    api.force_authenticate(user=financial_manager)
    response = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/flag/",
        {"reason": "Bank slip needs confirmation."},
        format="json",
    )
    assert response.status_code == 200, response.data
    funding.refresh_from_db()
    wallet.refresh_from_db()
    assert funding.status == FundingStatus.FLAGGED
    assert funding.review_notes == "Bank slip needs confirmation."
    assert funding.reviewed_by_id == financial_manager.pk
    assert wallet.available_balance == Decimal("10.00")
    assert not WalletTransaction.objects.filter(wallet=wallet).exists()
    assert AuditLog.objects.filter(
        actor=financial_manager,
        action="wallet_funding_flagged",
        target=str(funding.pk),
    ).exists()

    # A flagged deposit stays resolvable: finance can still verify it.
    response = api.post(
        f"/api/v1/wallet/funding/{funding.pk}/review/",
        {"approve": True, "notes": "Slip confirmed."},
        format="json",
    )
    assert response.status_code == 200, response.data
    funding.refresh_from_db()
    wallet.refresh_from_db()
    assert funding.status == FundingStatus.VERIFIED
    assert wallet.available_balance == Decimal("130.00")


def test_flag_requires_reason_and_financial_manager(api, farmer, financial_manager):
    wallet = Wallet.objects.create(user=farmer)
    funding = WalletFundingRequest.objects.create(
        wallet=wallet,
        amount="50.00",
        payment_method="Bank Transfer",
        external_reference="FLAG-TEST-002",
    )
    api.force_authenticate(user=farmer)
    denied = api.post(f"/api/v1/wallet/funding/{funding.pk}/flag/", {"reason": "x"}, format="json")
    assert denied.status_code == 403

    api.force_authenticate(user=financial_manager)
    blank = api.post(f"/api/v1/wallet/funding/{funding.pk}/flag/", {"reason": "  "}, format="json")
    assert blank.status_code == 400
    funding.refresh_from_db()
    assert funding.status == FundingStatus.PENDING


def test_corrupt_document_upload_returns_400_not_500(api, farmer):
    """PIL raises a bare SyntaxError on a bad PNG checksum; it must be a 400."""
    from django.core.files.uploadedfile import SimpleUploadedFile

    registration = getattr(farmer, "registration", None)
    if registration is None:
        from registrations.models import UserRegistration

        registration = UserRegistration.objects.create(user=farmer)
    api.force_authenticate(user=farmer)
    upload = SimpleUploadedFile(
        "license.png", b"\x89PNG\r\n\x1a\nGARBAGE", content_type="image/png"
    )
    response = api.post(
        "/api/v1/registration/me/documents/",
        {"file": upload, "document_type": "FARMER_LICENSE"},
        format="multipart",
    )
    assert response.status_code == 400, response.data
    assert "file" in response.data["error"]


def test_listing_keeps_amharic_and_oromo_titles(api, farmer):
    api.force_authenticate(user=farmer)
    response = api.post(
        "/api/v1/products/farmer-listings/",
        {
            "title": "Highland Tomatoes",
            "name_am": "የደጋ ቲማቲም",
            "name_om": "Timaatima Gaaraa",
            "category": "Vegetables",
            "quantity": "20.00",
            "unit_of_measure": "kg",
            "price_per_unit": "40.00",
            "images": [],
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    listing = Product.objects.get(pk=response.data["id"])
    assert listing.name_am == "የደጋ ቲማቲም"
    assert listing.name_om == "Timaatima Gaaraa"
    assert response.data["name_am"] == "የደጋ ቲማቲም"


def test_business_name_and_address_persist_on_the_dossier(api, wholesaler):
    from registrations.models import UserRegistration

    UserRegistration.objects.get_or_create(user=wholesaler)
    api.force_authenticate(user=wholesaler)
    response = api.patch(
        "/api/v1/auth/profile/",
        {
            "business_name": "Meki Fresh Wholesale PLC",
            "business_address": "Meki, East Shewa, Oromia",
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    registration = UserRegistration.objects.get(user=wholesaler)
    assert registration.business_name == "Meki Fresh Wholesale PLC"
    assert registration.business_address == "Meki, East Shewa, Oromia"
    assert response.data["user"]["business_name"] == "Meki Fresh Wholesale PLC"
