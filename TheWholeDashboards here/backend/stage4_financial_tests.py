import json, os, time, urllib.request, urllib.error
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "greenpath.settings")
django.setup()
from payments.models import WalletFundingRequest, Wallet, WalletPayoutRequest, WalletTransaction
from users.models import AuditLog

BASE = "http://127.0.0.1:8000"
QA = "Stage3QA@2026!"
WS_EMAIL = "wholesaler10@greenpath.et"

def login(email):
    req = urllib.request.Request(f"{BASE}/api/v1/auth/login/", method="POST",
        data=json.dumps({"email": email, "password": QA}).encode(),
        headers={"Content-Type": "application/json"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req) as r:
                return json.loads(r.read())["access"]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(3)
                continue
            body = e.read().decode()[:200]
            if "locked" in body.lower():
                u = User.objects.get(email=email)
                u.failed_login_attempts = 0
                u.locked_until = None
                u.set_password(QA)
                u.save()
                continue
            raise
    raise RuntimeError(f"login failed: {email}")

def raw(url, token, method="GET", data=None):
    h = {"Authorization": f"Bearer {token}"}
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + url, method=method,
        data=json.dumps(data).encode() if data is not None else None, headers=h)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read().decode()[:500]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]

print("=== A. Deposit rejection (wholesaler10 QA deposit) ===")
dep = "5c33c2aa-50bd-4bc6-9037-88a4fd1a4f24"  # created earlier: 300 ETB, Bank Transfer, CBE-STAGE4-QA-001
fm = login("financial_manager02@greenpath.et")
w = Wallet.objects.get(user__email=WS_EMAIL)
print("A1 deposit status before:", WalletFundingRequest.objects.get(pk=dep).status, "| wallet:", w.available_balance)
s, body = raw(f"/api/v1/wallet/funding/{dep}/review/", fm, "POST",
              {"approve": False, "notes": "Stage4 rejection test — bank reference mismatch"})
print("A2 FM reject:", s, "|", body[:150])
fr = WalletFundingRequest.objects.get(pk=dep)
w2 = Wallet.objects.get(user__email=WS_EMAIL)
print("A3 status now:", fr.status, "| wallet unchanged:", w2.available_balance == w.available_balance)
audit = AuditLog.objects.filter(target=str(dep)).order_by("-created_at").first()
print("A4 audit:", audit.action if audit else None, "| by:", audit.actor.email if audit else None)
s5a, _ = raw(f"/api/v1/wallet/funding/{dep}/review/", fm, "POST", {"approve": False, "notes": "double-reject"})
s5b, _ = raw(f"/api/v1/wallet/funding/{dep}/review/", fm, "POST", {"approve": True, "notes": "double-approve"})
final = WalletFundingRequest.objects.get(pk=dep)
w3 = Wallet.objects.get(user__email=WS_EMAIL)
print("A5 double-process blocked:", s5a in (400, 403, 409) and s5b in (400, 403, 409),
      "| final:", final.status, "| wallet:", w3.available_balance)

print("=== B. Payout disbursement ===")
ws_token = login(WS_EMAIL)
# Reserve: available -> held
s, body = raw("/api/v1/wallet/payouts/", ws_token, "POST",
              {"amount": "250.00", "destination": "Commercial Bank 1234",
               "payout_account": None})
print("B1 payout request:", s, "|", body[:160])
import re
pid = json.loads(body)["id"] if s == 201 else None
w4 = Wallet.objects.get(user__email=WS_EMAIL)
print("B2 reservation: available:", w4.available_balance, "| held:", w4.held_balance)
tx = WalletTransaction.objects.filter(wallet=w4, reference=f"PAYOUT-HOLD-{pid}").first()
print("B3 reservation tx:", bool(tx), "|", (tx.transaction_type if tx else ""))
s, body = raw(f"/api/v1/wallet/payouts/{pid}/review/", fm, "POST",
              {"approve": True, "external_reference": "CBE-TXN-STAGE4-001", "notes": "Stage4 disbursement verification"})
print("B4 FM approve+disburse:", s, "|", body[:160])
payout = WalletPayoutRequest.objects.get(pk=pid)
print("B5 payout status:", payout.status, "| external ref:", payout.external_reference)
tx2 = WalletTransaction.objects.filter(wallet=w4, reference=f"PAYOUT-{pid}").first()
print("B6 disbursement tx:", bool(tx2), "|", (tx2.transaction_type if tx2 else ""))
je = __import__("payments.models", fromlist=["FinancialJournalEntry"]).FinancialJournalEntry.objects.filter(source_reference__icontains=str(pid))
print("B7 journal entries linked:", je.count())
# Duplicate submission: same idempotency key
s, body = raw("/api/v1/wallet/payouts/", ws_token, "POST",
              {"amount": "250.00", "destination": "Commercial Bank 1234"})
print("B8 duplicate without idempotency rejected or new:", s, "| wallet held:", Wallet.objects.get(user__email=WS_EMAIL).held_balance)

print("=== C. Financial configuration maker-checker ===")
s, body = raw("/api/v1/payments/financial/configurations/", fm, "POST",
              {"kind": "COMMISSION", "name": "Stage4 commission draft", "reason": "Stage4 maker-checker test",
               "rules": {"marketplace_commission": "0.05"}, "effective_from": "2026-11-06T00:00:00Z"})
cfg = json.loads(body).get("id") if s in (200, 201) else None
print("C1 FM creates draft:", s, "| id:", cfg)
if cfg:
    s, body = raw(f"/api/v1/payments/financial/configurations/{cfg}/approve/", fm, "POST", {})
    print("C2 FM self-approval attempt:", s, "|", body[:120])
    sa_token = login("super_admin01@greenpath.et")
    s, body = raw(f"/api/v1/payments/financial/configurations/{cfg}/approve/", sa_token, "POST", {})
    print("C3 SA approves:", s, "|", body[:120])
    cfgrow = json.loads(body) if s == 200 else {}
    print("C4 status:", cfgrow.get("status"), "| version:", cfgrow.get("version"))
    s, body = raw(f"/api/v1/payments/financial/configurations/{cfg}/approve/", sa_token, "POST", {})
    print("C5 re-approval blocked:", s in (400, 403, 409), "|", body[:100])
from users.models import AuditLog
aud = AuditLog.objects.filter(action__icontains="configuration").order_by("-created_at").first()
print("C6 audit:", aud.action if aud else None)
