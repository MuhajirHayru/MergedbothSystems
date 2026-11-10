"""Part 19 — regional analytics over real registration and account records.

Every figure is derived from the database at request time: users come from
``users.User`` joined to their ``UserRegistration`` location, rolled up through
the ``AdministrativeLocation`` parent chain (kebele/wereda → zone → region).
Nothing here is sampled or hard-coded.
"""

from collections import defaultdict
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from registrations.models import AdministratorScope, AdministrativeLocation, UserRegistration
from registrations.services import SCOPED_ADMIN_ROLES, administrator_scope_for, location_descendant_ids
from users.models import AccountStatus, AuditLog, Role, User

MARKETPLACE_ROLES = (Role.FARMER, Role.WHOLESALER, Role.RETAILER, Role.DRIVER)
STAFF_ROLES = (
    Role.USER_ADMIN,
    Role.FINANCIAL_MANAGER,
    Role.SUPER_ADMIN,
    Role.TOP_USER_ADMIN,
    Role.REGIONAL_ADMIN,
    Role.ZONAL_ADMIN,
    Role.WEREDA_ADMIN,
    Role.CUSTOMER_SUPPORT,
)

_LEVEL_ORDER = {"REGION": 0, "SUBCITY": 1, "ZONE": 1, "WOREDA": 2, "KEBELE": 3, "OTHER": 4}


def _ancestor_chain(location):
    """Return [location, parent, grandparent, ...] up to the region."""
    chain = []
    seen = set()
    node = location
    while node is not None and node.pk not in seen:
        seen.add(node.pk)
        chain.append(node)
        node = node.parent
    return chain


def _role_bucket(role):
    if role in MARKETPLACE_ROLES:
        return role.lower()
    if role in STAFF_ROLES:
        return "staff"
    return "other"


def _empty_bucket():
    return {
        "total": 0,
        "farmer": 0,
        "wholesaler": 0,
        "retailer": 0,
        "driver": 0,
        "staff": 0,
        "other": 0,
        "active": 0,
        "inactive": 0,
        "suspended": 0,
        "pending": 0,
        "approved": 0,
        "rejected": 0,
    }


def _fill_status(bucket, user):
    if user.status == AccountStatus.APPROVED:
        bucket["active"] += 1
    elif user.status in (AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED):
        bucket["suspended"] += 1
    elif user.status == AccountStatus.PENDING:
        bucket["pending"] += 1
    elif user.status == AccountStatus.REJECTED:
        bucket["rejected"] += 1
    else:
        bucket["inactive"] += 1


def _registration_snapshots():
    """Yield (user, registration_or_None, region_loc, zone_loc, wereda_loc, kebele_loc)."""
    regs = UserRegistration.objects.select_related("user", "location")
    located = []
    unlocated = []
    for reg in regs:
        chain = _ancestor_chain(reg.location) if reg.location_id else []
        by_level = {}
        for node in chain:
            by_level.setdefault(_LEVEL_ORDER.get(node.level, 4), node)
        region = by_level.get(0)
        zone = by_level.get(1)
        wereda = by_level.get(2)
        kebele = by_level.get(3)
        item = (reg.user, reg, region, zone, wereda, kebele)
        (located if region else unlocated).append(item)
    # Staff and any user without a registration still count, classified as unlocated.
    # Registrations whose location has no region ancestor are already in the
    # ``unlocated`` bucket. Exclude both buckets here or those users are added
    # a second time by the fallback account pass below.
    covered_users = {item[0].pk for item in located + unlocated}
    for user in User.objects.exclude(pk__in=covered_users):
        unlocated.append((user, None, None, None, None, None))
    return located, unlocated


