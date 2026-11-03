"""Part 24 — transaction detail and P&L tests."""

import pytest
from decimal import Decimal

from payments.financial_models import FinancialAccount, FinancialJournalEntry
from users.models import Role

pytestmark = pytest.mark.django_db


def _entry(category, amount, source_ref="X-1", order_ref="", actor=None):
    debit, _ = FinancialAccount.objects.get_or_create(code="T:D", defaults={"name": "D", "category": "LIABILITY"})
    credit, _ = FinancialAccount.objects.get_or_create(code="T:C", defaults={"name": "C", "category": "REVENUE"})
    return FinancialJournalEntry.objects.create(
        reference=f"{category}:{source_ref}", category=category, amount=Decimal(amount),
        debit_account=debit, credit_account=credit, source="TEST", source_reference=source_ref,
        idempotency_key=f"pnl-{category}-{source_ref}", actor=actor, order_reference=order_ref,
    )


def test_ledger_search_matches_references(api, financial_manager):
    _entry(actor=financial_manager, category="MARKETPLACE_COMMISSION", amount="10.00", source_ref="ORD-SRCH-1", order_ref="#ORD1")
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/ledger/", {"search": "ORD-SRCH-1"})
    assert response.status_code == 200
    assert len(response.data) == 1


def test_detail_returns_related_entries(api, financial_manager):
    _entry(actor=financial_manager, category="ESCROW_RELEASE", amount="100.00", source_ref="GRP-1", order_ref="#ORD9")
    _entry(actor=financial_manager, category="ORDER_RESERVATION", amount="100.00", source_ref="GRP-1", order_ref="#ORD9")
    api.force_authenticate(user=financial_manager)
    listing = api.get("/api/v1/payments/financial/ledger/", {"search": "GRP-1"})
    detail = api.get(f"/api/v1/payments/financial/ledger/{listing.data[0]['id']}/")
    assert detail.status_code == 200
    assert detail.data["order_reference"] == "#ORD9"
    assert len(detail.data["related_entries"]) == 1


def test_pnl_reports_revenue_and_expenses(api, financial_manager):
    _entry(actor=financial_manager, category="MARKETPLACE_COMMISSION", amount="30.00", source_ref="P1")
    _entry(actor=financial_manager, category="DELIVERY_SERVICE_REVENUE", amount="5.00", source_ref="P2")
    _entry(actor=financial_manager, category="PROMOTION_EXPENSE", amount="12.00", source_ref="P3")
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/pnl/")
    assert response.status_code == 200
    assert response.data["revenue"]["available"] is True
    assert response.data["revenue"]["total"] == "35.00"
    assert response.data["expenses"]["available"] is True
    assert response.data["expenses"]["promotion"] == "12.00"
    assert response.data["gross_profit"] == "23.00"


def test_pnl_reports_unavailable_when_empty(api, financial_manager):
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/pnl/", {"start": "2020-01-01", "end": "2020-01-02"})
    assert response.status_code == 200
    assert response.data["revenue"]["available"] is False
    assert response.data["revenue"]["total"] is None
    assert response.data["gross_profit"] is None


def test_pnl_rejects_bad_dates(api, financial_manager):
    api.force_authenticate(user=financial_manager)
    assert api.get("/api/v1/payments/financial/pnl/", {"start": "nope"}).status_code == 400


def test_farmer_cannot_access_pnl(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/payments/financial/pnl/").status_code == 403
