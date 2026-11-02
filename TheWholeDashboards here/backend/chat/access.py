from django.db.models import Q

from users.models import AccountStatus, Role, User


ALLOWED_COUNTERPARTIES = {
    Role.FARMER: {
        Role.WHOLESALER,
        Role.USER_ADMIN,
        Role.FINANCIAL_MANAGER,
        Role.SUPER_ADMIN,
    },
    Role.WHOLESALER: {
        Role.FARMER,
        Role.RETAILER,
        Role.USER_ADMIN,
        Role.FINANCIAL_MANAGER,
        Role.SUPER_ADMIN,
    },
    Role.RETAILER: {
        Role.WHOLESALER,
        Role.USER_ADMIN,
        Role.SUPER_ADMIN,
    },
    Role.USER_ADMIN: {
        Role.FARMER,
        Role.WHOLESALER,
        Role.RETAILER,
        Role.USER_ADMIN,
        Role.FINANCIAL_MANAGER,
        Role.SUPER_ADMIN,
    },
    Role.FINANCIAL_MANAGER: {
        Role.FARMER,
        Role.WHOLESALER,
        Role.USER_ADMIN,
        Role.SUPER_ADMIN,
    },
    Role.SUPER_ADMIN: set(Role.values),
}


def _user_admin_scopes_related(actor, other):
    from registrations.models import AdministratorScope
    from registrations.services import location_descendant_ids

    actor_scope = AdministratorScope.objects.select_related("location").filter(
        user_id=actor.pk
    ).first()
    other_scope = AdministratorScope.objects.select_related("location").filter(
        user_id=other.pk
    ).first()
    if actor_scope is None or other_scope is None:
        return False
    if (
        actor_scope.level == AdministratorScope.Level.GLOBAL
        or other_scope.level == AdministratorScope.Level.GLOBAL
    ):
        return True
    if (
        actor_scope.location is None
        or other_scope.location is None
        or not actor_scope.location.active
        or not other_scope.location.active
    ):
        return False

    actor_subtree = set(location_descendant_ids(actor_scope.location))
    if other_scope.location_id in actor_subtree:
        return True
    other_subtree = set(location_descendant_ids(other_scope.location))
    return actor_scope.location_id in other_subtree


MARKETPLACE_ROLES = (
    Role.FARMER,
    Role.WHOLESALER,
    Role.RETAILER,
)


def _marketplace_user_in_admin_scope(admin, member):
    """Fail closed when an administrator has no usable geographic scope."""
    from registrations.services import users_visible_to_admin

    return users_visible_to_admin(admin, User.objects.filter(pk=member.pk)).exists()


def can_communicate(actor, other):
    """Return whether the actor may open or access a conversation with a user."""
    if not actor or not other or actor.pk == other.pk:
        return False
    if other.role not in ALLOWED_COUNTERPARTIES.get(actor.role, set()):
        return False
    if actor.role == Role.USER_ADMIN and other.role == Role.USER_ADMIN:
        return _user_admin_scopes_related(actor, other)
    # An administrator may only reach marketplace users whose registration sits
    # inside their own geographic scope (and the reverse direction too). This
    # keeps messaging aligned with the user-management boundary instead of
    # granting every staff account a system-wide directory.
    if actor.role == Role.USER_ADMIN and other.role in MARKETPLACE_ROLES:
        return _marketplace_user_in_admin_scope(actor, other)
    if other.role == Role.USER_ADMIN and actor.role in MARKETPLACE_ROLES:
        return _marketplace_user_in_admin_scope(other, actor)
    return True