def regional_overview(actor=None):
    """Region-level comparison: users by role and status, plus registration trends."""
    located, unlocated = _registration_snapshots()

    if actor and actor.role in SCOPED_ADMIN_ROLES:
        scope = administrator_scope_for(actor)
        if scope is None and actor.role != Role.TOP_USER_ADMIN:
            located, unlocated = [], []
        elif scope and scope.level == AdministratorScope.Level.LOCATION:
            visible_location_ids = set(location_descendant_ids(scope.location))
            located = [item for item in located if item[1] and item[1].location_id in visible_location_ids]
            unlocated = [
                item for item in unlocated
                if AdministratorScope.objects.filter(
                    user=item[0], level=AdministratorScope.Level.LOCATION,
                    location_id__in=visible_location_ids,
                ).exists()
            ]

    by_region = defaultdict(_empty_bucket)
    unclassified = _empty_bucket()
    for user, _reg, region, _zone, _wereda, _kebele in located:
        bucket = by_region[region] if region else unclassified
        bucket["total"] += 1
        bucket[_role_bucket(user.role)] += 1
        _fill_status(bucket, user)
    for user, _reg, *_rest in unlocated:
        bucket = unclassified
        bucket["total"] += 1
        bucket[_role_bucket(user.role)] += 1
        _fill_status(bucket, user)

    regions = []
    for region, bucket in by_region.items():
        regions.append({
            "location_id": str(region.pk),
            "name": region.name,
            **bucket,
        })
    regions.sort(key=lambda r: r["total"], reverse=True)

    unclassified_out = {"name": "Unassigned / staff accounts", **unclassified}

    # Registration trend from actual account creation timestamps.
    now = timezone.now()
    monthly = defaultdict(int)
    weekly = defaultdict(int)
    daily = defaultdict(int)
    for user, *_rest in located + unlocated:
        created = user.created_at
        if created is None:
            continue
        monthly[created.strftime("%Y-%m")] += 1
        week_start = (created - timedelta(days=created.weekday())).date()
        weekly[week_start.isoformat()] += 1
        daily[created.date().isoformat()] += 1

    def _last_n(series, n):
        keys = sorted(series)[-n:]
        return [{"period": k, "count": series[k]} for k in keys]

    scoped_users = [item[0] for item in located + unlocated]
    role_counts = defaultdict(int)
    for user in scoped_users:
        role_counts[user.role] += 1

    return {
        "generated_at": now.isoformat(),
        "total_users": len(scoped_users),
        "regions": regions,
        "unclassified": unclassified_out,
        "role_breakdown": [
            {"role": role, "total": total}
            for role, total in sorted(role_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "trends": {
            "monthly": _last_n(monthly, 12),
            "weekly": _last_n(weekly, 12),
            "daily": _last_n(daily, 30),
        },
    }


def regional_drilldown(location_id):
    """Children + users for one node on the Ethiopia → region → … → kebele path."""
    node = AdministrativeLocation.objects.filter(pk=location_id, active=True).first()
    if node is None:
        return None

    located, unlocated = _registration_snapshots()
    chain_map = {}
    for user, reg, region, zone, wereda, kebele in located:
        for depth, loc in ((0, region), (1, zone), (2, wereda), (3, kebele)):
            if loc is not None:
                chain_map.setdefault(loc.pk, []).append((user, depth))

    users_here = chain_map.get(node.pk, [])
    bucket = _empty_bucket()
    user_rows = []
    for user, depth in users_here:
        bucket["total"] += 1
        bucket[_role_bucket(user.role)] += 1
        _fill_status(bucket, user)
        user_rows.append({
            "id": str(user.pk),
            "full_name": user.full_name,
            "role": user.role,
            "status": user.status,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        })

    children = []
    if _LEVEL_ORDER.get(node.level, 4) < 3:
        # Direct children of this node with the users whose chain passes through them.
        child_users = defaultdict(list)
        for user, _reg, region, zone, wereda, kebele in located:
            chain = [loc for loc in (kebele, wereda, zone, region) if loc is not None]
            # chain runs leaf -> region; find the element whose parent is `node`
            for idx, loc in enumerate(chain):
                parent = chain[idx + 1] if idx + 1 < len(chain) else None
                if parent is not None and parent.pk == node.pk:
                    child_users[loc.pk].append(user)
                    break
        for child in node.children.filter(active=True).order_by("name"):
            users = child_users.get(child.pk, [])
            cb = _empty_bucket()
            for user in users:
                cb["total"] += 1
                cb[_role_bucket(user.role)] += 1
                _fill_status(cb, user)
            children.append({
                "location_id": str(child.pk),
                "name": child.name,
                "level": child.level,
                **cb,
            })

    staff = []
    if bucket["staff"] or True:
        staff_rows = User.objects.filter(role__in=STAFF_ROLES).select_related(
            "administrative_scope__location"
        )
        for member in staff_rows[:100]:
            scope = getattr(member, "administrative_scope", None)
            scope_desc = "Global" if (scope and scope.level == "GLOBAL") else (
                str(scope.location) if scope and scope.location else "Unassigned"
            )
            staff.append({
                "id": str(member.pk),
                "full_name": member.full_name,
                "role": member.role,
                "status": member.status,
                "scope": scope_desc,
            })

    return {
        "location": {
            "id": str(node.pk),
            "name": node.name,
            "level": node.level,
            "parent_id": str(node.parent.pk) if node.parent_id else None,
        },
        "summary": bucket,
        "users": sorted(user_rows, key=lambda u: u["created_at"] or "", reverse=True)[:200],
        "children": children,
        "staff": staff,
    }


def admin_activity_report(days=90):
    """Part 19.3 — what administrative staff did, derived from the audit log."""
    since = timezone.now() - timedelta(days=days)
    qs = (
        AuditLog.objects.filter(created_at__gte=since)
        .exclude(actor=None)
        .select_related("actor")
        .order_by("-created_at")[:500]
    )
    staff_actions = []
    by_staff = defaultdict(lambda: {"actions": 0, "last_action": None})
    for entry in qs:
        actor = entry.actor
        if actor.role not in STAFF_ROLES:
            continue
        staff_actions.append({
            "id": entry.pk,
            "actor": actor.full_name,
            "actor_role": actor.role,
            "action": entry.action,
            "detail": entry.detail[:200],
            "target": entry.target,
            "created_at": entry.created_at.isoformat(),
        })
        by_staff[f"{actor.pk}"]["actions"] += 1
        by_staff[f"{actor.pk}"].update(
            name=actor.full_name, role=actor.role,
            last_action=entry.created_at.isoformat(),
        )
    summary = sorted(
        (
            {"staff_id": k, **v} for k, v in by_staff.items()
        ),
        key=lambda r: r["actions"],
        reverse=True,
    )
    return {
        "window_days": days,
        "total_staff_actions": len(staff_actions),
        "by_staff": summary[:50],
        "recent": staff_actions[:100],
    }
