from decimal import Decimal

from django.db import models, transaction
from django.utils import timezone

from users.models import AuditLog, Role
from products.models import ProductType
from .financial_models import (
    FinancialAccount,
    FinancialJournalEntry,
    FinancialOperatingExpense,
    FinancialOrderSnapshot,
    FinancialConfiguration,
    FinancialPayrollRecord,
    FinancialRefundRequest,
    DeliveryPricingConfiguration,
    DeliveryFeePayment,
)


def _account(code, name, category):
    account, _ = FinancialAccount.objects.get_or_create(
        code=code, defaults={"name": name, "category": category}
    )
    return account


def post_journal_entry(*, reference, category, amount, currency, debit_code, debit_name,
                        debit_category, credit_code, credit_name, credit_category,
                        source, source_reference, actor, description="", related_user=None, configuration=None, order_reference="", location=None, status=FinancialJournalEntry.Status.POSTED, reverses=None, revenue_method="", payer_party="", payer_user=None):
    amount = Decimal(amount).quantize(Decimal("0.01"))
    existing = FinancialJournalEntry.objects.filter(idempotency_key=reference).first()
    if existing:
        expected = (category, amount, currency, source, source_reference)
        actual = (existing.category, existing.amount, existing.currency, existing.source, existing.source_reference)
        if actual != expected:
            raise ValueError("Idempotency reference already exists for a different journal posting.")
        return existing
    debit = _account(debit_code, debit_name, debit_category)
    credit = _account(credit_code, credit_name, credit_category)
    return FinancialJournalEntry.objects.create(
        reference=reference,
        idempotency_key=reference,
        category=category,
        amount=amount,
        currency=currency,
        debit_account=debit,
        credit_account=credit,
        source=source,
        source_reference=source_reference,
        configuration=configuration,
        order_reference=order_reference,
        location=location,
        actor=actor,
        posted_by=actor,
        description=description,
        related_user=related_user,
        status=status,
        reverses=reverses,
        revenue_method=revenue_method or "",
        payer_party=payer_party or "",
        payer_user=payer_user,
    )


def _active_configuration(kind, effective_at):
    return FinancialConfiguration.objects.filter(
        kind=kind,
        # A rule must have been approved when the transaction occurred.
        # Keep superseded versions eligible for events inside their original
        # effective window so later approvals cannot rewrite history.
        status__in=(
            FinancialConfiguration.Status.APPROVED,
            FinancialConfiguration.Status.SUPERSEDED,
        ),
        approved_at__isnull=False,
        approved_at__lte=effective_at,
        effective_from__lte=effective_at,
    ).filter(
        models.Q(effective_to__isnull=True) | models.Q(effective_to__gt=effective_at)
    ).order_by("-effective_from", "-version").first()


def _rule_scope_matches(candidate: dict, *, seller_role, buyer_role, product_type, region_id, quantity, value) -> bool:
    """Scope match for one revenue-rule candidate against a transaction."""
    if not candidate.get("enabled", True):
        return False
    if candidate.get("seller_role", "*") not in ("*", seller_role):
        return False
    if candidate.get("buyer_role", "*") not in ("*", buyer_role):
        return False
    if candidate.get("product_type", "*") not in ("*", product_type):
        return False
    candidate_region = candidate.get("region_id")
    if candidate_region not in (None, "*") and str(candidate_region) != str(region_id):
        return False
    quantity = Decimal(str(quantity or 0))
    value = Decimal(str(value or 0))
    min_q = candidate.get("min_quantity")
    if min_q not in (None, "", "*") and quantity < Decimal(str(min_q)):
        return False
    max_q = candidate.get("max_quantity")
    if max_q not in (None, "", "*") and quantity > Decimal(str(max_q)):
        return False
    min_v = candidate.get("min_value")
    if min_v not in (None, "", "*") and value < Decimal(str(min_v)):
        return False
    max_v = candidate.get("max_value")
    if max_v not in (None, "", "*") and value > Decimal(str(max_v)):
        return False
    return True


def _rule_specificity(candidate: dict) -> int:
    """Higher = more specific. Priority (explicit) breaks ties first."""
    score = 0
    if candidate.get("product_type", "*") != "*":
        score += 8
    if candidate.get("region_id") not in (None, "*", ""):
        score += 4
    if candidate.get("seller_role", "*") != "*":
        score += 2
    if candidate.get("buyer_role", "*") != "*":
        score += 2
    if candidate.get("min_quantity") not in (None, "", "*") or candidate.get("max_quantity") not in (None, "", "*"):
        score += 1
    return score


def _matching_commission_rule(configuration, *, seller_role, buyer_role, product_type, region_id, quantity, value):
    """Select the applicable revenue rule.

    Priority: explicit ``priority`` field first (higher wins), then rule
    specificity (product > region > roles > quantity range). Overlapping rules
    never combine — exactly one rule wins and its full definition is returned
    so the settlement can name every applied term.
    """
    if not configuration:
        return None
    rules = configuration.rules
    candidates = rules.get("rules", []) if isinstance(rules, dict) else []
    if not isinstance(candidates, list):
        return None
    matching = [
        c for c in candidates
        if isinstance(c, dict) and _rule_scope_matches(
            c, seller_role=seller_role, buyer_role=buyer_role,
            product_type=product_type, region_id=region_id,
            quantity=quantity, value=value,
        )
    ]
    if not matching:
        return None
    matching.sort(
        key=lambda c: (
            -int(c.get("priority", 0) or 0),
            -_rule_specificity(c),
            str(c.get("rule_id", "")),
        )
    )
    return matching[0]


def _rule_commission_amount(rule: dict, gross: Decimal, quantity: Decimal) -> Decimal:
    """Compute the platform commission for one matched rule.

    calculation: 'percentage' (rate × gross) | 'fixed' | 'per_unit'
    (unit_fee × quantity in quintals). Min/max commission caps
    clamp the result; the commission can never exceed the gross value.
    """
    calculation = (rule.get("calculation") or "percentage").lower()
    rate = Decimal(str(rule.get("rate", "0") or 0))
    fixed = Decimal(str(rule.get("fixed_fee", "0") or 0))
    unit_fee = Decimal(str(rule.get("unit_fee", "0") or 0))
    if calculation == "percentage":
        commission = gross * rate + fixed
    elif calculation == "per_unit":
        commission = quantity * unit_fee + fixed
    elif calculation == "fixed":
        commission = fixed
    else:
        raise ValueError(f"Unknown commission calculation method: {calculation}")
    min_commission = rule.get("min_commission")
    if min_commission not in (None, "", "*") and commission < Decimal(str(min_commission)):
        commission = Decimal(str(min_commission))
    max_commission = rule.get("max_commission")
    if max_commission not in (None, "", "*") and commission > Decimal(str(max_commission)):
        commission = Decimal(str(max_commission))
    return commission.quantize(Decimal("0.01"))


