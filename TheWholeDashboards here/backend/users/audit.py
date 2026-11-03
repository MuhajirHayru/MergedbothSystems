"""Part 20 — audit helpers that capture request telemetry where available."""

from users.models import AuditLog


def _client_ip(request):
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.META.get("REMOTE_ADDR") or None


def _user_agent(request):
    return (request.META.get("HTTP_USER_AGENT") or "")[:400]


def log_action(request, *, actor, action, target="", detail="", success=True):
    """Create an audit entry carrying IP and browser information when a request
    context exists. Older write sites keep their original (telemetry-free)
    entries; nothing is invented for them."""
    return AuditLog.objects.create(
        actor=actor,
        action=action[:64],
        target=(target or "")[:255],
        detail=detail or "",
        ip_address=_client_ip(request) if request is not None else None,
        user_agent=_user_agent(request) if request is not None else "",
        success=success,
    )


AUDIT_CATEGORY_RULES = (
    ("Security", ("login", "logout", "lockout", "password", "permission", "role", "override", "suspension", "suspend", "deactivat", "reactivat")),
    ("Financial", ("escrow", "payment", "payout", "refund", "wallet", "funding", "commission", "tax", "delivery_payment", "compensation", "payroll", "expense", "financial", "discount", "promotion", "reconciliation")),
    ("Verification", ("registration", "approval", "approve", "reject", "kyc", "document", "verification")),
    ("Marketplace", ("order", "product", "listing", "inventory", "shipment", "shipment_details", "quality", "dispute", "contact")),
)

_ACTION_CATEGORY_CACHE = {}


def category_for(action):
    """Bucket an audit action into a display module; unknown actions are System."""
    cached = _ACTION_CATEGORY_CACHE.get(action)
    if cached is not None:
        return cached
    lowered = action.lower()
    result = "System"
    for category, needles in AUDIT_CATEGORY_RULES:
        if any(needle in lowered for needle in needles):
            result = category
            break
    _ACTION_CATEGORY_CACHE[action] = result
    return result
