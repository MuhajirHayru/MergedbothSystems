"""Chapa sandbox payout transfer coverage for approved payout invoices."""

from decimal import Decimal

import pytest

from payments.bank_accounts import encrypt_account_number
from payments.chapa import ChapaGatewayError
from payments.models import (
    BankAccount,
    PayoutBank,
    PayoutStatus,
    Wallet,
    WalletPayoutRequest,
    WalletTransaction,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def registered_bank(db):
    bank, _ = PayoutBank.objects.get_or_create(
        code="commercial-bank-of-ethiopia",
        defaults={
            "name": "Commercial Bank of Ethiopia",
            "source_url": "https://nbe.gov.et/financial-institutions/banks/",
        },
    )
    return bank


def create_payout(user, bank, *, amount="40.00"):
    wallet, _ = Wallet.objects.get_or_create(
        user=user, defaults={"available_balance": Decimal("100.00")}
    )
    encrypted, last4 = encrypt_account_number("1000123456789")
    account = BankAccount.objects.create(
        user=user,
        bank=bank,
        account_holder_name=user.full_name,
        account_number_encrypted=encrypted,
        account_number_last4=last4,
    )
    amount = Decimal(amount)
    wallet.available_balance = max(wallet.available_balance, amount)
    wallet.available_balance -= amount
    wallet.held_balance += amount
    wallet.save(update_fields=["available_balance", "held_balance"])
    payout = WalletPayoutRequest.objects.create(
        wallet=wallet,
        amount=amount,
        destination="Commercial Bank of Ethiopia account",
        payout_account=account,
    )
    WalletTransaction.objects.create(
        wallet=wallet,
        transaction_type="PAYOUT_RESERVATION",
        amount=amount,
        available_delta=-amount,
        held_delta=amount,
        reference=f"PAYOUT-HOLD-{payout.pk}",
        actor=user,
    )
    return payout


def test_registered_payout_is_sent_through_chapa(
    api, farmer, financial_manager, registered_bank, monkeypatch
):
    payout = create_payout(farmer, registered_bank)
    calls = []

    def transfer(method, path, payload=None):
        calls.append((method, path, payload))
        return {"status": "success", "data": f"CHAPA-{payout.pk}"}

    monkeypatch.setattr("payments.chapa._chapa_request", transfer)
    api.force_authenticate(user=financial_manager)

    response = api.post(
        f"/api/v1/wallet/payouts/{payout.pk}/review/",
        {"approve": True},
        format="json",
    )

    assert response.status_code == 200, response.data
    assert calls == [
        (
            "POST",
            "/transfers",
            {
                "account_name": farmer.full_name,
                "account_number": "1000123456789",
                "amount": "40.00",
                "currency": "ETB",
                "reference": f"GREENPATH-PAYOUT-{payout.pk}",
                "bank_code": 946,
            },
        )
    ]
    payout.refresh_from_db()
    payout.wallet.refresh_from_db()
    assert payout.status == PayoutStatus.PAID
    assert payout.external_reference == f"CHAPA-{payout.pk}"
    assert payout.wallet.held_balance == Decimal("0.00")
    assert WalletTransaction.objects.filter(
        wallet=payout.wallet,
        reference=f"PAYOUT-{payout.pk}",
        external_reference=f"CHAPA-{payout.pk}",
    ).exists()


def test_chapa_transfer_failure_keeps_payout_reserved(
    api, farmer, financial_manager, registered_bank, monkeypatch
):
    payout = create_payout(farmer, registered_bank)
    wallet = payout.wallet

    def reject(method, path, payload=None):
        raise ChapaGatewayError("Chapa sandbox transfer failed.")

    monkeypatch.setattr("payments.chapa._chapa_request", reject)
    api.force_authenticate(user=financial_manager)

    response = api.post(
        f"/api/v1/wallet/payouts/{payout.pk}/review/",
        {"approve": True},
        format="json",
    )

    assert response.status_code == 502
    payout.refresh_from_db()
    wallet.refresh_from_db()
    assert payout.status == PayoutStatus.PENDING
    assert payout.external_reference == ""
    assert wallet.held_balance == Decimal("40.00")
    assert not WalletTransaction.objects.filter(
        wallet=wallet, reference=f"PAYOUT-{payout.pk}"
    ).exists()