def _rule_buyer_fee_amount(rule: dict, gross: Decimal, quantity: Decimal) -> Decimal:
    """Buyer service fee from the same rule (separately identified)."""
    calculation = (rule.get("buyer_fee_calculation") or "none").lower()
    if calculation == "none":
        return Decimal("0.00")
    rate = Decimal(str(rule.get("buyer_fee_rate", "0") or 0))
    fixed = Decimal(str(rule.get("buyer_fee_fixed", "0") or 0))
    unit_fee = Decimal(str(rule.get("buyer_fee_unit_fee", "0") or 0))
    if calculation == "percentage":
        fee = gross * rate + fixed
    elif calculation == "per_unit":
        fee = quantity * unit_fee + fixed
    else:
        fee = fixed
    return fee.quantize(Decimal("0.01"))


def build_agreement_financial_terms_snapshot(order, *, agreement, at=None):
    """Freeze the approved rule, payer and exact fee amounts at acceptance."""
    from .financial_models import RevenueMethod
    from .revenue_engine import active_methods, plan_order_charges, quintals, transaction_type_for

    at = at or agreement.activated_at
    seller, buyer = order.seller, order.buyer
    gross = Decimal(str(order.total_amount or 0))
    quantity = Decimal(str(order.quantity or 0))
    quantity_q = quintals(quantity, getattr(order.product, "unit_of_measure", ""))
    location = None
    shipment = getattr(order, "shipment_details", None)
    if shipment:
        location = shipment.pickup_wereda or shipment.pickup_zone or shipment.pickup_region
    region_id = getattr(location, "pk", None) or getattr(
        getattr(seller, "administrative_location", None), "pk", None
    )
    commission_config = _active_configuration(FinancialConfiguration.Kind.COMMISSION, at)
    tax_config = _active_configuration(FinancialConfiguration.Kind.TAX, at)
    methods = active_methods(transaction_type_for(order), at=at)
    commission_rule = _matching_commission_rule(
        commission_config,
        seller_role=seller.role,
        buyer_role=buyer.role if buyer else None,
        product_type=order.product.product_type,
        region_id=region_id,
        quantity=quantity,
        value=gross,
    )
    tax_rule = _matching_commission_rule(
        tax_config,
        seller_role=seller.role,
        buyer_role=buyer.role if buyer else None,
        product_type=order.product.product_type,
        region_id=region_id,
        quantity=quantity,
        value=gross,
    ) if tax_config else None

    commission = Decimal("0.00")
    buyer_fee = Decimal("0.00")
    if commission_rule:
        if RevenueMethod.Method.SELLER_COMMISSION in methods:
            commission = _rule_commission_amount(commission_rule, gross, quantity_q)
        if RevenueMethod.Method.BUYER_COMMISSION in methods:
            buyer_fee = _rule_buyer_fee_amount(commission_rule, gross, quantity_q)
    tax_amount = Decimal("0.00") if commission <= 0 else None
    if commission > 0 and tax_rule:
        rate = Decimal(str(tax_rule.get("rate", "0") or 0))
        if rate < 0 or rate > 1:
            raise ValueError("Tax rate must be between 0 and 1.")
        tax_amount = (commission * rate).quantize(Decimal("0.01"))

    preview = FinancialOrderSnapshot(
        order=order, gross_order_value=gross,
        commission_amount=commission, buyer_fee_amount=buyer_fee,
    )
    planned = plan_order_charges(order, snapshot=preview, at=at)
    fee_lines = [
        {
            "revenue_method_id": str(item["rule"].pk),
            "method": item["method"],
            "transaction_type": item["rule"].transaction_type,
            "payer_party": item["payer_party"],
            "payer_user_id": str(item["payer_user"].pk),
            "payer_name": item["payer_user"].full_name,
            "amount": str(item["amount"]),
            "company_share_percentage": str(item["rule"].company_share_percentage),
            "agreement_reference": item["agreement_reference"],
        }
        for item in planned
    ]
    from .revenue_engine import commission_payer

    commission_party, commission_user = commission_payer(
        order, RevenueMethod.Method.SELLER_COMMISSION, at=at
    )
    tax_payer = str((tax_rule or {}).get("fee_payer", "") or "").lower()
    tax_payer_choices = {
        "seller": (RevenueMethod.Payer.SELLER, seller),
        "buyer": (RevenueMethod.Payer.BUYER, buyer),
        "requesting_party": (RevenueMethod.Payer.REQUESTING_PARTY, buyer),
        "contractual_party": (RevenueMethod.Payer.CONTRACTUAL_PARTY, agreement.contractual_payer),
    }
    tax_party, tax_user = tax_payer_choices.get(
        tax_payer, (commission_party or RevenueMethod.Payer.SELLER, commission_user or seller)
    )
    issues = []
    if commission > 0 and tax_amount is None:
        issues.append("Tax treatment is unresolved; no tax will be collected until an applicable approved rule exists.")
    return {
        "status": "INCOMPLETE" if issues else "READY",
        "currency": "ETB",
        "effective_at": at.isoformat(),
        "gross_order_value": str(gross),
        "quantity": str(quantity),
        "quantity_unit": getattr(order.product, "unit_of_measure", ""),
        "quantity_quintals": str(quantity_q),
        "commission_configuration_id": str(commission_config.pk) if commission_config else None,
        "commission_rule": commission_rule,
        "commission_amount": str(commission),
        "buyer_fee_amount": str(buyer_fee),
        "tax_configuration_id": str(tax_config.pk) if tax_config else None,
        "tax_rule": tax_rule,
        "tax_amount": str(tax_amount) if tax_amount is not None else None,
        "tax_payer_party": str(tax_party or ""),
        "tax_payer_user_id": str(tax_user.pk) if tax_user else None,
        "tax_payer_name": tax_user.full_name if tax_user else None,
        "fee_lines": fee_lines,
        "issues": issues,
    }


