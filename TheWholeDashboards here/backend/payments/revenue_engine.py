"""Revenue methods engine — payer responsibility, earnings and third-party payables.

Every fee the platform charges passes through :func:`record_charge`, which
persists one :class:`RevenueCharge` row naming the revenue method, the
transaction or service that produced it, the participant who generated the
activity, the participant who pays, the amount charged and collected, the amount
earned by the company, any third-party payable and the settlement status.

Design rules enforced here:

* Only approved, effective :class:`RevenueMethod` rows can charge anyone.
* Only marketplace participants pay (farmer, wholesaler, retailer, driver).
  Shops and consumers are not modelled and are rejected.
* A method that requires an agreement cannot charge without an ACTIVE
  ``BusinessAgreement`` on the order.
* A charge is idempotent: the same reference returns the recorded row instead of
  charging twice.
* Financial Controls calculates commission amounts. Revenue Methods authorizes
  each stream and supplies the payer; the charge record and journal entry are
  created together through the idempotent charge path.
* Driver payments are third-party payables, never company revenue.
"""
from decimal import Decimal
from hashlib import sha256

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from users.models import AuditLog, Role

from .financial_models import (
    AdvertisingPackage,
    AdvertisingPurchase,
    FinancialJournalEntry,
    RevenueCharge,
    RevenueMethod,
    RevenueSourceConfig,
)
from .models import Wallet, WalletTransaction, WalletTransactionType
from .financial_services import post_journal_entry

PARTICIPANT_ROLES = {Role.FARMER, Role.WHOLESALER, Role.RETAILER, Role.DRIVER}
ADVERTISER_ROLES = {Role.WHOLESALER, Role.RETAILER}

# method -> ledger category
CATEGORY = {
    RevenueMethod.Method.SELLER_COMMISSION: "MARKETPLACE_COMMISSION",
    RevenueMethod.Method.BUYER_COMMISSION: "MARKETPLACE_BUYER_FEE",
    RevenueMethod.Method.PER_QUINTAL_FEE: "MARKETPLACE_TRANSACTION_FEE",
    RevenueMethod.Method.FIXED_TRANSACTION_FEE: "MARKETPLACE_TRANSACTION_FEE",
    RevenueMethod.Method.INSPECTION_FEE: "INSPECTION_REVENUE",
    RevenueMethod.Method.FREIGHT_MARGIN: "DELIVERY_SERVICE_REVENUE",
    RevenueMethod.Method.SUBSCRIPTION_FEE: "SUBSCRIPTION_REVENUE",
    RevenueMethod.Method.ADVERTISING_FEE: "ADVERTISING_REVENUE",
}

# category -> (credit account code, credit account name)
CREDIT_ACCOUNT = {
    "MARKETPLACE_COMMISSION": ("REVENUE:COMMISSION", "Marketplace commission revenue"),
    "MARKETPLACE_BUYER_FEE": ("REVENUE:BUYER_FEES", "Buyer service fee revenue"),
    "MARKETPLACE_TRANSACTION_FEE": ("REVENUE:TRANSACTION_FEES", "Transaction fee revenue"),
    "INSPECTION_REVENUE": ("REVENUE:INSPECTION", "Inspection and verification revenue"),
    "DELIVERY_SERVICE_REVENUE": ("REVENUE:DELIVERY", "Delivery service revenue"),
    "SUBSCRIPTION_REVENUE": ("REVENUE:SUBSCRIPTION", "Subscription revenue"),
    "ADVERTISING_REVENUE": ("REVENUE:ADVERTISING", "Advertising revenue"),
}

# payer party -> (debit account code, debit account name)
DEBIT_ACCOUNT = {
    RevenueCharge.PayerParty.SELLER: ("LIABILITY:SELLER_WALLET", "Seller wallet liability"),
    RevenueCharge.PayerParty.BUYER: ("LIABILITY:BUYER_WALLET", "Buyer wallet liability"),
    RevenueCharge.PayerParty.SHIPPER: ("LIABILITY:DELIVERY_SETTLEMENT", "Delivery settlement payable"),
    RevenueCharge.PayerParty.ADVERTISER: ("LIABILITY:BUYER_WALLET", "Advertiser wallet liability"),
    RevenueCharge.PayerParty.SUBSCRIBER: ("LIABILITY:PARTICIPANT_WALLET", "Participant wallet liability"),
    RevenueCharge.PayerParty.REQUESTING_PARTY: ("LIABILITY:PARTICIPANT_WALLET", "Participant wallet liability"),
    RevenueCharge.PayerParty.CONTRACTUAL_PARTY: ("LIABILITY:PARTICIPANT_WALLET", "Participant wallet liability"),
}

