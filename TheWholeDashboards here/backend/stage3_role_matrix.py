import json, os, urllib.request
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")
django.setup()
from users.models import User

BASE = "http://127.0.0.1:8000"
QA = "Stage3QA@2026!"
ROLES = {
    "SUPER_ADMIN": "super_admin01@greenpath.et",
    "TOP_USER_ADMIN": "stage3.topadmin@greenpath.et",
    "REGIONAL_ADMIN": "lema@gmail.com",
    "ZONAL_ADMIN": "kemal@gmail.com",
    "WEREDA_ADMIN": "dbg-wa@test.et",
    "USER_ADMIN": "qa.audit.staff@greenpath.et",
    "FINANCIAL_MANAGER": "financial_manager02@greenpath.et",
    "FARMER": "farmer15@greenpath.et",
    "WHOLESALER": "wholesaler10@greenpath.et",
    "RETAILER": "retailer12@greenpath.et",
    "DRIVER": "dbg-drv@test.et",
    "LOGISTICS_MANAGER": "logistics.manager@greenpath.et",
    "CUSTOMER_SUPPORT": "stage3.support@greenpath.et",
}

def login(email):
    for _ in range(2):
        req = urllib.request.Request(f"{BASE}/api/v1/auth/login/", method="POST",
            data=json.dumps({"email": email, "password": QA}).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())["access"]
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if "locked" in body.lower():
                u = User.objects.get(email=email)
                u.failed_login_attempts = 0
                u.locked_until = None
                u.set_password(QA)
                u.save()
                continue
            raise
    raise RuntimeError(f"login failed for {email}")

def call(url, token):
    req = urllib.request.Request(BASE + url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code

ALLOWED = {
    "SUPER_ADMIN": ["/api/v1/superadmin/statistics/", "/api/v1/admin/users/", "/api/v1/payments/financial/ledger/"],
    "TOP_USER_ADMIN": ["/api/v1/admin/users/"],
    "REGIONAL_ADMIN": ["/api/v1/admin/users/"],
    "ZONAL_ADMIN": ["/api/v1/admin/users/"],
    "WEREDA_ADMIN": ["/api/v1/admin/users/"],
    "USER_ADMIN": ["/api/v1/admin/users/"],
    "FINANCIAL_MANAGER": ["/api/v1/payments/financial/ledger/", "/api/v1/wallet/funding/"],
    "FARMER": ["/api/v1/products/catalog/categories/", "/api/v1/products/farmer-listings/"],
    "WHOLESALER": ["/api/v1/products/wholesaler-listings/", "/api/v1/wallet/"],
    "RETAILER": ["/api/v1/products/catalog/categories/"],
    "DRIVER": ["/api/v1/products/catalog/categories/"],
    "LOGISTICS_MANAGER": ["/api/v1/payments/financial/freight-board/"],
    "CUSTOMER_SUPPORT": ["/api/v1/support/inbox/"],
}
FORBIDDEN = {
    "TOP_USER_ADMIN": ["/api/v1/payments/financial/ledger/"],
    "REGIONAL_ADMIN": ["/api/v1/payments/financial/ledger/"],
    "ZONAL_ADMIN": ["/api/v1/payments/financial/ledger/"],
    "WEREDA_ADMIN": ["/api/v1/payments/financial/ledger/"],
    "USER_ADMIN": ["/api/v1/payments/financial/ledger/"],
    "FINANCIAL_MANAGER": ["/api/v1/superadmin/statistics/"],
    "FARMER": ["/api/v1/admin/users/", "/api/v1/payments/financial/ledger/"],
    "WHOLESALER": ["/api/v1/admin/users/"],
    "RETAILER": ["/api/v1/admin/users/"],
    "DRIVER": ["/api/v1/admin/users/", "/api/v1/payments/financial/ledger/"],
    "LOGISTICS_MANAGER": ["/api/v1/admin/users/"],
    "CUSTOMER_SUPPORT": ["/api/v1/admin/users/"],
}

passed, failed = 0, []
for role, email in ROLES.items():
    try:
        token = login(email)
    except Exception as e:
        failed.append(f"{role} LOGIN -> {e}")
        continue
    for url in ALLOWED.get(role, []):
        s = call(url, token)
        if s == 200:
            passed += 1
        else:
            failed.append(f"{role} ALLOWED {url} -> {s}")
    for url in FORBIDDEN.get(role, []):
        s = call(url, token)
        if s in (401, 403):
            passed += 1
        else:
            failed.append(f"{role} FORBIDDEN {url} -> {s}")

print(f"authorization matrix: {passed} passed, {len(failed)} failed")
for f in failed:
    print("  FAIL:", f)