@transaction.atomic
def post_completed_order(order, *, actor, gross_override=None):
    from .models import Order, OrderPaymentStatus, OrderStatus

    locked = Order.objects.select_for_update().select_related(
        "farmer", "wholesaler", "retailer", "product", "shipment_details__pickup_region"
    ).get(pk=order.pk)
    if locked.status != OrderStatus.COMPLETED or locked.payment_status != OrderPaymentStatus.RELEASED:
        raise ValueError("Only released completed orders may be posted.")
    snapshot = FinancialOrderSnapshot.objects.filter(order=locked).first()
    if snapshot:
        return snapshot
    seller = locked.seller
    seller_role = seller.role
    region_id = getattr(getattr(seller, "administrative_location", None), "id", None)
    location = None
    shipment = getattr(locked, "shipment_details", None)
    if shipment is not None:
        location = shipment.pickup_wereda or shipment.pickup_zone or shipment.pickup_region
    if region_id is None and location is not None:
        region_id = location.pk
    effective_gross = locked.total_amount if gross_override is None else Decimal(str(gross_override))
    agreement = getattr(locked, "agreement", None)
    # Use the accepted agreement's effective time so later rule changes do not
    # change the price basis for an order the participants already accepted.
    effective_at = getattr(agreement, "activated_at", None) or locked.quality_confirmed_at or locked.updated_at
    agreement_terms = getattr(agreement, "financial_terms_snapshot", None) or {}
    if agreement_terms and gross_override is None:
        effective_gross = Decimal(str(agreement_terms.get("gross_order_value", effective_gross)))
    buyer = locked.buyer
    buyer_role = buyer.role if buyer else None
    order_quantity = Decimal(str(locked.quantity or 0))
    from .revenue_engine import quintals
    quantity_in_quintals = quintals(order_quantity, locked.product.unit_of_measure)
    configuration = _active_configuration(FinancialConfiguration.Kind.COMMISSION, effective_at)
    if agreement_terms.get("commission_configuration_id"):
        configuration = FinancialConfiguration.objects.filter(
            pk=agreement_terms["commission_configuration_id"]
        ).first()
    from .revenue_engine import active_methods, transaction_type_for
    from .financial_models import RevenueMethod

    configured_methods = active_methods(transaction_type_for(locked), at=effective_at)
    rule = _matching_commission_rule(
        configuration, seller_role=seller_role, buyer_role=buyer_role,
        product_type=locked.product.product_type, region_id=region_id,
        quantity=order_quantity, value=effective_gross,
    )
    if agreement_terms:
        rule = agreement_terms.get("commission_rule")
    if not rule and not agreement_terms:
        from .revenue_engine import apply_order_revenue_methods, plan_order_charges

        preview = FinancialOrderSnapshot(
            order=locked, gross_order_value=effective_gross,
            commission_amount=Decimal("0.00"), buyer_fee_amount=Decimal("0.00"),
        )
        charge_plan = plan_order_charges(locked, snapshot=preview, at=effective_at)
        seller_fees = sum((item["amount"] for item in charge_plan if item["payer_user"] == seller), Decimal("0.00"))
        snapshot = FinancialOrderSnapshot.objects.create(
            order=locked, configuration=configuration,
            gross_order_value=effective_gross,
            seller_role=seller_role, seller_user=seller,
            seller_proceeds=max(Decimal("0.00"), effective_gross - seller_fees),
            # If no approved commission configuration existed at acceptance,
            # no commission was authorized and there is no commission tax
            # base. A present configuration with no matching rule remains
            # unresolved and must be reviewed.
            tax_amount=Decimal("0.00") if configuration is None else None,
            currency="ETB",
            status=(FinancialOrderSnapshot.Status.SETTLED if configuration is None
                    else FinancialOrderSnapshot.Status.TAX_UNRESOLVED),
        )
        # Configured revenue methods still apply when no commission rule wins.
        apply_order_revenue_methods(locked, actor=actor, at=effective_at)
        from .inventory_services import settle_order_inventory

        settle_order_inventory(locked)
        return snapshot
    try:
        rate = Decimal(str((rule or {}).get("rate", "0") or 0))
        fixed = Decimal(str((rule or {}).get("fixed_fee", "0") or 0))
    except (ArithmeticError, TypeError, ValueError) as exc:
        raise ValueError("Commission rule rate and fixed_fee must be decimal strings.") from exc
    if rate < 0 or rate > 1 or fixed < 0:
        raise ValueError("Commission rule rate must be between 0 and 1 and fixed_fee nonnegative.")
    commission = Decimal(str(agreement_terms["commission_amount"])) if agreement_terms else _rule_commission_amount(rule, effective_gross, quantity_in_quintals)
    # The approved commission calculation is not, by itself, permission to
    # charge. Revenue Methods must enable each commission stream and assign a
    # payer; this also ensures every fee has a matching agreement snapshot.
    if not agreement_terms and RevenueMethod.Method.SELLER_COMMISSION not in configured_methods:
        commission = Decimal("0.00")
    if commission > effective_gross:
        raise ValueError("Commission cannot exceed gross order value.")
    buyer_fee = Decimal(str(agreement_terms.get("buyer_fee_amount", "0"))) if agreement_terms else _rule_buyer_fee_amount(rule or {}, effective_gross, quantity_in_quintals)
    if not agreement_terms and RevenueMethod.Method.BUYER_COMMISSION not in configured_methods:
        buyer_fee = Decimal("0.00")
    # active_methods already excludes methods whose Super Admin source switch
    # is disabled, so disabled commission streams cannot reach this point.
    tax_configuration = _active_configuration(FinancialConfiguration.Kind.TAX, effective_at)
    if agreement_terms.get("tax_configuration_id"):
        tax_configuration = FinancialConfiguration.objects.filter(
            pk=agreement_terms["tax_configuration_id"]
        ).first()
    tax_amount = Decimal("0.00") if commission <= 0 else None
    tax_rule = _matching_commission_rule(
        tax_configuration, seller_role=seller_role, buyer_role=buyer_role,
        product_type=locked.product.product_type, region_id=region_id,
        quantity=order_quantity, value=effective_gross,
    ) if commission > 0 else None
    if agreement_terms:
        tax_rule = agreement_terms.get("tax_rule")
        raw_tax = agreement_terms.get("tax_amount")
        tax_amount = Decimal(str(raw_tax)) if raw_tax is not None else None
    if tax_rule:
        tax_rate = Decimal(str(tax_rule.get("rate", "0")))
        if tax_rate < 0 or tax_rate > 1:
            raise ValueError("Tax rate must be between 0 and 1.")
        tax_amount = (commission * tax_rate).quantize(Decimal("0.01"))
    if tax_amount is None:
        snapshot_status = FinancialOrderSnapshot.Status.TAX_UNRESOLVED
        tax_for_proceeds = Decimal("0.00")
    else:
        snapshot_status = FinancialOrderSnapshot.Status.SETTLED
        tax_for_proceeds = tax_amount
    from .revenue_engine import commission_payer

    commission_payer_party, commission_payer_user = commission_payer(locked, RevenueMethod.Method.SELLER_COMMISSION, at=effective_at)
    commission_payer_user = commission_payer_user or seller
    tax_payer = str((tax_rule or {}).get("fee_payer", "") or "").lower()
    contractual_payer = getattr(agreement, "contractual_payer", None)
    tax_payer_choices = {
        "seller": (RevenueMethod.Payer.SELLER, seller),
        "buyer": (RevenueMethod.Payer.BUYER, buyer),
        "requesting_party": (RevenueMethod.Payer.REQUESTING_PARTY, buyer),
        "contractual_party": (RevenueMethod.Payer.CONTRACTUAL_PARTY, contractual_payer),
    }
    tax_payer_party, tax_payer_user = tax_payer_choices.get(
        tax_payer, (commission_payer_party or RevenueMethod.Payer.SELLER, commission_payer_user or seller)
    )
    if agreement_terms:
        tax_payer_party = agreement_terms.get("tax_payer_party") or tax_payer_party
        tax_payer_user = None
        if agreement_terms.get("tax_payer_user_id"):
            from django.contrib.auth import get_user_model

            tax_payer_user = get_user_model().objects.filter(
                pk=agreement_terms["tax_payer_user_id"]
            ).first()
    if tax_payer and tax_payer not in tax_payer_choices:
        raise ValueError("Tax fee_payer must be seller, buyer, requesting_party, or contractual_party.")
    if tax_amount and tax_amount > 0 and tax_payer_user is None:
        raise ValueError("The commission tax payer cannot be resolved from the approved Revenue Method.")
    from .revenue_engine import plan_order_charges

    preview = FinancialOrderSnapshot(
        order=locked, gross_order_value=effective_gross,
        commission_amount=commission, buyer_fee_amount=buyer_fee,
    )
    if agreement_terms:
        seller_fees = sum((
            Decimal(str(line["amount"])) for line in agreement_terms.get("fee_lines", [])
            if str(line.get("payer_user_id")) == str(seller.pk)
        ), Decimal("0.00"))
    else:
        charge_plan = plan_order_charges(locked, snapshot=preview, at=effective_at)
        seller_fees = sum((item["amount"] for item in charge_plan if item["payer_user"] == seller), Decimal("0.00"))
    tax_deduction = tax_for_proceeds if tax_payer_user == seller else Decimal("0.00")
    snapshot = FinancialOrderSnapshot.objects.create(
        order=locked, configuration=configuration, gross_order_value=effective_gross,
        seller_role=seller_role, seller_user=seller, commission_rate=rate, commission_fixed_fee=fixed,
        commission_amount=commission, service_fee_amount=fixed,
        buyer_fee_amount=buyer_fee,
        buyer_user=buyer,
        tax_configuration=tax_configuration, tax_amount=tax_amount,
        tax_payer_party=str(tax_payer_party or ""), tax_payer_user=tax_payer_user,
        seller_proceeds=max(Decimal("0.00"), effective_gross - seller_fees - tax_deduction),
        currency="ETB", status=snapshot_status,
    )
    if tax_amount and tax_amount > 0:
        tax_party = tax_payer_party
        if tax_party == RevenueMethod.Payer.SELLER:
            tax_debit_code, tax_debit_name, tax_user = "LIABILITY:SELLER_WALLET", "Seller wallet liability", seller
        elif tax_party == RevenueMethod.Payer.BUYER:
            tax_debit_code, tax_debit_name, tax_user = "LIABILITY:BUYER_WALLET", "Buyer wallet liability", buyer
        else:
            tax_debit_code, tax_debit_name, tax_user = "LIABILITY:PARTICIPANT_WALLET", "Participant wallet liability", tax_payer_user
        post_journal_entry(
            reference=f"order-tax:{locked.pk}", category="TAX_LIABILITY",
            amount=tax_amount, currency="ETB",
            debit_code=tax_debit_code, debit_name=tax_debit_name, debit_category="LIABILITY",
            credit_code="LIABILITY:TAX_PAYABLE", credit_name="Tax payable", credit_category="LIABILITY",
            source="ORDER_SETTLEMENT", source_reference=locked.reference, actor=actor,
            description=f"Tax on commission for order {locked.reference}",
            related_user=tax_user, configuration=tax_configuration,
            order_reference=locked.reference, location=location,
            revenue_method="TAX", payer_party=tax_party, payer_user=tax_user,
        )
        if tax_payer_user != seller:
            from .revenue_engine import debit_available_wallet

            debit_available_wallet(
                user=tax_payer_user, amount=tax_amount,
                reference=f"ORDER-TAX-{locked.pk}", actor=actor, order=locked,
                description=f"Approved tax on marketplace commission for {locked.reference}",
            )
    # The Revenue Methods engine records commission entries and any additional
    # configured fees exactly once using the selected payer's wallet.
    from .revenue_engine import apply_order_revenue_methods

    apply_order_revenue_methods(
        locked, actor=actor, at=effective_at,
        fee_terms_snapshot=agreement_terms if agreement_terms else None,
    )
    from .inventory_services import settle_order_inventory
    settle_order_inventory(locked)
    return snapshot


