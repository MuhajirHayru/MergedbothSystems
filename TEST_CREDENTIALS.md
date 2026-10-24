# GreenPath Driver App - Test Credentials

## Test Driver Accounts

The following driver accounts are available for testing the GreenPath Driver App login:

### Driver 1: GreenPath E2E Test Driver
- **Email:** `gp.driver.test.mvibm0qg997010@example.invalid`
- **Password:** `TestDriver123!`
- **Status:** APPROVED
- **Synchronized:** ✓ Yes (MarketplaceDriverIdentity exists)

### Driver 2: Chrome Driver Test
- **Email:** `testdriver@example.com`
- **Password:** (needs to be set - see below)
- **Status:** APPROVED
- **Synchronized:** (needs verification)

## How to Use

1. **Ensure all services are running:**
   - Marketplace Frontend: http://localhost:3000
   - Marketplace Backend: http://localhost:8000
   - DriverApp Frontend: http://localhost:3001
   - DriverApp Backend: http://localhost:8001

2. **Open the DriverApp in your browser:**
   ```
   http://localhost:3001
   ```

3. **Login with the test credentials above**

## Authentication Flow

The DriverApp uses integrated Marketplace authentication:
1. User enters email/password on DriverApp login page
2. DriverApp frontend sends credentials to Marketplace backend (`POST /api/v1/auth/login/`)
3. Marketplace validates credentials and returns an access token
4. DriverApp frontend exchanges the Marketplace token for a DriverApp session (`POST /api/integrations/v2/driver/session/`)
5. DriverApp backend verifies the token with Marketplace and creates a local session
6. User is logged into the DriverApp

## Troubleshooting "Failed to Fetch" Errors

If you see "Failed to fetch" during login, check:

1. **Valid Credentials:** Ensure you're using the correct email and password
2. **Driver Synchronization:** The driver must have a `MarketplaceDriverIdentity` record in the DriverApp database
3. **Services Running:** All 4 services must be running and accessible
4. **CORS Configuration:** Frontend origin must be in `CORS_ALLOWED_ORIGINS` and `MARKETPLACE_LOGIN_ALLOWED_ORIGINS`

## Setting Up Additional Test Drivers

To set a password for the second driver or create new test drivers, use the Django shell:

```python
python manage.py shell
from users.models import User, Role

# Set password for existing driver
driver = User.objects.get(email='testdriver@example.com')
driver.set_password('YourPasswordHere')
driver.save()
```

## Current System Status

- ✅ All 4 services running on correct ports
- ✅ Environment variables configured correctly
- ✅ CORS and CSRF configured properly
- ✅ Marketplace authentication working
- ✅ Session exchange working
- ✅ At least one driver account fully functional

**Last Updated:** 2026-10-24 19:00 UTC
