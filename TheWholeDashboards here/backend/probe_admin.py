import json, urllib.request
token=open('admintoken.txt').read().strip()
def get(path):
    req=urllib.request.Request('http://127.0.0.1:8000/api/v1'+path, headers={'Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            print(path, r.status, r.read().decode()[:1000])
            print()
    except Exception as e:
        print(path, 'ERR', e)
        try: print(e.read().decode()[:500])
        except: pass

for p in ['/admin/pending-users/','/admin/users/','/admin/registrations/','/dashboard/admin/','/dashboard/payments/','/dashboard/financial-operations/','/reports/financial-summary/','/reports/transaction-volume/','/dashboard/wallet-activity/']:
    get(p)
PY