@transaction.atomic
def resolve_delivery_pricing(*, agreement, actor):
    try:
        details = agreement.order.shipment_details
    except Exception as exc:
        raise ValueError("Delivery shipment details are required to resolve pricing.") from exc
    effective_at = agreement.buyer_accepted_at
    rules = DeliveryPricingConfiguration.objects.filter(
        active=True, approved_by__isnull=False, approved_at__isnull=False, effective_from__lte=effective_at
    ).filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gt=effective_at))
    business_agreement = getattr(agreement.order, "agreement", None)
    agreement_reference = str(business_agreement.pk) if business_agreement else ""
    driver_vehicle_category = "*"
    if agreement.driver_payee_id:
        try:
            driver_vehicle_category = agreement.driver_payee.marketplace_driver_identity.profile.application.vehicle_type or "*"
        except Exception:
            # A driver without a synchronized, approved vehicle profile can only
            # match a rule that is not restricted to a vehicle category.
            pass
    rules = rules.filter(models.Q(business_agreement_reference=agreement_reference) | models.Q(business_agreement_reference=""))
    scope_values = {
        "wereda_id": details.pickup_wereda_id,
        "zone_id": details.pickup_zone_id,
        "region_id": details.pickup_region_id,
        "category": getattr(agreement.order.product, "category", "*"),
        "vehicle_category": driver_vehicle_category,
    }
    candidates = []
    for rule in rules:
        if rule.business_agreement_reference not in ("", agreement_reference):
            continue
        if any(getattr(rule, key) not in (None, "", "*") and str(getattr(rule, key)) != str(value) for key, value in scope_values.items()):
            continue
        candidates.append(rule)
    if not candidates:
        raise ValueError("No approved effective delivery pricing configuration matches this agreement.")
    def specificity(rule):
        return sum((rule.business_agreement_reference != "", rule.wereda_id is not None, rule.zone_id is not None, rule.region_id is not None, rule.category not in ("", "*"), rule.vehicle_category not in ("", "*")))
    candidates.sort(key=lambda rule: (specificity(rule), rule.effective_from, rule.created_at), reverse=True)
    if len(candidates) > 1 and specificity(candidates[0]) == specificity(candidates[1]) and candidates[0].effective_from == candidates[1].effective_from:
        raise ValueError("Overlapping delivery pricing rules have equal precedence; resolve the conflict before acceptance.")
    return candidates[0]


