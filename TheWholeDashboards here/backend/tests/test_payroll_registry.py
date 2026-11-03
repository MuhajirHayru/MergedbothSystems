"""Part 25 — employee registry, payroll summary, and payslip privacy tests."""

import pytest
from decimal import Decimal

from payments.financial_models import EmployeeProfile, FinancialPayrollRecord
from users.models import Role

pytestmark = pytest.mark.django_db


def test_employee_registration_assigns_code_and_blocks_marketplace_roles(api, super_admin, financial_manager, farmer):
    api.force_authenticate(user=super_admin)
    ok = api.post("/api/v1/payments/financial/employees/", {
        "user": str(financial_manager.pk), "department": "Finance",
        "job_title": "Financial Manager", "monthly_base_salary": "12000.00",
        "hired_at": "2026-01-15",
    }, format="json")
    assert ok.status_code == 201, ok.data
    assert ok.data["employee_code"].startswith("GP-EMP-")

    bad = api.post("/api/v1/payments/financial/employees/", {"user": str(farmer.pk)}, format="json")
    assert bad.status_code == 400

    dup = api.post("/api/v1/payments/financial/employees/", {"user": str(financial_manager.pk)}, format="json")
    assert dup.status_code == 400


def test_employee_list_has_summary_and_finance_can_read(api, super_admin, financial_manager):
    EmployeeProfile.objects.create(user=financial_manager, department="Finance", monthly_base_salary=Decimal("12000.00"))
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/employees/")
    assert response.status_code == 200
    assert response.data["summary"]["total"] == 1
    assert Decimal(response.data["summary"]["monthly_payroll_expense"]) == Decimal("12000.00")
    assert response.data["employees"][0]["employee_code"].startswith("GP-EMP-")


def test_payroll_summary_counts_statuses(api, super_admin, financial_manager):
    EmployeeProfile.objects.create(user=financial_manager, monthly_base_salary=Decimal("9000.00"))
    FinancialPayrollRecord.objects.create(
        employee=financial_manager, period_start="2026-11-01", period_end="2026-11-30",
        base_amount=Decimal("9000.00"), tax_amount=Decimal("500.00"),
        status="PENDING", prepared_by=super_admin,
    )
    api.force_authenticate(user=financial_manager)
    response = api.get("/api/v1/payments/financial/payroll/summary/")
    assert response.status_code == 200
    assert response.data["pending_approvals"] == 1
    assert response.data["employees"]["active"] == 1


def test_payslip_privacy_user_sees_only_own(api, super_admin, financial_manager, farmer):
    FinancialPayrollRecord.objects.create(
        employee=financial_manager, period_start="2026-11-01", period_end="2026-11-30",
        base_amount=Decimal("9000.00"), status="PAID", prepared_by=super_admin,
    )
    api.force_authenticate(user=financial_manager)
    own = api.get("/api/v1/auth/my-payslips/")
    assert own.status_code == 200
    assert len(own.data["payslips"]) == 1
    assert Decimal(own.data["payslips"][0]["base_amount"]) == Decimal("9000.00")

    api.force_authenticate(user=farmer)
    foreign = api.get("/api/v1/auth/my-payslips/")
    assert foreign.data["payslips"] == []


def test_marketplace_user_cannot_access_registry(api, farmer):
    api.force_authenticate(user=farmer)
    assert api.get("/api/v1/payments/financial/employees/").status_code == 403
