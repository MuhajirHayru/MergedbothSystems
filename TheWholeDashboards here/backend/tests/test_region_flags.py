"""Region flag (regional insignia) features.

Covers: flag set at admin creation (SA / Top User Admin authority), the
location-flag PATCH endpoint, zone/wereda flag inheritance from their region,
and the flag surfaced through creation-options and the accounts list.
"""
import pytest

from registrations.models import AdministrativeLocation, AdministratorScope
from registrations.services import region_flag_for
from users.models import Role, User
from users.serializers import AdminAccountSerializer


def make_location(name, level, parent=None, flag=""):
    return AdministrativeLocation.objects.create(
        source_id=f"test-{name}",
        name=name,
        level=level,
        parent=parent,
        flag=flag,
    )


def make_staff(role, email):
    from users.models import AccountStatus

    return User.objects.create_user(
        email=email,
        password="demo1234",
        full_name=email.split("@")[0],
        role=role,
        status=AccountStatus.APPROVED,
        privacy_policy_accepted=True,
    )


@pytest.fixture
def geography(db):
    region = make_location("Test Region", "REGION", flag="🏔️")
    zone = make_location("Test Zone", "ZONE", parent=region)
    wereda = make_location("Test Wereda", "WOREDA", parent=zone)
    return {"region": region, "zone": zone, "wereda": wereda}


def test_region_flag_inheritance(geography):
    assert region_flag_for(geography["region"]) == "🏔️"
    # zone and wereda inherit the region's flag without carrying one themselves
    assert region_flag_for(geography["zone"]) == "🏔️"
    assert region_flag_for(geography["wereda"]) == "🏔️"
    # an explicit closer flag wins over the ancestor's
    geography["zone"].flag = "🦁"
    geography["zone"].save(update_fields=["flag"])
    assert region_flag_for(geography["zone"]) == "🦁"
    assert region_flag_for(geography["wereda"]) == "🦁"
    # no flag anywhere -> empty
    geography["region"].flag = ""
    geography["region"].save(update_fields=["flag"])
    geography["zone"].flag = ""
    geography["zone"].save(update_fields=["flag"])
    assert region_flag_for(geography["wereda"]) == ""