@transaction.atomic
def verify_delivery_payment(payment_id, *, actor, verified_amount=None, evidence_reference=""):
    from .chapa import verify_delivery_transaction

    payment = DeliveryFeePayment.objects.select_for_update().select_related("agreement__order").get(pk=payment_id)
    if payment.status == DeliveryFeePayment.Status.VERIFIED:
        return payment
    if verified_amount is not None:
        raise ValueError("Delivery collections cannot use caller-supplied verified amounts.")
    if not evidence_reference:
        raise ValueError("A Chapa verification request is required.")
    verification = verify_delivery_transaction(payment)
    if not verification:
        raise ValueError("Chapa did not verify a successful delivery payment with the expected amount and currency.")
    verified_amount = verification["amount"]
    evidence_reference = verification["evidence_reference"]
    amount = Decimal(verified_amount).quantize(Decimal("0.01"))
    if payment.status in (DeliveryFeePayment.Status.PARTIAL, DeliveryFeePayment.Status.FAILED, DeliveryFeePayment.Status.REFUNDED):
        raise ValueError("Partial, failed, or refunded delivery payments cannot be verified; create a new payment event.")
    if amount != payment.customer_amount or not evidence_reference:
        payment.status = DeliveryFeePayment.Status.PARTIAL if amount < payment.customer_amount else DeliveryFeePayment.Status.FAILED
        payment.save(update_fields=["status"])
        return payment
    agreement = payment.agreement
    allocated = payment.driver_charge + payment.platform_fee + (payment.tax_amount or Decimal("0"))
    if allocated != payment.customer_amount:
        raise ValueError("Delivery allocations must equal the collected customer amount before verification.")
    entry = post_journal_entry(
        reference=f"delivery-collection:{payment.pk}", category="DELIVERY_CUSTOMER_PAYMENT",
        amount=amount, currency=agreement.currency,
        debit_code="ASSET:PAYMENT_CLEARING", debit_name="Verified delivery payment clearing", debit_category="ASSET",
        credit_code="LIABILITY:DELIVERY_SETTLEMENT", credit_name="Delivery settlement payable", credit_category="LIABILITY",
        source="DELIVERY_PAYMENT", source_reference=payment.payment_reference, actor=actor,
        description="Verified customer delivery payment", order_reference=agreement.order.reference,
    )
    payment.status = DeliveryFeePayment.Status.VERIFIED
    payment.verified_by = actor
    payment.verified_at = timezone.now()
    payment.verification_evidence = evidence_reference
    payment.journal_entry = entry
    payment.save(update_fields=["status", "verified_by", "verified_at", "verification_evidence", "journal_entry"])
    if payment.driver_charge > 0:
        post_journal_entry(reference=f"delivery-driver:{payment.pk}", category="DELIVERY_DRIVER_COMPENSATION", amount=payment.driver_charge, currency=agreement.currency,
            debit_code="LIABILITY:DELIVERY_SETTLEMENT", debit_name="Delivery settlement payable", debit_category="LIABILITY",
            credit_code="LIABILITY:DRIVER_WALLET", credit_name="Driver wallet liability", credit_category="LIABILITY",
            source="DELIVERY_PAYMENT", source_reference=payment.payment_reference, actor=actor, related_user=agreement.driver_payee, order_reference=agreement.order.reference)
    if payment.platform_fee > 0:
        post_journal_entry(reference=f"delivery-platform:{payment.pk}", category="DELIVERY_SERVICE_REVENUE", amount=payment.platform_fee, currency=agreement.currency,
            debit_code="LIABILITY:DELIVERY_SETTLEMENT", debit_name="Delivery settlement payable", debit_category="LIABILITY",
            credit_code="REVENUE:DELIVERY", credit_name="Delivery service revenue", credit_category="REVENUE",
            source="DELIVERY_PAYMENT", source_reference=payment.payment_reference, actor=actor, order_reference=agreement.order.reference)
    from .revenue_engine import apply_freight_revenue

    apply_freight_revenue(payment, actor=actor)
    if payment.tax_amount is None:
        return payment
    if payment.tax_amount > 0:
        post_journal_entry(reference=f"delivery-tax:{payment.pk}", category="TAX_LIABILITY", amount=payment.tax_amount, currency=agreement.currency,
            debit_code="LIABILITY:DELIVERY_SETTLEMENT", debit_name="Delivery settlement payable", debit_category="LIABILITY",
            credit_code="LIABILITY:TAX_PAYABLE", credit_name="Tax payable", credit_category="LIABILITY",
            source="DELIVERY_PAYMENT", source_reference=payment.payment_reference, actor=actor, order_reference=agreement.order.reference)
    return payment


@transaction.atomic
def snapshot_delivery_pricing(agreement):
    if agreement.pricing_configuration_snapshot:
        return agreement
    config = resolve_delivery_pricing(agreement=agreement, actor=None)
    fee_base = agreement.amount
    raw_fee = config.fee_value if config.fee_type == DeliveryPricingConfiguration.FeeType.FIXED else (fee_base * config.fee_value / Decimal("100")).quantize(Decimal("0.01"))
    fee = min(config.maximum_fee, max(config.minimum_fee, raw_fee))
    if config.pricing_model == DeliveryPricingConfiguration.Model.PLATFORM_RETAINED:
        platform_fee, driver_charge, customer_amount = fee, fee_base - fee, fee_base
    else:
        platform_fee, driver_charge, customer_amount = fee, fee_base, fee_base + fee
    agreement.pricing_model_snapshot = config.pricing_model
    tax_configuration = _active_configuration(FinancialConfiguration.Kind.TAX, agreement.buyer_accepted_at)
    tax_rule = _matching_commission_rule(
        tax_configuration, seller_role="DRIVER", buyer_role="*",
        product_type=agreement.order.product.product_type,
        region_id=agreement.order.shipment_details.pickup_region_id,
        quantity=agreement.order.quantity, value=agreement.order.total_amount,
    ) if tax_configuration else None
    agreement.pricing_configuration_snapshot = {"configuration_id": str(config.pk), "fee_type": config.fee_type, "fee_value": str(config.fee_value), "minimum_fee": str(config.minimum_fee), "maximum_fee": str(config.maximum_fee), "effective_from": config.effective_from.isoformat(), "customer_amount": str(customer_amount), "driver_charge": str(driver_charge), "platform_fee": str(platform_fee), "tax_configuration_id": str(tax_configuration.pk) if tax_configuration else None, "tax_rule": tax_rule, "tax_amount": None}

    agreement.driver_charge_snapshot = driver_charge
    agreement.platform_fee_snapshot = platform_fee
    from .models import MarketplaceDeliveryFeeAgreement
    MarketplaceDeliveryFeeAgreement.objects.filter(pk=agreement.pk).update(pricing_model_snapshot=agreement.pricing_model_snapshot, pricing_configuration_snapshot=agreement.pricing_configuration_snapshot, driver_charge_snapshot=driver_charge, platform_fee_snapshot=platform_fee)
    return agreement