COMMISSION_METHODS = {RevenueMethod.Method.SELLER_COMMISSION, RevenueMethod.Method.BUYER_COMMISSION}

# Revenue method -> the Super Admin revenue-source switch that governs it.
# A source switched off is a master stop: no method under it can charge anyone.
SOURCE_BY_METHOD = {
    RevenueMethod.Method.SELLER_COMMISSION: RevenueSourceConfig.Source.MARKETPLACE_COMMISSION,
    RevenueMethod.Method.BUYER_COMMISSION: RevenueSourceConfig.Source.BUYER_FEE,
    RevenueMethod.Method.PER_QUINTAL_FEE: RevenueSourceConfig.Source.MARKETPLACE_COMMISSION,
    RevenueMethod.Method.FIXED_TRANSACTION_FEE: RevenueSourceConfig.Source.MARKETPLACE_COMMISSION,
    RevenueMethod.Method.INSPECTION_FEE: RevenueSourceConfig.Source.INSPECTION,
    RevenueMethod.Method.FREIGHT_MARGIN: RevenueSourceConfig.Source.FREIGHT_MARGIN,
    RevenueMethod.Method.SUBSCRIPTION_FEE: RevenueSourceConfig.Source.SUBSCRIPTION,
    RevenueMethod.Method.ADVERTISING_FEE: RevenueSourceConfig.Source.ADVERTISING,
}


def money(value):
    return Decimal(value or 0).quantize(Decimal("0.01"))


def debit_available_wallet(*, user, amount, reference, actor, description, order=None):
    """Collect one approved amount from a participant wallet exactly once."""
    amount = money(amount)
    _require_participant(user, label="Payer")
    wallet, _ = Wallet.objects.get_or_create(user=user)
    wallet = Wallet.objects.select_for_update().get(pk=wallet.pk)
    if wallet.available_balance < amount:
        raise ValueError(
            f"{user.full_name} has insufficient available wallet funds to pay {amount} ETB."
        )
    wallet.available_balance -= amount
    wallet.save(update_fields=["available_balance", "updated_at"])
    WalletTransaction.objects.create(
        wallet=wallet, order=order,
        transaction_type=WalletTransactionType.REVENUE_CHARGE,
        amount=amount, available_delta=-amount, held_delta=Decimal("0.00"),
        reference=reference, actor=actor, description=description,
    )
    return amount


def quintals(quantity, unit_of_measure):
    """Express the order quantity in quintals (1 quintal = 100 kg)."""
    units = (unit_of_measure or "").strip().lower()
    amount = Decimal(str(quantity or 0))
    if units in {"kg", "kilogram", "kilograms"}:
        return amount / Decimal("100")
    return amount


def compute_amount(*, calculation, rate, fixed_fee, unit_fee, gross, quantity):
    rate = Decimal(str(rate or 0))
    fixed = Decimal(str(fixed_fee or 0))
    unit = Decimal(str(unit_fee or 0))
    if calculation == RevenueMethod.Calculation.PERCENTAGE:
        return money(Decimal(str(gross or 0)) * rate + fixed)
    if calculation == RevenueMethod.Calculation.FIXED:
        return money(fixed)
    if calculation == RevenueMethod.Calculation.PER_UNIT:
        return money(Decimal(str(quantity or 0)) * unit + fixed)
    raise ValueError(f"Unknown calculation method: {calculation}")


def revenue_source_config(method):
    """The Super Admin switch + defaults for the source behind one method."""
    source = SOURCE_BY_METHOD.get(method)
    if source is None:
        return None
    return RevenueSourceConfig.objects.filter(source=source).first()


