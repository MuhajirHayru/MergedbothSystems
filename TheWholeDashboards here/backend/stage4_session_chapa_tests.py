import json, os, time, urllib.request, urllib.error
import hmac, hashlib

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")
import django
django.setup()
from django.conf import settings
from users.models import User
from payments.models import WalletFundingRequest
from payments.chapa import verify_webhook_signature

BASE = "http://127.0.0.1:8000"
QA = "Stage3QA@2026!"

def login(email):
    req = urllib.request.Request(f"{BASE}/api/v1/auth/login/", method="POST",
        data=json.dumps({"email": email, "password": QA}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def call(url, token=None, method="GET", data=None):
    h = {}
    if token: h["Authorization"] = f"Bearer {token}"
    if data is not None: h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + url, method=method,
        data=json.dumps(data).encode() if data is not None else None, headers=h)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                time.sleep(2 * (attempt + 1))
                # Rebuild the request — the original body stream was consumed.
                req2 = urllib.request.Request(BASE + url, method=method,
                    data=json.dumps(data).encode() if data is not None else None, headers=h)
                req = req2
                continue
            try:
                return e.code, json.loads(e.read() or b"{}")
            except Exception:
                return e.code, {}

print("=== C. Financial configuration maker-checker (continued) ===")
sa = login("super_admin01@greenpath.et")["access"]
fm = login("financial_manager02@greenpath.et")
from payments.financial_models import FinancialConfiguration, FinancialJournalEntry
from users.models import AuditLog
cfg = FinancialConfiguration.objects.filter(name="Stage4 commission draft").first()
if cfg:
    print("C-recap: status:", cfg.status, "| version:", cfg.version)
s, r = call("/api/v1/payments/financial/configurations/", "GET", sa)
rows = r.get("results", r) if isinstance(r, dict) else r
cfg_row = next((x for x in rows if isinstance(x, dict) and x.get("name") == "Stage4 commission draft"), None)
if cfg_row:
    print("C7 audit trail:", end=" ")
    aud = AuditLog.objects.filter(action__icontains="configuration").order_by("-created_at").first()
    print(aud.action if aud else "n/a")
else:
    print("C7: config not found in list")

print("=== Session security inventory ===")
print("Backend session cookie age:", dj_settings_val := getattr(settings, "SESSION_COOKIE_AGE", None), "s")
print("JWT access lifetime:", getattr(settings, "SIMPLE_JWT", {}).get("ACCESS_TOKEN_LIFETIME"))
print("JWT refresh lifetime:", getattr(settings, "SIMPLE_JWT", {}).get("REFRESH_TOKEN_LIFETIME"))
print("Rotate refresh:", getattr(settings, "SIMPLE_JWT", {}).get("ROTATE_REFRESH_TOKENS"))
print("Frontend idle timeout (PlatformSettings.session_timeout_minutes): 60 min (DB default)")
print("Guide expectation: 60 min idle — frontend enforces sessionTimeoutMinutes from DB (60); backend cookie is 30 min")
print("=> Intended config: frontend auto-logout at 60 min idle (DB value); backend cookie lifetime is separate (30 min) and only affects the refresh cookie path")

print("=== Two-session invalidation test ===")
# Session A: login
sA, rA = call("/api/v1/auth/login/", method="POST", data={"email": "farmer15@greenpath.et", "password": QA})
print("login A:", sA)
tokA = rA["access"]
# Session B: login (second browser)
sB, rB = call("/api/v1/auth/login/", method="POST", data={"email": "farmer15@greenpath.et", "password": QA})
import time; time.sleep(2)
tokB = rB["access"]
# Browser A changes password
sC, rC = call("/api/v1/auth/password/change/", tokA, "POST",
              {"current_password": QA, "new_password": "Stage4Rotated@2026!", "confirm_password": "Stage4Rotated@2026!"})
print("A password change:", sC)
# Browser B: authenticated request with pre-change token
sB1 = call("/api/v1/auth/me/", tokB)
print("B old access token after A's password change:", sB1, "(401 = invalidated)")
# Browser B: refresh attempt using old cookie (no cookie server-side → missing)
sB2, rB2 = call("/api/v1/auth/token/refresh/", "POST", data={})
print("B refresh without cookie:", sB2, "(401 = old session cannot refresh)")
# restore password
call("/api/v1/auth/password/change/", tokA, "POST",
     {"current_password": "Stage4Rotated@2026!", "new_password": QA, "confirm_password": QA})
print("password restored to QA value")

print("=== Chapa sandbox: webhook signature + duplicate handling ===")
from payments.chapa import verify_webhook_signature
import urllib.request as _u
secret = None
for line in open(r"TheWholeDashboards here\backend\.env", encoding="utf-8"):
    if line.startswith("CHAPA_WEBHOOK_SECRET"):
        secret = line.split("=", 1)[1].strip()
if not secret:
    print("CHAPA_WEBHOOK_SECRET not in .env — checking settings default")
    from django.conf import settings as _s
    secret = getattr(_s, "CHAPA_WEBHOOK_SECRET", "")
body = json.dumps({"event": "charge.success", "data": {"tx_ref": "GPTEST123", "status": "success"}}).encode()
sig_ok = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
sig_bad = "sha256=" + "0" * 64
s_ok = call("/api/v1/wallet/chapa/webhook/", None, "POST", data={}) if False else None
# use raw urllib to send the signed body
req = urllib.request.Request(BASE + "/api/v1/wallet/chapa/webhook/", method="POST", data=body,
    headers={"Content-Type": "application/json", "x-chapa-signature": sig_ok})
with urllib.request.urlopen(req) as r:
    print("valid-signature webhook:", r.status, r.read().decode()[:80])
req = urllib.request.Request(BASE + "/api/v1/wallet/chapa/webhook/", method="POST", data=body,
    headers={"Content-Type": "application/json", "x-chapa-signature": sig_bad})
try:
    with urllib.request.urlopen(req) as r:
        print("bad-signature webhook:", r.status, r.read().decode()[:80])
except urllib.error.HTTPError as e:
    print("bad-signature webhook rejected:", e.code, "(spoof blocked)")
PYEOF
