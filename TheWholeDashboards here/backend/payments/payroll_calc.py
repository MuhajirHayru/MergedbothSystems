"""Statutory Ethiopian payroll calculation (Proclamation 979/2016 income tax
schedule and the private-organization pension proclamation contribution rates).

Everything here is statutory reference data — rates and brackets set by law —
not fabricated business figures. The payroll API recomputes these
authoritatively on the server for every record; client values are previews.
"""
from decimal import Decimal, ROUND_HALF_UP

# Private Organization Pension Proclamation (714/2011): 7% employee,
# 11% employer, both on basic salary.
PENSION_EMPLOYEE_RATE = Decimal("0.07")
PENSION_EMPLOYER_RATE = Decimal("0.11")

# Employment income tax brackets (Schedule A, Income Tax Proclamation 979/2016):
# (lower bound, rate, subtractive allowance). Monthly ETB.
TAX_BRACKETS = [
    (Decimal("0"), Decimal("0.00"), Decimal("0")),
    (Decimal("600.01"), Decimal("0.10"), Decimal("60")),
    (Decimal("1650.01"), Decimal("0.15"), Decimal("142.50")),
    (Decimal("3200.01"), Decimal("0.20"), Decimal("302.50")),
    (Decimal("5250.01"), Decimal("0.25"), Decimal("565")),
    (Decimal("7800.01"), Decimal("0.30"), Decimal("955")),
    (Decimal("10900.01"), Decimal("0.35"), Decimal("1500")),
]

TWO_PLACES = Decimal("0.01")


def _round(value: Decimal) -> Decimal:
    return value.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def income_tax(taxable_income: Decimal) -> Decimal:
    """Progressive monthly employment income tax on the taxable income."""
    taxable = Decimal(taxable_income or 0)
    if taxable <= 0:
        return Decimal("0.00")
    for lower, rate, subtraction in TAX_BRACKETS:
        upper = TAX_BRACKETS[TAX_BRACKETS.index((lower, rate, subtraction)) + 1][0] - Decimal("0.01") \
            if (lower, rate, subtraction) != TAX_BRACKETS[-1] else None
        if upper is None or taxable <= upper:
            return _round(taxable * rate - subtraction)
    return _round(taxable * TAX_BRACKETS[-1][1] - TAX_BRACKETS[-1][2])


def compute_payroll(base_amount: Decimal, allowances: Decimal = Decimal("0"),
                    commission: Decimal = Decimal("0"),
                    other_deductions: Decimal = Decimal("0")) -> dict:
    """Authoritative month-end payroll computation for one staff member.

    Gross  = base + allowances + commission
    Employee pension  = 7% × base          (deducted from the employee)
    Taxable income    = gross − employee pension
    Income tax        = statutory progressive schedule on the taxable income
    Other deductions  = e.g. salary advances, supplied by the preparer
    Net    = gross − employee pension − income tax − other deductions
    Employer pension = 11% × base          (an employer cost, not deducted)
    """
    base = Decimal(base_amount or 0)
    allow = Decimal(allowances or 0)
    comm = Decimal(commission or 0)
    other = Decimal(other_deductions or 0)

    gross = base + allow + comm
    pension_employee = _round(base * PENSION_EMPLOYEE_RATE)
    pension_employer = _round(base * PENSION_EMPLOYER_RATE)
    taxable = gross - pension_employee
    tax = income_tax(taxable)
    net = gross - pension_employee - tax - other

    return {
        "gross": _round(gross),
        "pension_employee": pension_employee,
        "pension_employer": pension_employer,
        "taxable_income": _round(taxable),
        "income_tax": tax,
        "other_deductions": _round(other),
        "net": _round(net),
    }