def revenue_source_enabled(method):
    """Master switch. Sources without a config row stay enabled."""
    config = revenue_source_config(method)
    return config is None or config.enabled


def effective_terms(rule):
    """Rate/fixed/unit actually charged for an approved method.

    A method that leaves all pricing blank inherits the Super Admin defaults for
    its revenue source. The method must still be approved: defaults never let an
    unapproved rule charge anyone.
    """
    if rule.rate or rule.fixed_fee or rule.unit_fee:
        return rule.rate, rule.fixed_fee, rule.unit_fee
    config = revenue_source_config(rule.method)
    if config is None or not (config.default_percentage_rate or config.default_fixed_fee):
        return rule.rate, rule.fixed_fee, rule.unit_fee
    return config.default_percentage_rate, config.default_fixed_fee, rule.unit_fee


def active_methods(transaction_type, at=None):
    """Latest effective approved row per method for one transaction type.

    Methods whose revenue source the Super Admin switched off are never
    returned, which stops every charge that would come from them.
    """
    at = at or timezone.now()
    disabled_sources = set(
        RevenueSourceConfig.objects.filter(enabled=False).values_list("source", flat=True)
    )
    rows = (
        RevenueMethod.objects.filter(
            transaction_type=transaction_type,
            approved_by__isnull=False,
            approved_at__lte=at,
            effective_from__lte=at,
        )
        .order_by("method", "-effective_from", "-created_at")
    )
    latest = {}
    for row in rows:
        if SOURCE_BY_METHOD.get(row.method) in disabled_sources:
            continue
        latest.setdefault(row.method, row)
    return {
        method: row for method, row in latest.items()
        if row.is_effective(at)
    }


def transaction_type_for(order):
    seller, buyer = order.seller, order.buyer
    if seller is None or buyer is None:
        return None
    if seller.role == Role.FARMER and buyer.role == Role.WHOLESALER:
        return RevenueMethod.TransactionType.FARMER_WHOLESALER
    if seller.role == Role.WHOLESALER and buyer.role == Role.RETAILER:
        return RevenueMethod.TransactionType.WHOLESALER_RETAILER
    return None


def _require_participant(user, *, label):
    if user is None:
        raise ValueError(f"{label} must be a marketplace participant.")
    if user.role not in PARTICIPANT_ROLES:
        raise ValueError(f"{label} must be a farmer, wholesaler, retailer or driver; {user.role} cannot pay platform fees.")
    return user


def resolve_payers(rule, *, seller, buyer, requesting_party=None, contractual_party=None):
    """Return [(payer_party, payer_user, calculation, rate, fixed_fee, unit_fee)]."""
    payer = rule.payer
    rate, fixed, unit = effective_terms(rule)
    if payer == RevenueMethod.Payer.SELLER:
        _require_participant(seller, label="Seller")
        return [(RevenueCharge.PayerParty.SELLER, seller, rule.calculation, rate, fixed, unit)]
    if payer == RevenueMethod.Payer.BUYER:
        _require_participant(buyer, label="Buyer")
        return [(RevenueCharge.PayerParty.BUYER, buyer, rule.calculation, rate, fixed, unit)]
    if payer == RevenueMethod.Payer.BOTH:
        _require_participant(seller, label="Seller")
        _require_participant(buyer, label="Buyer")
        return [
            (RevenueCharge.PayerParty.SELLER, seller, RevenueMethod.Calculation.PERCENTAGE, rule.seller_rate, rule.seller_fixed_fee, Decimal("0")),
            (RevenueCharge.PayerParty.BUYER, buyer, RevenueMethod.Calculation.PERCENTAGE, rule.buyer_rate, rule.buyer_fixed_fee, Decimal("0")),
        ]
    if payer == RevenueMethod.Payer.REQUESTING_PARTY:
        party = _require_participant(requesting_party, label="Requesting party")
        return [(RevenueCharge.PayerParty.REQUESTING_PARTY, party, rule.calculation, rate, fixed, unit)]
    if payer == RevenueMethod.Payer.CONTRACTUAL_PARTY:
        party = _require_participant(contractual_party, label="Contractually assigned party")
        return [(RevenueCharge.PayerParty.CONTRACTUAL_PARTY, party, rule.calculation, rate, fixed, unit)]
    raise ValueError(f"Unknown payer assignment: {payer}")