@transaction.atomic
def pay_delivery_compensation(payment_id, *, actor, payment_reference):
    if actor.role != Role.SUPER_ADMIN or not payment_reference:
        raise ValueError("A Super Admin and verified payout reference are required.")
    payment = DeliveryFeePayment.objects.select_for_update().select_related("agreement__order", "agreement__driver_payee").get(pk=payment_id)
    if payment.status != DeliveryFeePayment.Status.VERIFIED or payment.driver_charge <= 0:
        raise ValueError("Only verified payments with positive driver compensation can be paid.")
    if payment.compensation_paid_at:
        if payment.compensation_payment_reference != payment_reference:
            raise ValueError("Driver compensation was already paid with a different reference.")
        return payment
    entry = post_journal_entry(
        reference=f"delivery-driver-payout:{payment.pk}", category="DELIVERY_DRIVER_COMPENSATION_PAID",
        amount=payment.driver_charge, currency=payment.agreement.currency,
        debit_code="LIABILITY:DRIVER_WALLET", debit_name="Driver wallet liability", debit_category="LIABILITY",
        credit_code="ASSET:PAYMENT_CLEARING", credit_name="Verified payout clearing", credit_category="ASSET",
        source="DELIVERY_DRIVER_PAYOUT", source_reference=payment.payment_reference, actor=actor,
        related_user=payment.agreement.driver_payee, order_reference=payment.agreement.order.reference,
        description=f"Paid delivery compensation for {payment.agreement.order.reference}",
    )
    payment.compensation_paid_at = timezone.now()
    payment.compensation_payment_reference = payment_reference
    payment.compensation_paid_by = actor
    payment.compensation_journal_entry = entry
    payment.save(update_fields=["compensation_paid_at", "compensation_payment_reference", "compensation_paid_by", "compensation_journal_entry"])
    AuditLog.objects.create(actor=actor, action="DELIVERY_COMPENSATION_PAID", target=str(payment.pk), detail=payment_reference)
    return payment


def create_delivery_payment(*, agreement, actor, payment_reference, verified_amount=None, evidence_reference="", tax_amount=None):
    if not agreement.pricing_configuration_snapshot:
        snapshot_delivery_pricing(agreement)
    snapshot = agreement.pricing_configuration_snapshot
    config = DeliveryPricingConfiguration.objects.filter(pk=snapshot.get("configuration_id")).first()
    if config is None:
        raise ValueError("The agreement pricing configuration snapshot is unavailable.")
    fee_base = agreement.amount
    pricing_snapshot = agreement.pricing_configuration_snapshot
    platform_fee = Decimal(str(pricing_snapshot["platform_fee"]))
    driver_charge = Decimal(str(pricing_snapshot["driver_charge"]))
    customer_amount = Decimal(str(pricing_snapshot["customer_amount"]))
    fee = Decimal(str(pricing_snapshot["fee_value"]))
    if driver_charge < 0:
        raise ValueError("Configured platform fee exceeds the eligible delivery amount.")
    if config.pricing_model == DeliveryPricingConfiguration.Model.PLATFORM_RETAINED and platform_fee >= fee_base:
        raise ValueError("Platform-retained fee must be less than the delivery agreement amount.")
    snapshot_tax_id = (agreement.pricing_configuration_snapshot or {}).get("tax_configuration_id")
    tax_configuration = FinancialConfiguration.objects.filter(pk=snapshot_tax_id).first() if snapshot_tax_id else None
    tax_rule = (agreement.pricing_configuration_snapshot or {}).get("tax_rule")
    snapshot_tax_id = (agreement.pricing_configuration_snapshot or {}).get("tax_configuration_id")
    if snapshot_tax_id is None and tax_configuration is not None:
        raise ValueError("An approved delivery tax rule exists but was not snapshotted at agreement acceptance.")
    if snapshot_tax_id:
        tax_configuration = FinancialConfiguration.objects.filter(pk=snapshot_tax_id).first()
        if tax_configuration is None:
            raise ValueError("The agreement tax configuration snapshot is unavailable.")
        tax_rule = (agreement.pricing_configuration_snapshot or {}).get("tax_rule")
    tax_amount = None
    original_platform_fee = platform_fee
    if tax_rule is not None:
        try:
            tax_rate = Decimal(str(tax_rule.get("rate", "0")))
            tax_base = Decimal(str(tax_rule.get("tax_base", "0")))
        except (ArithmeticError, TypeError, ValueError) as exc:
            raise ValueError("Delivery tax rule requires decimal rate and tax_base values.") from exc
        if tax_rate < 0 or tax_rate > 1 or tax_base < 0 or tax_base > platform_fee:
            raise ValueError("Delivery tax rate or taxable platform-fee base is invalid.")
        tax_amount = (tax_base * tax_rate).quantize(Decimal("0.01"))
        if tax_amount > platform_fee:
            raise ValueError("Delivery tax exceeds the platform fee allocation.")
        platform_fee = original_platform_fee - tax_amount
    if not payment_reference:
        raise ValueError("A unique payment reference is required.")
    payment, created = DeliveryFeePayment.objects.get_or_create(payment_reference=payment_reference, defaults={
        "agreement": agreement, "pricing_configuration": config, "tax_configuration": tax_configuration,
        "pricing_model": agreement.pricing_model_snapshot or config.pricing_model,
        "fee_type": config.fee_type, "fee_value": config.fee_value, "customer_amount": customer_amount,
        "driver_charge": driver_charge, "platform_fee": platform_fee, "tax_amount": tax_amount,
    })
    expected = (agreement.pk, customer_amount, driver_charge, original_platform_fee - (tax_amount or Decimal("0")), tax_amount, config.pk, tax_configuration.pk if tax_configuration else None)
    actual = (payment.agreement_id, payment.customer_amount, payment.driver_charge, payment.platform_fee, payment.tax_amount, payment.pricing_configuration_id, payment.tax_configuration_id)
    if not created and actual != expected:
        raise ValueError("Payment reference already belongs to different delivery payment data.")
    if not created and payment.status == DeliveryFeePayment.Status.VERIFIED:
        return payment
    if agreement.pricing_model_snapshot == "":
        agreement.pricing_model_snapshot = config.pricing_model
    agreement.pricing_configuration_snapshot = {"configuration_id": str(config.pk), "fee_type": config.fee_type, "fee_value": str(config.fee_value), "minimum_fee": str(config.minimum_fee), "maximum_fee": str(config.maximum_fee), "effective_from": config.effective_from.isoformat(), "customer_amount": str(customer_amount), "driver_charge": str(driver_charge), "platform_fee": str(original_platform_fee), "tax_configuration_id": str(tax_configuration.pk) if tax_configuration else None, "tax_rule": tax_rule, "tax_amount": str(tax_amount) if tax_amount is not None else None}
    agreement.driver_charge_snapshot = driver_charge
    agreement.platform_fee_snapshot = original_platform_fee
    from .models import MarketplaceDeliveryFeeAgreement
    MarketplaceDeliveryFeeAgreement.objects.filter(pk=agreement.pk).update(pricing_model_snapshot=agreement.pricing_model_snapshot, pricing_configuration_snapshot=agreement.pricing_configuration_snapshot, driver_charge_snapshot=driver_charge, platform_fee_snapshot=original_platform_fee, tax_amount_snapshot=tax_amount)
    if verified_amount is not None or evidence_reference:
        return verify_delivery_payment(payment.pk, actor=actor, verified_amount=verified_amount, evidence_reference=evidence_reference)
    return payment