def eligible_recipients(actor, search=""):
    """Every user the authenticated account may start a conversation with.

    Staff get their permitted colleagues plus (for administrators) the
    marketplace users inside their geographic scope. Commercial accounts get
    the counterparties of their existing orders; drivers have no authorised
    counterparty model yet and therefore receive an empty, honest list.
    """
    from payments.models import Order

    search = (search or "").strip()
    candidates = User.objects.filter(
        status=AccountStatus.APPROVED, is_active=True
    ).exclude(pk=actor.pk)

    if actor.role == Role.SUPER_ADMIN:
        pass
    elif actor.role == Role.USER_ADMIN:
        from registrations.services import users_visible_to_admin

        permitted_ids = {user.pk for user in eligible_staff_recipients(actor)}
        permitted_ids.update(
            users_visible_to_admin(
                actor,
                candidates.filter(
                    role__in=(Role.FARMER, Role.WHOLESALER, Role.RETAILER)
                ),
            ).values_list("pk", flat=True)
        )
        candidates = candidates.filter(pk__in=permitted_ids)
    elif actor.role == Role.FINANCIAL_MANAGER:
        candidates = candidates.filter(
            role__in=(Role.USER_ADMIN, Role.FINANCIAL_MANAGER, Role.SUPER_ADMIN)
        )
    elif actor.role in MARKETPLACE_ROLES:
        order_ids = Order.objects.filter(
            Q(wholesaler=actor) | Q(farmer=actor) | Q(retailer=actor)
        ).values_list("wholesaler_id", "farmer_id", "retailer_id")
        permitted_ids = {value for row in order_ids for value in row if value}
        candidates = candidates.filter(pk__in=permitted_ids)
    else:
        candidates = candidates.none()

    if search:
        candidates = candidates.filter(
            Q(full_name__icontains=search)
            | Q(role__icontains=search)
            | Q(location__icontains=search)
        )

    candidates = candidates.select_related(
        "administrative_scope__location", "registration__location"
    ).order_by("full_name", "pk")
    # A one-to-one thread only works when both sides can read and reply, so a
    # recipient the actor cannot hear back from (for example a driver until
    # driver messaging is authorised) is not offered.
    return [
        candidate
        for candidate in candidates
        if can_communicate(actor, candidate) and can_communicate(candidate, actor)
    ]


def related_user_admin_ids(actor):
    """Return administrator IDs that may share a conversation with this admin."""
    from registrations.models import AdministratorScope
    from registrations.services import (
        administrator_scope_for,
        location_descendant_ids,
    )

    permitted_ids = {actor.pk}
    scope = administrator_scope_for(actor)
    if scope is None:
        return permitted_ids
    if scope.level == AdministratorScope.Level.GLOBAL:
        permitted_ids.update(
            User.objects.filter(
                role=Role.USER_ADMIN,
                administrative_scope__isnull=False,
            ).values_list("pk", flat=True)
        )
        return permitted_ids
    if scope.location is None or not scope.location.active:
        return permitted_ids

    related_location_ids = set(location_descendant_ids(scope.location))
    ancestor = scope.location.parent
    while ancestor is not None:
        if ancestor.active:
            related_location_ids.add(ancestor.pk)
        ancestor = ancestor.parent
    permitted_ids.update(
        User.objects.filter(role=Role.USER_ADMIN)
        .filter(
            Q(administrative_scope__level=AdministratorScope.Level.GLOBAL)
            | Q(administrative_scope__location_id__in=related_location_ids)
        )
        .values_list("pk", flat=True)
    )
    return permitted_ids


def eligible_staff_recipients(actor, search=""):
    """Return active staff accounts the actor is allowed to contact."""
    candidates = User.objects.filter(
        role__in=(Role.USER_ADMIN, Role.FINANCIAL_MANAGER, Role.SUPER_ADMIN),
        status=AccountStatus.APPROVED,
        is_active=True,
    ).exclude(pk=actor.pk)
    search = (search or "").strip()
    if search:
        candidates = candidates.filter(
            Q(full_name__icontains=search)
            | Q(role__icontains=search)
            | Q(location__icontains=search)
        )
    candidates = candidates.select_related(
        "administrative_scope__location", "registration__location"
    ).order_by("full_name", "pk")
    # A one-to-one thread only works when both sides can read and reply, so a
    # recipient the actor cannot hear back from (for example a driver until
    # driver messaging is authorised) is not offered.
    return [
        candidate
        for candidate in candidates
        if can_communicate(actor, candidate) and can_communicate(candidate, actor)
    ]


def can_access_channel(actor, channel):
    if not channel.participants.filter(pk=actor.pk).exists():
        return False
    return all(
        can_communicate(actor, participant)
        for participant in channel.participants.exclude(pk=actor.pk)
    )


def can_moderate_voice(actor, channel):
    """Limit pending audio review to finance staff and scoped administrators."""
    if actor.role in (Role.FINANCIAL_MANAGER, Role.SUPER_ADMIN):
        return True
    if actor.role != Role.USER_ADMIN:
        return False

    from registrations.services import users_visible_to_admin

    participant_ids = list(channel.participants.values_list("pk", flat=True))
    if not participant_ids:
        return False
    return users_visible_to_admin(actor).filter(pk__in=participant_ids).count() == len(
        participant_ids
    )