def commission_payer(order, method, *, at=None):
    """Return the approved, event-effective payer for a commission stream."""
    ttype = transaction_type_for(order)
    if ttype is None:
        return "", None
    rule = active_methods(ttype, at=at).get(method)
    if rule is None:
        return "", None
    try:
        rows = resolve_payers(
            rule, seller=order.seller, buyer=order.buyer, requesting_party=order.buyer,
            contractual_party=getattr(getattr(order, "agreement", None), "contractual_payer", None),
        )
    except ValueError:
        return "", None
    return rows[0][0], rows[0][1]


def _agreement_for(order):
    from .models import AgreementStatus

    agreement = getattr(order, "agreement", None)
    if agreement is None or agreement.status != AgreementStatus.ACTIVE:
        return None
    return agreement


def plan_order_charges(order, *, snapshot, at=None):
    """Build the charge plan for an order without posting anything."""
    ttype = transaction_type_for(order)
    if ttype is None:
        return []
    methods = active_methods(ttype, at=at)
    if not methods:
        return []
    agreement = _agreement_for(order)
    unit = getattr(order.product, "unit_of_measure", "") or getattr(order.product, "unit", "")
    quantity_in_quintals = quintals(order.quantity, unit)
    gross = money(order.total_amount)
    plan = []
    for method, rule in methods.items():
        if rule.requires_agreement and agreement is None:
            raise ValueError(
                f"{rule.get_method_display()} requires an active approved agreement; order {order.reference} has none."
            )
        agreement_reference = str(agreement.pk) if agreement is not None else ""
        if method in COMMISSION_METHODS:
            amount = snapshot.commission_amount if method == RevenueMethod.Method.SELLER_COMMISSION else snapshot.buyer_fee_amount
            if amount is None or money(amount) <= 0:
                continue
            for party, user, _calc, _rate, _fixed, _unit in resolve_payers(
                rule, seller=order.seller, buyer=order.buyer,
                requesting_party=order.buyer,
                contractual_party=getattr(agreement, "contractual_payer", None) if agreement else None,
            ):
                plan.append({
                    "rule": rule, "method": method, "payer_party": party, "payer_user": user,
                    "amount": money(amount), "agreement_reference": agreement_reference,
                })
            continue
        for party, user, calc, rate, fixed, unit_fee in resolve_payers(
            rule, seller=order.seller, buyer=order.buyer,
            requesting_party=order.buyer,
            contractual_party=getattr(agreement, "contractual_payer", None) if agreement else None,
        ):
            amount = compute_amount(
                calculation=calc, rate=rate, fixed_fee=fixed, unit_fee=unit_fee,
                gross=gross, quantity=quantity_in_quintals,
            )
            if amount <= 0:
                continue
            plan.append({
                "rule": rule, "method": method, "payer_party": party, "payer_user": user,
                "amount": amount, "agreement_reference": agreement_reference,
            })
    return plan