@transaction.atomic
def process_financial_refund(refund_id, *, actor, action, reference="", successful=None):
    refund = FinancialRefundRequest.objects.select_for_update().select_related("order").get(pk=refund_id)
    if action in ("approve", "reject"):
        if actor.role != Role.SUPER_ADMIN:
            raise ValueError("Only Super Admin can review refunds.")
        if refund.status != FinancialRefundRequest.Status.PENDING:
            raise ValueError("Only pending refunds may be reviewed.")
        if action == "approve":
            snapshot = FinancialOrderSnapshot.objects.filter(order=refund.order).first()
            if not snapshot:
                raise ValueError("Only settled orders with a financial snapshot may be refunded.")
            reserved = FinancialRefundRequest.objects.filter(order=refund.order, status__in=[FinancialRefundRequest.Status.APPROVED, FinancialRefundRequest.Status.EXECUTING, FinancialRefundRequest.Status.PAID, FinancialRefundRequest.Status.RECONCILED]).exclude(pk=refund.pk).aggregate(total=models.Sum("amount"))["total"] or Decimal("0")
            if refund.amount + reserved > snapshot.gross_order_value:
                raise ValueError("Refund amount exceeds the remaining settled marketplace amount.")
        refund.status = FinancialRefundRequest.Status.APPROVED if action == "approve" else FinancialRefundRequest.Status.REJECTED
        refund.reviewed_by = actor
        refund.approval_reference = reference
        refund.save(update_fields=["status", "reviewed_by", "approval_reference"])
        AuditLog.objects.create(actor=actor, action=f"FINANCIAL_REFUND_{action.upper()}D", target=str(refund.pk), detail=reference)
        return refund
    if action == "execute":
        if actor.role != Role.SUPER_ADMIN or refund.status != FinancialRefundRequest.Status.APPROVED or not reference:
            raise ValueError("Approved refunds require a Super Admin and payment reference.")
        if successful is not True:
            refund.status = FinancialRefundRequest.Status.FAILED
            refund.payment_reference = reference
            refund.save(update_fields=["status", "payment_reference"])
            return refund
        snapshot = FinancialOrderSnapshot.objects.filter(order=refund.order).first()
        already_refunded = FinancialJournalEntry.objects.filter(order_reference=refund.order.reference, category="ORDER_REFUND", status=FinancialJournalEntry.Status.REVERSED).aggregate(total=models.Sum("amount"))["total"] or Decimal("0")
        if not snapshot or refund.amount + already_refunded > snapshot.gross_order_value:
            raise ValueError("Refund amount exceeds the remaining settled marketplace amount.")
        original = FinancialJournalEntry.objects.filter(order_reference=refund.order.reference, category="ESCROW_RELEASE").first()
        if original is None:
            raise ValueError("Settled source journal entry not found.")
        entry = post_journal_entry(reference=f"refund:{refund.pk}", category="ORDER_REFUND", amount=refund.amount, currency=original.currency,
            debit_code="CONTRA_REVENUE:REFUNDS", debit_name="Customer refunds", debit_category="EXPENSE",
            credit_code="ASSET:PAYMENT_CLEARING", credit_name="Refund settlement clearing", credit_category="ASSET",
            source="FINANCIAL_REFUND", source_reference=str(refund.pk), actor=actor,
            description=f"Executed refund against {refund.order.reference}; original {original.reference}", order_reference=refund.order.reference,
            status=FinancialJournalEntry.Status.REVERSED, reverses=original)
        refund.status = FinancialRefundRequest.Status.PAID
        refund.paid_at = timezone.now()
        refund.payment_reference = reference
        refund.journal_entry = entry
        refund.save(update_fields=["status", "paid_at", "payment_reference", "journal_entry"])
        AuditLog.objects.create(actor=actor, action="FINANCIAL_REFUND_PAID", target=str(refund.pk), detail=reference)
        return refund
    if action == "reconcile" and actor.role == Role.SUPER_ADMIN and refund.status == FinancialRefundRequest.Status.PAID and reference == refund.payment_reference:
        refund.status = FinancialRefundRequest.Status.RECONCILED
        refund.save(update_fields=["status"])
        return refund
    raise ValueError("Unsupported refund action or invalid transition.")


