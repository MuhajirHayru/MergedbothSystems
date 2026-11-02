import json

import pytest
from asgiref.sync import sync_to_async
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import RefreshToken

from chat.models import ChatChannel
from greenpath.asgi import application
from registrations.models import (
    AdministratorScope,
    AdministrativeLocation,
    LocationLevel,
    UserRegistration,
)
from users.models import AccountStatus, Role, User

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def scoped_admins():
    region = AdministrativeLocation.objects.create(
        source_id="chat-region-a",
        name="Chat Region A",
        level=LocationLevel.REGION,
    )
    zone = AdministrativeLocation.objects.create(
        source_id="chat-zone-a",
        name="Chat Zone A",
        level=LocationLevel.ZONE,
        parent=region,
    )
    other_region = AdministrativeLocation.objects.create(
        source_id="chat-region-b",
        name="Chat Region B",
        level=LocationLevel.REGION,
    )

    def create_admin(email, name, location):
        user = User.objects.create_user(
            email=email,
            password="test-password",
            full_name=name,
            role=Role.USER_ADMIN,
        )
        scope, _ = AdministratorScope.objects.get_or_create(
            user=user,
            defaults={
                "level": AdministratorScope.Level.LOCATION,
                "location": location,
            },
        )
        if scope.location_id != location.pk or scope.level != AdministratorScope.Level.LOCATION:
            scope.level = AdministratorScope.Level.LOCATION
            scope.location = location
            scope.save(update_fields=["level", "location"])
        return user

    return (
        create_admin("region-admin@test.et", "Region Admin", region),
        create_admin("zone-admin@test.et", "Zone Admin", zone),
        create_admin("other-region-admin@test.et", "Other Region Admin", other_region),
    )


def test_admin_can_start_conversation_with_descendant_admin(api, scoped_admins):
    regional_admin, zonal_admin, _ = scoped_admins
    api.force_authenticate(user=regional_admin)

    response = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(zonal_admin.pk)]},
        format="json",
    )

    assert response.status_code == 201, response.data
    channel = ChatChannel.objects.get()
    assert set(channel.participants.values_list("pk", flat=True)) == {
        regional_admin.pk,
        zonal_admin.pk,
    }


def test_admin_cannot_start_or_discover_conversation_outside_scope(
    api, scoped_admins
):
    regional_admin, _, unrelated_admin = scoped_admins
    api.force_authenticate(user=regional_admin)

    attempted = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(unrelated_admin.pk)]},
        format="json",
    )
    assert attempted.status_code == 403

    channel = ChatChannel.objects.create()
    channel.participants.add(regional_admin, unrelated_admin)
    assert api.get("/api/v1/chat/channels/").data["count"] == 0
    assert api.get(f"/api/v1/chat/channels/{channel.pk}/").status_code == 404
    assert (
        api.get(f"/api/v1/chat/channels/{channel.pk}/messages/").status_code
        == 404
    )
    assert (
        api.post(f"/api/v1/chat/channels/{channel.pk}/mark-read/").status_code
        == 404
    )


async def test_admin_websocket_rejects_conversation_outside_scope(scoped_admins):
    regional_admin, _, unrelated_admin = scoped_admins
    channel = await sync_to_async(ChatChannel.objects.create)()
    await sync_to_async(channel.participants.add)(regional_admin, unrelated_admin)
    token = str(RefreshToken.for_user(regional_admin).access_token)

    communicator = WebsocketCommunicator(
        application, f"/ws/chat/{channel.pk}/?token={token}"
    )
    connected, code = await communicator.connect()

    assert connected is False
    assert code == 4403


def _create_marketplace_user(email, name, role, location):
    user = User.objects.create_user(
        email=email,
        password="test-password",
        full_name=name,
        role=role,
        status=AccountStatus.APPROVED,
        location=location.name,
    )
    UserRegistration.objects.create(user=user, location=location)
    return user