@transaction.atomic
def record_charge(
    *, reference, rule, method, transaction_type, source_type, source_reference,
    service_amount, generating_user, payer_party, payer_user, amount_charged,
    amount_collected=None, company_share_percentage=None, company_earned_amount=None,
    revenue_amount=None, third_party_payable=Decimal("0"),
    third_party_payee=None, currency="ETB", agreement_reference="", actor,
    existing_entry=None, description="", configuration=None, wallet_withheld=False, order=None,
    approved_agreement_snapshot=False,
):
    """Persist one fee record and (unless already posted) its ledger entry."""
    if not approved_agreement_snapshot and not revenue_source_enabled(method):
        raise ValueError(
            f"{method} is switched off in the Super Admin revenue source settings."
        )
    existing = RevenueCharge.objects.filter(reference=reference).first()
    charged = money(amount_charged)
    if existing is not None:
        if money(existing.amount_charged) != charged:
            raise ValueError("Revenue charge reference already exists for a different amount.")
        return existing
    if charged <= 0:
        raise ValueError("A revenue charge must be greater than zero.")
    if payer_party != RevenueCharge.PayerParty.SHIPPER and payer_party != RevenueCharge.PayerParty.ADVERTISER:
        _require_participant(payer_user, label="Payer")
    category = CATEGORY[method]
    credit_code, credit_name = CREDIT_ACCOUNT[category]
    debit_code, debit_name = DEBIT_ACCOUNT[payer_party]
    entry = existing_entry
    already_collected_in_existing_entry = existing_entry is not None
    recognised = charged if revenue_amount is None else money(revenue_amount)
    if entry is None:
        entry = post_journal_entry(
            reference=reference, category=category, amount=recognised, currency=currency,
            debit_code=debit_code, debit_name=debit_name, debit_category="LIABILITY",
            credit_code=credit_code, credit_name=credit_name, credit_category="REVENUE",
            source=source_type, source_reference=source_reference, actor=actor,
            description=description or f"{method} charged to {payer_party}",
            related_user=payer_user, order_reference=source_reference if source_type == "ORDER" else "",
            revenue_method=method, payer_party=payer_party, payer_user=payer_user,
            configuration=configuration,
        )
    wallet_collection = Decimal("0.00")
    if already_collected_in_existing_entry or wallet_withheld:
        wallet_collection = charged
    else:
        wallet_reference = f"REVFEE-{sha256(reference.encode('utf-8')).hexdigest()[:32]}"
        debit_available_wallet(
            user=payer_user, amount=charged, reference=wallet_reference, actor=actor,
            order=order if source_type == "ORDER" else None,
            description=description or f"Approved {method} fee charged to wallet",
        )
        wallet_collection = charged
    if company_earned_amount is not None:
        company_earned = money(company_earned_amount)
    else:
        share = Decimal("100") if company_share_percentage is None else Decimal(str(company_share_percentage))
        company_earned = money(charged * share / Decimal("100"))
    third_party = money(third_party_payable)
    collected = wallet_collection if amount_collected is None else money(amount_collected)
    status = RevenueCharge.SettlementStatus.COLLECTED if collected >= charged else (
        RevenueCharge.SettlementStatus.PARTIALLY_COLLECTED if collected > 0 else RevenueCharge.SettlementStatus.PENDING
    )
    charge = RevenueCharge.objects.create(
        reference=reference, rule=rule, transaction_type=transaction_type, method=method,
        source_type=source_type, source_reference=source_reference,
        service_amount=money(service_amount), generating_user=generating_user,
        payer_party=payer_party, payer_user=payer_user,
        agreement_reference=agreement_reference,
        amount_charged=charged, amount_collected=collected,
        amount_company_earned=company_earned, third_party_payable=third_party,
        third_party_payee=third_party_payee, currency=currency,
        settlement_status=status, journal_entry=entry,
        collected_at=timezone.now() if collected > 0 else None,
        created_by=actor,
    )
    AuditLog.objects.create(
        actor=actor, action="REVENUE_CHARGE_RECORDED", target=reference,
        detail=f"{method} charged={charged} collected={collected} company={company_earned} third_party={third_party} payer={payer_party}",
    )
    return charge