def reconcile_financial_sources():
    from .models import Order, OrderPaymentStatus, OrderStatus, WalletTransaction
    issues = []
    for payment in DeliveryFeePayment.objects.select_related("agreement").iterator():
        journal = FinancialJournalEntry.objects.filter(source="DELIVERY_PAYMENT", source_reference=payment.payment_reference)
        if payment.status == DeliveryFeePayment.Status.VERIFIED:
            expected = {"DELIVERY_CUSTOMER_PAYMENT"}
            if payment.driver_charge > 0:
                expected.add("DELIVERY_DRIVER_COMPENSATION")
            if payment.platform_fee > 0:
                expected.add("DELIVERY_SERVICE_REVENUE")
            if payment.tax_amount and payment.tax_amount > 0:
                expected.add("TAX_LIABILITY")
            actual = set(journal.values_list("category", flat=True))
            if actual != expected:
                issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "delivery_journal_components_mismatch", "expected": sorted(expected), "actual": sorted(actual)})
            payout = FinancialJournalEntry.objects.filter(source="DELIVERY_DRIVER_PAYOUT", source_reference=payment.payment_reference, category="DELIVERY_DRIVER_COMPENSATION_PAID").first()
            if payment.compensation_paid_at and (payout is None or payout.amount != payment.driver_charge):
                issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "driver_compensation_payout_mismatch"})
            if not payment.compensation_paid_at and payout is not None:
                issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "driver_compensation_marked_unpaid_with_payout"})
            if payment.tax_amount and payment.tax_amount > 0 and not payment.tax_configuration_id:
                issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "delivery_tax_without_configuration"})
            allocated = payment.driver_charge + payment.platform_fee + (payment.tax_amount or Decimal("0"))
            if allocated != payment.customer_amount:
                issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "delivery_allocations_do_not_balance"})
        elif journal.exists():
            issues.append({"source": "delivery_payment", "reference": payment.payment_reference, "issue": "unverified_payment_has_journal_entries"})
    for order in Order.objects.filter(status=OrderStatus.COMPLETED, payment_status=OrderPaymentStatus.RELEASED).iterator():
        if not FinancialJournalEntry.objects.filter(source="ORDER_ESCROW", source_reference=order.reference, category="ESCROW_RELEASE").exists():
            issues.append({"source": "order", "reference": order.reference, "issue": "released_order_missing_escrow_journal"})
        if not FinancialOrderSnapshot.objects.filter(order=order).exists():
            issues.append({"source": "order", "reference": order.reference, "issue": "released_order_missing_financial_snapshot"})
    for tx in WalletTransaction.objects.filter(transaction_type="DELIVERY_FEE_EARNING").iterator():
        if tx.order_id and not FinancialJournalEntry.objects.filter(source_reference=str(tx.order.delivery_fee_agreement_id) if hasattr(tx.order, "delivery_fee_agreement_id") else "", category="DELIVERY_FEE_EARNING").exists():
            if not FinancialJournalEntry.objects.filter(source="DELIVERY_FEE_AGREEMENT", source_reference__in=[]).exists():
                issues.append({"source": "driver_earning", "reference": tx.reference, "issue": "driver_earning_source_unlinked_check_needed"})
    return {"complete": not issues, "issue_count": len(issues), "discrepancies": issues}


def pay_approved_expense(expense_id, *, actor, payment_reference):
    if not payment_reference:
        raise ValueError("A payment reference is required.")
    expense = FinancialOperatingExpense.objects.select_for_update().get(pk=expense_id)
    if expense.status == FinancialOperatingExpense.Status.PAID:
        if expense.journal_entry:
            return expense
        raise ValueError("Paid expense is missing its journal entry.")
    if expense.status != FinancialOperatingExpense.Status.APPROVED:
        raise ValueError("Only approved expenses may be paid.")
    entry = post_journal_entry(
        reference=f"expense:{expense.pk}", category="OPERATING_EXPENSE",
        amount=expense.amount, currency=expense.currency,
        debit_code="EXPENSE:OPERATING", debit_name="Operating expenses", debit_category="EXPENSE",
        credit_code="LIABILITY:PAYABLE", credit_name="Operating expense payable", credit_category="LIABILITY",
        source="OPERATING_EXPENSE", source_reference=str(expense.pk), actor=actor,
        description=expense.description,
    )
    expense.status = FinancialOperatingExpense.Status.PAID
    expense.journal_entry = entry
    expense.review_reason = payment_reference
    expense.save(update_fields=["status", "journal_entry", "review_reason"])
    AuditLog.objects.create(actor=actor, action="FINANCIAL_EXPENSE_PAID", target=str(expense.pk), detail=payment_reference)
    return expense


@transaction.atomic
def pay_approved_payroll(payroll_id, *, actor, payment_reference):
    if not payment_reference:
        raise ValueError("A payment reference is required.")
    payroll = FinancialPayrollRecord.objects.select_for_update().get(pk=payroll_id)
    if payroll.status == FinancialPayrollRecord.Status.PAID:
        if payroll.journal_entry:
            return payroll
        raise ValueError("Paid payroll is missing its journal entry.")
    if payroll.status != FinancialPayrollRecord.Status.APPROVED:
        raise ValueError("Only approved payroll may be paid.")
    amount = payroll.net_amount
    if amount <= 0:
        raise ValueError("Payroll net amount must be greater than zero.")
    entry = post_journal_entry(
        reference=f"payroll:{payroll.pk}", category="PAYROLL",
        amount=amount, currency=payroll.currency,
        debit_code="EXPENSE:PAYROLL", debit_name="Payroll expenses", debit_category="EXPENSE",
        credit_code="LIABILITY:PAYROLL", credit_name="Payroll payable", credit_category="LIABILITY",
        source="PAYROLL", source_reference=str(payroll.pk), actor=actor,
        description=f"Payroll payment for {payroll.employee_id}", related_user=payroll.employee,
    )
    # Credit the employee's platform wallet with the net salary: the system's
    # obligation moves from "payroll payable" into the staff member's own
    # balance, which they can then withdraw through the payout-request flow.
    from payments.models import Wallet
    wallet, _created = Wallet.objects.get_or_create(user=payroll.employee)
    wallet.available_balance = (wallet.available_balance or Decimal("0")) + amount
    wallet.save(update_fields=["available_balance"])

    payroll.status = FinancialPayrollRecord.Status.PAID
    payroll.paid_at = timezone.now()
    payroll.payment_reference = payment_reference
    payroll.journal_entry = entry
    payroll.save(update_fields=["status", "paid_at", "payment_reference", "journal_entry"])
    AuditLog.objects.create(actor=actor, action="PAYROLL_PAID", target=str(payroll.pk), detail=payment_reference)

    from notifications.services import notify
    notify(
        user_ids=[payroll.employee_id],
        type="PAYMENT",
        message=(
            f"Your salary for the period {payroll.period_start} to {payroll.period_end} "
            f"({amount} {payroll.currency}) has been credited to your wallet."
        ),
        actor=actor,
        target_url="/wallet",
    )
    return payroll