def test_admin_messaging_honours_the_geographic_scope(api, scoped_admins):
    regional_admin, zone_admin, _ = scoped_admins
    region = AdministrativeLocation.objects.get(source_id="chat-region-a")
    zone = AdministrativeLocation.objects.get(source_id="chat-zone-a")
    other_region = AdministrativeLocation.objects.get(source_id="chat-region-b")
    inside = _create_marketplace_user(
        "inside-farmer@test.et", "Inside Farmer", Role.FARMER, zone
    )
    other_zone = AdministrativeLocation.objects.create(
        source_id="chat-zone-b",
        name="Chat Zone B",
        level=LocationLevel.ZONE,
        parent=other_region,
    )
    outside = _create_marketplace_user(
        "outside-farmer@test.et", "Outside Farmer", Role.FARMER, other_zone
    )

    api.force_authenticate(user=regional_admin)
    allowed = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(inside.pk)]},
        format="json",
    )
    denied = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(outside.pk)]},
        format="json",
    )
    assert allowed.status_code == 201, allowed.data
    assert denied.status_code == 403, denied.data

    listed = api.get("/api/v1/chat/recipients/?search=FARMER")
    assert listed.status_code == 200
    ids = {row["id"] for row in listed.data["results"]}
    assert str(inside.pk) in ids
    assert str(outside.pk) not in ids

    # The same geographic rule applies to a lower-level administrator; the
    # farmer in the region but outside the zone is not reachable.
    api.force_authenticate(user=zone_admin)
    region_farmer = _create_marketplace_user(
        "region-farmer@test.et", "Region Farmer", Role.FARMER, region
    )
    assert api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(inside.pk)]},
        format="json",
    ).status_code == 201
    assert api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(region_farmer.pk)]},
        format="json",
    ).status_code == 403


def test_top_level_admin_can_message_scoped_admin(api, scoped_admins, super_admin):
    regional_admin, _, _ = scoped_admins
    AdministratorScope.objects.create(
        user=super_admin,
        level=AdministratorScope.Level.GLOBAL,
    )
    api.force_authenticate(user=super_admin)

    response = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(regional_admin.pk)]},
        format="json",
    )

    assert response.status_code == 201, response.data


def test_staff_recipient_list_uses_active_accounts_and_administrative_scope(
    api, scoped_admins, super_admin, financial_manager
):
    regional_admin, zonal_admin, unrelated_admin = scoped_admins
    AdministratorScope.objects.create(
        user=super_admin,
        level=AdministratorScope.Level.GLOBAL,
    )
    api.force_authenticate(user=regional_admin)

    response = api.get("/api/v1/chat/staff-recipients/")

    assert response.status_code == 200, response.data
    recipient_ids = {row["id"] for row in response.data["results"]}
    assert str(zonal_admin.pk) in recipient_ids
    assert str(super_admin.pk) in recipient_ids
    assert str(financial_manager.pk) in recipient_ids
    assert str(unrelated_admin.pk) not in recipient_ids

    unrelated_admin.suspend(actor=super_admin, reason="Inactive test recipient")
    response = api.get("/api/v1/chat/staff-recipients/")
    assert str(unrelated_admin.pk) not in {row["id"] for row in response.data["results"]}


def test_non_staff_cannot_load_staff_recipients(api, farmer):
    api.force_authenticate(user=farmer)

    response = api.get("/api/v1/chat/staff-recipients/")

    assert response.status_code == 403


def test_staff_conversation_requires_single_active_authorized_recipient(
    api, scoped_admins, super_admin
):
    regional_admin, _, unrelated_admin = scoped_admins
    AdministratorScope.objects.create(
        user=super_admin,
        level=AdministratorScope.Level.GLOBAL,
    )
    api.force_authenticate(user=regional_admin)

    group_attempt = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(super_admin.pk), str(unrelated_admin.pk)]},
        format="json",
    )
    unrelated_attempt = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(unrelated_admin.pk)]},
        format="json",
    )

    assert group_attempt.status_code == 400
    assert unrelated_attempt.status_code == 403


def test_new_staff_chat_reuses_only_existing_one_to_one_staff_channel(
    api, scoped_admins
):
    regional_admin, zonal_admin, _ = scoped_admins
    existing = ChatChannel.objects.create()
    existing.participants.add(regional_admin, zonal_admin)
    api.force_authenticate(user=regional_admin)

    response = api.post(
        "/api/v1/chat/channels/",
        {"participant_ids": [str(zonal_admin.pk)]},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["channel"]["id"] == str(existing.pk)
    assert ChatChannel.objects.count() == 1
