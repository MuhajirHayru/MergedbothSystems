import json, urllib.request
token=open('token.txt').read().strip()
def get(path):
    req=urllib.request.Request('http://127.0.0.1:8000/api/v1'+path, headers={'Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            data=r.read().decode()
            print(path, r.status)
            print(data[:1500])
            print()
    except Exception as e:
        print(path, 'ERR', e)
        try:
            print(e.read().decode()[:500])
        except Exception:
            pass

for p in [
 '/auth/me/',
 '/dashboard/farmer/',
 '/products/farmer-listings/my/',
 '/orders/',
 '/wallet/',
 '/wallet/transactions/',
 '/wallet/payouts/',
 '/wallet/bank-accounts/',
 '/notifications/',
 '/notifications/unread-count/',
 '/chat/channels/',
 '/admin/pending-users/',
 '/admin/users/',
 '/admin/registrations/',
 '/superadmin/health/',
 '/superadmin/users/',
 '/superadmin/settings/',
]:
    get(p)
PY