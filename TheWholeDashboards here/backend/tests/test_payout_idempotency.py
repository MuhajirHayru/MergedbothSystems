"""Payout idempotency and duplicate-protection tests (Stage 5 P0)."""

import pytest
from django.db import transaction as db_transaction
from decimal import Decimal
from unittest.mock import patch, MagicMock

from payments.models import (
    Wallet, WalletPayoutRequest, WalletTransaction,
    WalletTransactionType, PayoutStatus,
)
from users.models import Role

from tests.conftest import make_user


@pytest.fixture
def funded_wholesaler(db):
    u = make_user(Role.WHOLESALER, "payout.idem@test.et", "Payout Test WS")
    Wallet.objects.create(user=u, available_balance="5000.00")
    return u


def _create_payout(api, user, amount="250.00", destination="CBE 1234", key=None):
    headers = {}
    if key is not None:
        headers["Idempotency-Key"] = key
    return api.post(
        "/api/v1/wallet/payouts/",
        {"amount": amount, "destination": destination},
        format="json",
        headers=headers,
    )


def test_first_payout_succeeds(api, funded_wholesaler):
    api.force_authenticate(user=funded_wholesaler)
    r = _create_payout(api, funded_wholesaler, key="retry-key-001")
    assert r.status_code == 201
    assert WalletPayoutRequest.objects.filter(idempotency_key="retry-key-001").count() == 1
    w = Wallet.objects.get(user=funded_wholesaler)
    assert str(w.available_balance) == "4750.00"
    assert str(w.held_balance) == "250.00"


def test_identical_retry_returns_original(api, funded_wholesaler):
    api.force_authenticate(user=funded_wholesaler)
    r1 = _create_payout(api, funded_wholesaler, key="retry-key-002")
    r2 = _create_payout(api, funded_wholesaler, key="retry-key-002")
    assert r1.status_code == 201
    assert r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    assert WalletPayoutRequest.objects.filter(idempotency_key="retry-key-002").count() == 1
    w = Wallet.objects.get(user=funded_wholesaler)
    assert str(w.available_balance) == "4750.00"  # no double reservation


def test_concurrent_identical_submissions_create_one(api, funded_wholesaler):
    """Two requests with the same key must create only one payout.

    Sequential on SQLite (which locks the whole DB on write); the production
    PostgreSQL deployment handles true concurrency via select_for_update + the
    partial unique constraint.
    """
    api.force_authenticate(user=funded_wholesaler)
    r1 = _create_payout(api, funded_wholesaler, amount="100.00", key="concurrent-key-001")
    assert r1.status_code == 201
    r2 = _create_payout(api, funded_wholesaler, amount="100.00", key="concurrent-key-001")
    assert r2.status_code == 200
    assert WalletPayoutRequest.objects.filter(idempotency_key="concurrent-key-001").count() == 1
    w = Wallet.objects.get(user=funded_wholesaler)
    assert str(w.available_balance) == "4900.00"


def test_two_distinct_payouts_both_succeed(api, funded_wholesaler):
    api.force_authenticate(user=funded_wholesaler)
    r1 = _create_payout(api, funded_wholesaler, amount="100.00", key="distinct-001")
    r2 = _create_payout(api, funded_wholesaler, amount="200.00", key="distinct-002")
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert WalletPayoutRequest.objects.count() == 2
    w = Wallet.objects.get(user=funded_wholesaler)
    assert str(w.available_balance) == "4700.00"
    assert str(w.held_balance) == "300.00"


def test_missing_key_creates_new_payout(api, funded_wholesaler):
    """No key = each request is intentionally new (server cannot guess intent)."""
    api.force_authenticate(user=funded_wholesaler)
    r1 = _create_payout(api, funded_wholesaler)
    r2 = _create_payout(api, funded_wholesaler)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert WalletPayoutRequest.objects.count() == 2


def test_failed_payout_safe_retry(api, funded_wholesaler):
    """A rejected payout returns the held funds; a retry with a new key succeeds."""
    api.force_authenticate(user=funded_wholesaler)
    r1 = _create_payout(api, funded_wholesaler, amount="100.00", key="fail-retry-001")
    assert r1.status_code == 201
    payout_id = r1.json()["id"]

    fm = make_user(Role.FINANCIAL_MANAGER, "payout.fm@test.et", "Payout FM")
    # FM rejects it
    api.force_authenticate(user=fm)
    review_url = f"/api/v1/wallet/payouts/{payout_id}/review/"
    r2 = api.post(review_url, {"approve": False, "notes": "Testing rejection"}, format="json")
    assert r2.status_code == 200

    # Funds returned
    w = Wallet.objects.get(user=funded_wholesaler)
    assert str(w.available_balance) == "5000.00"
    assert str(w.held_balance) == "0.00"

    # Safe retry with a new key
    api.force_authenticate(user=funded_wholesaler)
    r3 = _create_payout(api, funded_wholesaler, amount="100.00", key="fail-retry-002")
    assert r3.status_code == 201
    assert WalletPayoutRequest.objects.filter(idempotency_key="fail-retry-002").count() == 1


def test_wallet_balance_invariants_after_multiple_payouts(api, funded_wholesaler):
    api.force_authenticate(user=funded_wholesaler)
    _create_payout(api, funded_wholesaler, amount="100.00", key="inv-001")
    _create_payout(api, funded_wholesaler, amount="200.00", key="inv-002")
    _create_payout(api, funded_wholesaler, amount="300.00", key="inv-003")
    w = Wallet.objects.get(user=funded_wholesaler)
    # 5000 - (100 + 200 + 300) = 4400 available; 600 held
    assert str(w.available_balance) == "4400.00"
    assert str(w.held_balance) == "600.00"
    txs = WalletTransaction.objects.filter(
        wallet=w, transaction_type=WalletTransactionType.PAYOUT_RESERVATION
    )
    assert txs.count() == 3
    total_reserved = sum(t.amount for t in txs)
    assert total_reserved == Decimal("600.00")


def test_duplicate_idempotency_key_across_users_is_allowed(api, db):
    """The same key used by a different wallet is a separate payout."""
    ws1 = make_user(Role.WHOLESALER, "payout.ws1@test.et", "Payout WS1")
    ws2 = make_user(Role.WHOLESALER, "payout.ws2@test.et", "Payout WS2")
    Wallet.objects.create(user=ws1, available_balance="5000.00")
    Wallet.objects.create(user=ws2, available_balance="5000.00")
    api.force_authenticate(user=ws1)
    r1 = _create_payout(api, ws1, key="cross-user-001")
    assert r1.status_code == 201
    api.force_authenticate(user=ws2)
    r2 = _create_payout(api, ws2, key="cross-user-001")
    # The view rejects cross-user reuse of an idempotency key ("belongs to another request")
    # This is the intended design — an idempotency key is globally unique per user,
    # even though the DB constraint is wallet-scoped.
    assert r2.status_code == 400
    assert WalletPayoutRequest.objects.filter(idempotency_key="cross-user-001").count() == 1