def test_sa_sets_flag_at_admin_creation(api, super_admin, geography):
    api.force_authenticate(user=super_admin)
    response = api.post(
        "/api/v1/superadmin/accounts/",
        {
            "full_name": "Flagged Regional Admin",
            "email": "flagged.regional@test.et",
            "password": "demo1234",
            "role": Role.REGIONAL_ADMIN,
            "scope_level": "LOCATION",
            "scope_type": "REGIONAL",
            "scope_location": str(geography["region"].pk),
            "scope_location_flag": "🌾",
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    geography["region"].refresh_from_db()
    assert geography["region"].flag == "🌾"
    assert response.data["location_flag"] == "🌾"
    assert response.data["location_name"] == "Test Region"


def test_flag_write_rejected_without_authority(api, super_admin, geography):
    from users.models import AccountStatus

    fm = User.objects.create_user(
        email="flag.fm@test.et", password="demo1234", full_name="FM",
        role=Role.FINANCIAL_MANAGER, status=AccountStatus.APPROVED,
        privacy_policy_accepted=True,
    )
    api.force_authenticate(user=fm)
    response = api.post(
        "/api/v1/superadmin/accounts/",
        {
            "full_name": "Nope", "email": "nope@test.et", "password": "demo1234",
            "role": Role.REGIONAL_ADMIN, "scope_level": "LOCATION",
            "scope_location": str(geography["region"].pk),
            "scope_location_flag": "🌾",
        },
        format="json",
    )
    # FM cannot create admins at all; the viewset permission or the serializer
    # authority check must reject the request rather than write the flag.
    assert response.status_code in (403, 400)
    geography["region"].refresh_from_db()
    assert geography["region"].flag != "🌾"


def test_location_flag_endpoint(api, super_admin, geography, db):
    url = f"/api/v1/superadmin/locations/{geography['region'].pk}/flag/"
    api.force_authenticate(user=super_admin)
    response = api.patch(url, {"flag_image": _tiny_png()}, format="multipart")
    assert response.status_code == 200, response.data
    assert response.data["flag_image"]
    geography["region"].refresh_from_db()
    assert geography["region"].flag_image

    # financial managers cannot touch flags
    from users.models import AccountStatus

    fm = User.objects.create_user(
        email="flag.fm2@test.et", password="demo1234", full_name="FM2",
        role=Role.FINANCIAL_MANAGER, status=AccountStatus.APPROVED,
        privacy_policy_accepted=True,
    )
    api.force_authenticate(user=fm)
    response = api.patch(url, {"flag_image": _tiny_png()}, format="multipart")
    assert response.status_code == 403


def _tiny_png():
    """A real 2x2 red PNG so uploads exercise the actual image pipeline."""
    import io as _io

    from PIL import Image

    buffer = _io.BytesIO()
    Image.new("RGB", (2, 2), (200, 30, 30)).save(buffer, format="PNG")
    buffer.seek(0)
    buffer.name = "flag.png"
    return buffer


def test_location_flag_image_upload(api, super_admin, geography, db):
    url = f"/api/v1/superadmin/locations/{geography['region'].pk}/flag/"
    api.force_authenticate(user=super_admin)
    response = api.patch(url, {"flag_image": _tiny_png()}, format="multipart")
    assert response.status_code == 200, response.data
    assert response.data["flag_image"].startswith("http") or response.data["flag_image"].startswith("/")
    geography["region"].refresh_from_db()
    assert geography["region"].flag_image

    # the Top User Admin may also manage flag pictures
    from users.models import AccountStatus

    tua = User.objects.create_user(
        email="flag.tua2@test.et", password="demo1234", full_name="TUA2",
        role=Role.TOP_USER_ADMIN, status=AccountStatus.APPROVED,
        privacy_policy_accepted=True,
    )
    api.force_authenticate(user=tua)
    response = api.patch(url, {"flag_image": _tiny_png()}, format="multipart")
    assert response.status_code == 200, response.data

    # garbage uploads are rejected
    from django.core.files.uploadedfile import SimpleUploadedFile

    api.force_authenticate(user=super_admin)
    bad = SimpleUploadedFile("flag.png", b"not-an-image", content_type="image/png")
    response = api.patch(url, {"flag_image": bad}, format="multipart")
    assert response.status_code == 400


def test_zone_flag_upload_rejected_inherits_region(api, super_admin, geography, db):
    """Flags live on regions: a zone upload is rejected, and the zone still
    inherits the region's picture for its dashboard."""
    api.force_authenticate(user=super_admin)
    region_response = api.patch(
        f"/api/v1/superadmin/locations/{geography['region'].pk}/flag/",
        {"flag_image": _tiny_png()},
        format="multipart",
    )
    assert region_response.status_code == 200, region_response.data

    zone_url = f"/api/v1/superadmin/locations/{geography['zone'].pk}/flag/"
    response = api.patch(zone_url, {"flag_image": _tiny_png()}, format="multipart")
    assert response.status_code == 400
    assert "inherit" in response.data["error"]

    # the zone's dashboard still carries the region's picture
    zonal = make_staff(Role.ZONAL_ADMIN, "flag.zonal3@test.et")
    from registrations.models import AdministratorScope

    AdministratorScope.objects.update_or_create(
        user=zonal,
        defaults={"level": AdministratorScope.Level.LOCATION, "location": geography["zone"]},
    )
    api.force_authenticate(user=zonal)
    options = api.get("/api/v1/superadmin/accounts/creation-options/")
    assert options.data["current_flag_image"] == region_response.data["flag_image"]


def test_national_flag_upload(api, super_admin, geography, db):
    from registrations.models import AdministratorScope
    from registrations.services import national_flag_image_url

    api.force_authenticate(user=super_admin)
    response = api.patch(
        "/api/v1/superadmin/national-flag/",
        {"national_flag": _tiny_png()},
        format="multipart",
    )
    assert response.status_code == 200, response.data
    assert response.data["national_flag"]
    assert national_flag_image_url() != ""

    # a nationwide admin's dashboard inherits the national flag picture
    tua = make_staff(Role.TOP_USER_ADMIN, "flag.nation2@test.et")
    api.force_authenticate(user=tua)
    options = api.get("/api/v1/superadmin/accounts/creation-options/")
    assert options.status_code == 200
    assert options.data["current_flag_image"].endswith(national_flag_image_url())
    assert options.data["can_set_location_flag"] is True

    # a zonal admin under a flagged region gets the region picture, not the national one
    zonal = make_staff(Role.ZONAL_ADMIN, "flag.zonal2@test.et")
    AdministratorScope.objects.update_or_create(
        user=zonal,
        defaults={"level": AdministratorScope.Level.LOCATION, "location": geography["zone"]},
    )
    # give the region its own picture so the zone has something to inherit
    api.force_authenticate(user=super_admin)
    region_response = api.patch(
        f"/api/v1/superadmin/locations/{geography['region'].pk}/flag/",
        {"flag_image": _tiny_png()},
        format="multipart",
    )
    assert region_response.status_code == 200, region_response.data
    region_image = region_response.data["flag_image"]
    api.force_authenticate(user=zonal)
    options = api.get("/api/v1/superadmin/accounts/creation-options/")
    assert options.data["current_flag_image"] == region_image
    assert options.data["current_flag_image"] != national_flag_image_url()


def test_national_and_federal_flag_defaults(api, geography, db):
    """Nationwide roles show the national flag; Addis Ababa admins the federal flag."""
    from registrations.services import dashboard_flag_for
    from registrations.models import AdministratorScope

    federal_city = make_location("Addis Ababa", "CITY")
    scopeless_tua = make_staff(Role.TOP_USER_ADMIN, "flag.nation@test.et")
    assert dashboard_flag_for(None, Role.TOP_USER_ADMIN) == "🇪🇹"

    aa_admin = make_staff(Role.USER_ADMIN, "flag.aa@test.et")
    AdministratorScope.objects.update_or_create(
        user=aa_admin,
        defaults={"level": AdministratorScope.Level.LOCATION, "location": federal_city},
    )
    assert dashboard_flag_for(
        AdministratorScope.objects.filter(user=aa_admin).first(), Role.USER_ADMIN
    ) == "🇪🇹"

    # creation without an explicit flag auto-assigns the federal flag
    api.force_authenticate(user=make_staff(Role.SUPER_ADMIN, "flag.sa2@test.et"))
    response = api.post(
        "/api/v1/superadmin/accounts/",
        {
            "full_name": "AA Capital Admin", "email": "aa.capital@test.et",
            "password": "demo1234", "role": Role.USER_ADMIN,
            "scope_level": "LOCATION", "scope_location": str(federal_city.pk),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    federal_city.refresh_from_db()
    assert federal_city.flag == "🇪🇹"
    assert response.data["location_flag"] == "🇪🇹"


def test_zonal_creation_options_inherit_region_flag(api, super_admin, geography, db):
    zonal = make_staff(Role.ZONAL_ADMIN, "flag.zonal@test.et")
    AdministratorScope.objects.create(
        user=zonal, level=AdministratorScope.Level.LOCATION, location=geography["zone"],
    )
    geography["region"].flag = "🏔️"
    geography["region"].save(update_fields=["flag"])

    api.force_authenticate(user=zonal)
    response = api.get("/api/v1/superadmin/accounts/creation-options/")
    assert response.status_code == 200
    assert response.data["current_scope"] == "Test Zone (Zone)"
    assert response.data["current_flag"] == "🏔️"

    # and the accounts list reports the inherited flag for the admin row
    api.force_authenticate(user=super_admin)
    listing = api.get("/api/v1/superadmin/accounts/", {"role": Role.ZONAL_ADMIN})
    assert listing.status_code == 200
    row = next(
        (item for item in listing.data["results"] if item["id"] == str(zonal.pk)),
        None,
    )
    assert row is not None
    assert row["location_flag"] == "🏔️"


def test_serializer_flag_requires_location(db, super_admin, geography):
    from rest_framework.test import APIRequestFactory

    factory = APIRequestFactory()
    request = factory.post("/api/v1/superadmin/accounts/", {}, format="json")
    request.user = super_admin
    serializer = AdminAccountSerializer(
        data={
            "full_name": "No Location", "email": "nolocation@test.et",
            "password": "demo1234", "role": Role.REGIONAL_ADMIN,
            "scope_level": "LOCATION", "scope_type": "REGIONAL",
            "scope_location_flag": "🌾",
        },
        context={"request": request},
    )
    # A flag without a location cannot pass validation: the scope_location
    # requirement fires first, so no flag is ever stored without a home.
    assert not serializer.is_valid()
    assert "scope_location" in serializer.errors