def apply_order_revenue_methods(order, *, actor, at=None, fee_terms_snapshot=None):
    """Record every configured revenue method for a settled order.

    Financial Controls supplies commission amounts; Revenue Methods authorizes
    each stream and supplies its payer. Every fee uses the same idempotent
    posting path, preventing duplicate charges and double counting.
    """
    from .financial_models import FinancialOrderSnapshot

    snapshot = FinancialOrderSnapshot.objects.filter(order=order).first()
    if snapshot is None:
        return []
    if fee_terms_snapshot is None:
        plan = plan_order_charges(order, snapshot=snapshot, at=at)
    else:
        from django.contrib.auth import get_user_model

        rule_ids = [line["revenue_method_id"] for line in fee_terms_snapshot.get("fee_lines", [])]
        payer_ids = [line["payer_user_id"] for line in fee_terms_snapshot.get("fee_lines", [])]
        rules = {str(pk): row for pk, row in RevenueMethod.objects.in_bulk(rule_ids).items()}
        users = {str(pk): row for pk, row in get_user_model().objects.in_bulk(payer_ids).items()}
        plan = []
        for line in fee_terms_snapshot.get("fee_lines", []):
            rule = rules.get(line["revenue_method_id"])
            payer = users.get(line["payer_user_id"])
            if rule is None or payer is None:
                raise ValueError("An accepted fee term points to a missing approved method or payer.")
            plan.append({
                "rule": rule,
                "method": line["method"],
                "payer_party": line["payer_party"],
                "payer_user": payer,
                "amount": money(line["amount"]),
                "agreement_reference": line.get("agreement_reference", ""),
                "approved_agreement_snapshot": True,
            })
    charges = []
    for item in plan:
        existing_entry = None
        reference = f"RC:{item['method']}:{order.reference}:{item['payer_party']}"
        charges.append(record_charge(
            reference=reference, rule=item["rule"], method=item["method"],
            transaction_type=transaction_type_for(order), source_type="ORDER",
            source_reference=order.reference, service_amount=snapshot.gross_order_value,
            generating_user=order.seller, payer_party=item["payer_party"],
            payer_user=item["payer_user"], amount_charged=item["amount"],
            company_share_percentage=item["rule"].company_share_percentage,
            agreement_reference=item["agreement_reference"], actor=actor,
            existing_entry=existing_entry,
            configuration=snapshot.configuration if item["method"] in COMMISSION_METHODS else None,
            wallet_withheld=item["payer_user"] == order.seller,
            order=order,
            approved_agreement_snapshot=bool(item.get("approved_agreement_snapshot")),
            description=f"{item['rule'].get_method_display()} on order {order.reference}",
        ))
    return charges


def apply_freight_revenue(payment, *, actor):
    """Record the freight commission/margin; the driver charge stays a payable."""
    agreement = payment.agreement
    order = agreement.order
    rule = active_methods(RevenueMethod.TransactionType.FREIGHT).get(RevenueMethod.Method.FREIGHT_MARGIN)
    margin = money(payment.platform_fee)
    if rule is None or margin <= 0:
        return None
    if rule.requires_agreement and agreement.pk is None:
        return None
    shipper = order.buyer
    # The freight collection was already recognised as delivery revenue by
    # verify_delivery_payment; link that entry instead of posting the margin twice.
    existing_entry = FinancialJournalEntry.objects.filter(reference=f"delivery-platform:{payment.pk}").first()
    return record_charge(
        reference=f"RC:FREIGHT_MARGIN:{payment.payment_reference}:SHIPPER",
        rule=rule, method=RevenueMethod.Method.FREIGHT_MARGIN,
        transaction_type=RevenueMethod.TransactionType.FREIGHT, source_type="FREIGHT",
        source_reference=payment.payment_reference, service_amount=payment.customer_amount,
        generating_user=agreement.driver_payee, payer_party=RevenueCharge.PayerParty.SHIPPER,
        payer_user=shipper, amount_charged=payment.customer_amount,
        amount_collected=payment.customer_amount,
        company_earned_amount=margin, revenue_amount=margin,
        third_party_payable=payment.driver_charge, third_party_payee=agreement.driver_payee,
        agreement_reference=str(agreement.pk), actor=actor, existing_entry=existing_entry,
        description=f"Freight coordination margin on {order.reference}; driver charge is a payable, not revenue",
    )


def apply_subscription_revenue(subscription, *, actor):
    """The subscribing participant pays for their own plan."""
    plan = subscription.plan
    rule = active_methods(RevenueMethod.TransactionType.SUBSCRIPTION).get(RevenueMethod.Method.SUBSCRIPTION_FEE)
    if rule is None:
        return None
    user = subscription.user
    _require_participant(user, label="Subscriber")
    rate, fixed, unit = effective_terms(rule)
    amount = compute_amount(
        calculation=rule.calculation, rate=rate, fixed_fee=fixed,
        unit_fee=unit, gross=plan.price, quantity=1,
    )
    if amount <= 0:
        amount = money(plan.price)
    existing_entry = FinancialJournalEntry.objects.filter(reference=f"subscription:{subscription.pk}").first()
    return record_charge(
        reference=f"RC:SUBSCRIPTION_FEE:{subscription.pk}:SUBSCRIBER",
        rule=rule, method=RevenueMethod.Method.SUBSCRIPTION_FEE,
        transaction_type=RevenueMethod.TransactionType.SUBSCRIPTION, source_type="SUBSCRIPTION",
        source_reference=str(subscription.pk), service_amount=plan.price,
        generating_user=user, payer_party=RevenueCharge.PayerParty.SUBSCRIBER,
        payer_user=user, amount_charged=amount,
        company_share_percentage=rule.company_share_percentage,
        currency="ETB", actor=actor, existing_entry=existing_entry,
        description=f"{plan.name} subscription paid by the subscriber",
    )


