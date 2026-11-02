"""Exercise the staff-management endpoints the new frontend uses.

Runs against the development database through DRF's test client with
``force_authenticate`` (the JWT path is covered by the live REST/WebSocket
checks). Every account this script creates is deleted again.

    cd "TheWholeDashboards here/backend"
    python ../../greenpath-farm-to-market-ai/scripts/verify-staff-api.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from rest_framework.test import APIClient  # noqa: E402

# DRF's test client uses the literal host "testserver".
if "testserver" not in settings.ALLOWED_HOSTS:
    settings.ALLOWED_HOSTS = [*settings.ALLOWED_HOSTS, "testserver"]

from registrations.models import AdministrativeLocation  # noqa: E402
from users.models import User  # noqa: E402

BASE = "/api/v1/superadmin/accounts/"
results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))


def client_for(email):
    user = User.objects.get(email=email)
    client = APIClient()
    client.force_authenticate(user=user)
    return client, user


def scope_payload(location, role="USER_ADMIN"):
    return {
        "full_name": f"Verify Staff {uuid.uuid4().hex[:6]}",
        "email": f"verify.{uuid.uuid4().hex[:10]}@greenpath.test",
        "phone": "+251900000000",
        "password": "VerifyPass123!",
        "role": role,
        "location": location.name if location else "",
        **(
            {"scope_level": "LOCATION", "scope_location": str(location.id)}
            if role == "USER_ADMIN" and location is not None
            else {"scope_level": "GLOBAL"}
            if role == "USER_ADMIN"
            else {}
        ),
    }


def main():
    global_admin, _ = client_for("admin@greenpath.et")
    scoped_admin, scoped_user = client_for("kemal@gmail.com")  # South Wello (Zone)
    super_admin, _ = client_for("super_admin01@greenpath.et")

    woreda = (
        AdministrativeLocation.objects.filter(active=True, level="WOREDA").first()
    )
    record("reference data exposes a woreda to assign", woreda is not None, str(woreda))

    # --- creation options ---------------------------------------------------
    options = global_admin.get(BASE + "creation-options/")
    body = options.json()
    record(
        "User Admin receives backend creation options",
        options.status_code == 200 and isinstance(body.get("scope_types"), list),
        f"scope_types={body.get('scope_types')} scope={body.get('current_scope')}",
    )
    record(
        "User Admin may not create top-level or finance accounts",
        body.get("can_create_top_level") is False
        and body.get("can_create_financial_manager") is False,
    )

    super_options = super_admin.get(BASE + "creation-options/").json()
    record(
        "Super Admin may create top-level and finance accounts",
        super_options.get("can_create_top_level") is True
        and super_options.get("can_create_financial_manager") is True,
    )

    # --- list + filters -----------------------------------------------------
    listing = global_admin.get(BASE, {"status": "ALL"})
    record(
        "staff list is paginated and backend-counted",
        listing.status_code == 200 and "count" in listing.json(),
        f"count={listing.json().get('count')}",
    )
    filtered = global_admin.get(BASE, {"status": "ALL", "role": "FINANCIAL_MANAGER"})
    record(
        "role filter returns only financial managers",
        filtered.status_code == 200
        and all(row["role"] == "FINANCIAL_MANAGER" for row in filtered.json().get("results", [])),
    )

    # --- create a scoped administrator -------------------------------------
    created_id = None
    payload = scope_payload(woreda)
    created = global_admin.post(BASE, payload, format="json")
    if created.status_code == 201:
        created_id = created.json().get("id")
    record(
        "User Admin creates a woreda-scoped staff account",
        created.status_code == 201,
        f"status {created.status_code} {created.json() if created.status_code != 201 else ''}",
    )

    if created_id:
        row = created.json()
        record(
            "created account reports its administrative scope",
            row.get("scope_label") and row.get("location_name") == (woreda.name if woreda else ""),
            f"{row.get('scope_label')} / {row.get('location_name')}",
        )
        found = global_admin.get(BASE, {"status": "ALL", "search": payload["email"]})
        record(
            "new account appears in the backend staff list",
            found.status_code == 200
            and any(item["id"] == created_id for item in found.json().get("results", [])),
        )

        suspended = global_admin.patch(f"{BASE}{created_id}/", {"status": "SUSPENDED"}, format="json")
        record("suspend action is accepted", suspended.status_code == 200 and suspended.json().get("status") == "SUSPENDED")
        activated = global_admin.patch(f"{BASE}{created_id}/", {"status": "APPROVED"}, format="json")
        record("activate action is accepted", activated.status_code == 200 and activated.json().get("status") == "APPROVED")

        renamed = global_admin.patch(f"{BASE}{created_id}/", {"full_name": "Verify Renamed"}, format="json")
        record("permitted profile update is persisted", renamed.status_code == 200 and renamed.json().get("full_name") == "Verify Renamed")

        removed = global_admin.delete(f"{BASE}{created_id}/")
        record("test account cleanup succeeds", removed.status_code in (200, 204), f"status {removed.status_code}")

    # --- forbidden creations ------------------------------------------------
    global_payload = scope_payload(None)
    global_attempt = global_admin.post(BASE, global_payload, format="json")
    record(
        "User Admin cannot create a top-level (nationwide) administrator",
        global_attempt.status_code == 400,
        f"status {global_attempt.status_code}",
    )

    finance_payload = scope_payload(None, role="FINANCIAL_MANAGER")
    finance_attempt = global_admin.post(BASE, finance_payload, format="json")
    record(
        "User Admin cannot create a Financial Manager",
        finance_attempt.status_code == 400,
        f"status {finance_attempt.status_code}",
    )

    # --- scoped administrator ----------------------------------------------
    scoped_options = scoped_admin.get(BASE + "creation-options/").json()
    record(
        "scoped administrator receives its own scope from the backend",
        bool(scoped_options.get("scope_location_id")),
        f"scope={scoped_options.get('current_scope')} types={scoped_options.get('scope_types')}",
    )
    record(
        "zonal administrator is limited to subordinate levels",
        "REGIONAL" not in (scoped_options.get("scope_types") or []),
        f"types={scoped_options.get('scope_types')}",
    )

    inside = AdministrativeLocation.objects.filter(
        active=True, level="WOREDA", parent__name__icontains="Wello"
    ).first()
    inside_payload = scope_payload(inside)
    inside_created = scoped_admin.post(BASE, inside_payload, format="json")
    inside_id = inside_created.json().get("id") if inside_created.status_code == 201 else None
    record(
        "scoped administrator creates a subordinate within its zone",
        inside_created.status_code == 201,
        f"status {inside_created.status_code} at {inside}",
    )
    if inside_id:
        scoped_admin.delete(f"{BASE}{inside_id}/")

    far_location = (
        AdministrativeLocation.objects.filter(active=True, level="WOREDA")
        .exclude(pk=getattr(inside, "pk", None))
        .exclude(parent__name__icontains="Wello")
        .first()
    )
    outside_payload = scope_payload(far_location)
    outside_attempt = scoped_admin.post(BASE, outside_payload, format="json")
    record(
        "scoped administrator is rejected outside its zone",
        outside_attempt.status_code == 400,
        f"status {outside_attempt.status_code} at {far_location}",
    )

    scoped_list = scoped_admin.get(BASE, {"status": "ALL"})
    scoped_rows = scoped_list.json().get("results", [])
    record(
        "scoped list never contains accounts outside its scope",
        scoped_list.status_code == 200
        and all(row.get("location_name") != "Nationwide" for row in scoped_rows),
        f"count={scoped_list.json().get('count')}",
    )

    # --- super admin can create a financial manager ------------------------
    fm_payload = scope_payload(None, role="FINANCIAL_MANAGER")
    fm_created = super_admin.post(BASE, fm_payload, format="json")
    record(
        "Super Admin creates a Financial Manager",
        fm_created.status_code == 201,
        f"status {fm_created.status_code}",
    )
    if fm_created.status_code == 201:
        super_admin.delete(f"{BASE}{fm_created.json()['id']}/")

    failed = [name for name, ok in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