@transaction.atomic
def purchase_advertising_package(package, advertiser, *, actor, payment_reference=""):
    """Advertiser pays for the approved promotional package (wholesaler/retailer only)."""
    if advertiser.role not in ADVERTISER_ROLES:
        raise ValueError("Advertising packages are sold to wholesalers and retailers only; shops and consumers are not eligible.")
    if not package.active:
        raise ValueError("This advertising package is not active.")
    rule = active_methods(RevenueMethod.TransactionType.ADVERTISING).get(RevenueMethod.Method.ADVERTISING_FEE)
    if rule is None:
        raise ValueError("No approved advertising revenue method is configured.")
    reference = payment_reference or f"ADS-{package.pk.hex[:8].upper()}-{int(timezone.now().timestamp())}"
    purchase = AdvertisingPurchase.objects.create(
        package=package, advertiser=advertiser, amount_paid=money(package.price),
        payment_reference=reference,
        ends_at=timezone.now() + timezone.timedelta(days=package.duration_days),
        created_by=actor,
    )
    rate, fixed, unit = effective_terms(rule)
    amount = compute_amount(
        calculation=rule.calculation, rate=rate, fixed_fee=fixed,
        unit_fee=unit, gross=package.price, quantity=1,
    )
    if amount <= 0:
        amount = money(package.price)
    charge = record_charge(
        reference=f"RC:ADVERTISING_FEE:{purchase.pk}:ADVERTISER",
        rule=rule, method=RevenueMethod.Method.ADVERTISING_FEE,
        transaction_type=RevenueMethod.TransactionType.ADVERTISING, source_type="ADVERTISING",
        source_reference=str(purchase.pk), service_amount=package.price,
        generating_user=advertiser, payer_party=RevenueCharge.PayerParty.ADVERTISER,
        payer_user=advertiser, amount_charged=amount,
        company_share_percentage=rule.company_share_percentage, actor=actor,
        description=f"Advertising package {package.name}",
    )
    purchase.journal_entry = charge.journal_entry
    purchase.save(update_fields=["journal_entry"])
    return purchase, charge


def freight_settlement_row(payment):
    """Explicit freight parties, amounts and which figure is company revenue."""
    agreement = payment.agreement
    order = agreement.order
    driver = agreement.driver_payee
    provider = driver.full_name if driver else (agreement.driver_external_user_id or "Unassigned")
    charge = RevenueCharge.objects.filter(
        source_type="FREIGHT", source_reference=payment.payment_reference,
    ).first()
    return {
        "payment_reference": payment.payment_reference,
        "order_reference": order.reference,
        "status": payment.status,
        "shipper": order.buyer.full_name if order.buyer else None,
        "shipper_role": order.buyer.role if order.buyer else None,
        "freight_payer": order.buyer.full_name if order.buyer else None,
        "driver": driver.full_name if driver else None,
        "transport_provider": provider,
        "freight_amount": str(payment.customer_amount),
        "transport_cost": str(payment.driver_charge),
        "driver_payment": str(payment.driver_charge),
        "counts_as_company_revenue": False,
        "company_freight_margin": str(payment.platform_fee),
        "tax_amount": str(payment.tax_amount) if payment.tax_amount is not None else None,
        "charge_reference": charge.reference if charge else None,
        "company_earned": str(charge.amount_company_earned) if charge else None,
        "third_party_payable": str(charge.third_party_payable) if charge else str(payment.driver_charge),
        "settlement_status": charge.settlement_status if charge else payment.status,
    }
