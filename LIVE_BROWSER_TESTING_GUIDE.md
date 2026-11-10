# GREEN PATH SYSTEMS — LIVE BROWSER TESTING GUIDE

**Status:** Ready for Integration Testing  
**Date:** 2026-11-06  
**Test Environment:** Windows Development Machine

---

## PART 1: ENVIRONMENT STARTUP

### Prerequisites
- Python 3.14+ with Django, DRF, Channels installed
- Node.js with npm installed
- SQLite3 database populated (or use `python manage.py seed_greenpath`)

### Backend Startup
```powershell
cd "C:\Users\pc\Desktop\BothSystemsFolder\TheWholeDashboards here\backend"

# Run migrations (if needed - 2 unapplied migrations detected)
python manage.py migrate

# Start Django development server
python manage.py runserver 0.0.0.0:8000
```

**Backend will be available at:** `http://localhost:8000`  
**API Base URL:** `http://localhost:8000/api/v1/`

### Frontend Startup (separate terminal)
```powershell
cd "C:\Users\pc\Desktop\BothSystemsFolder\greenpath-farm-to-market-ai"

# Start Vite dev server
npm run dev
```

**Frontend will be available at:** `http://localhost:5173`

### Verify Backend Health
Open browser: `http://localhost:8000/api/v1/health/`  
Expected: `{"status": "operational", ...}`

---

## PART 2: TEST ACCOUNTS

### Use Existing Seeded Accounts
After running `python manage.py seed_greenpath`, test with:

| Role | Email | Password | Scope |
|------|-------|----------|-------|
| Super Admin | superadmin@greenpath.et | (set during seed) | National |
| Financial Manager | finance@greenpath.et | (set during seed) | All financial operations |
| Top User Admin | topuser@greenpath.et | (set during seed) | Assigned regions |
| Regional Admin | regionaladmin@greenpath.et | (set during seed) | Specific region |
| User Admin | useradmin@greenpath.et | (set during seed) | Assigned scope |
| Farmer | farmer@example.et | (set during seed) | Own listings |
| Wholesaler | wholesaler@example.et | (set during seed) | Own listings |
| Retailer | retailer@example.et | (set during seed) | Purchasing |
| Driver | driver@example.et | (set during seed) | Deliveries |

**Note:** Actual credentials are set during `seed_greenpath` command execution.

---

## PART 3: CRITICAL WORKFLOW TESTS

### A. Authentication & Authorization (30 minutes)

#### Test 1: Login & Session Management
1. Navigate to `http://localhost:5173`
2. Click "Login" (should redirect to `/login`)
3. **Test Case 1.1:** Invalid credentials
   - Enter: `wrong@example.com` / `wrongpass`
   - Expected: Error message, attempts counter increments
4. **Test Case 1.2:** Login lockout
   - Fail login 3 times consecutively
   - Expected: "Account locked for 30 minutes" message
   - Verify lockout persists after page reload
5. **Test Case 1.3:** Successful login
   - Enter valid Farmer credentials
   - Expected: Redirect to `/farmer` dashboard
   - Verify sidebar shows "Farmer Dashboard"

#### Test 2: Route Guards
1. While logged in as Farmer, manually navigate to:
   - `http://localhost:5173/super-admin` → Expected: Redirect to `/farmer` with "Access Denied" message
   - `http://localhost:5173/financial-manager` → Expected: Redirect to `/farmer`
2. Logout
3. Manually navigate to: `http://localhost:5173/farmer`
   - Expected: Redirect to `/login`

#### Test 3: Idle Timeout
1. Login as any role
2. Wait 60 minutes (default timeout) without interaction
3. Expected: Automatic logout with "Session expired" toast

#### Test 4: Token Refresh Failure
1. Login successfully
2. In browser DevTools → Application → Cookies → Delete `greenpath_refresh_token`
3. Wait for next API call or force refresh
4. Expected: Automatic logout with "Session expired" toast

**✅ PASS CRITERIA:**
- [ ] Login lockout persists across page reload
- [ ] Unauthorized dashboard access redirects to role's default view
- [ ] Session expires after configured timeout
- [ ] Token refresh failure logs user out

---

### B. Financial Manager Workflows (45 minutes)

#### Test 5: Wallet Deposit Verification
1. Login as Financial Manager
2. Navigate to "Payment Verification" or "Verification" tab
3. **Test Case 5.1:** View pending deposits
   - Expected: List of pending wallet funding requests
   - Verify each shows: user name, amount, reference, timestamp
4. **Test Case 5.2:** Approve deposit
   - Click "Approve" on a pending deposit
   - Expected: **ConfirmDialog** appears showing deposit details
   - Confirm approval
   - Expected: Toast "Deposit approved", wallet credited
   - Verify deposit moves to "Completed" status
5. **Test Case 5.3:** Reject deposit
   - Click "Reject" on another pending deposit
   - Expected: **ReasonDialog** appears requesting rejection reason
   - Enter reason: "Bank reference mismatch"
   - Confirm rejection
   - Expected: Toast "Deposit rejected", balance unchanged

#### Test 6: Manual Payout Disbursement
1. Navigate to "Payouts" tab
2. Find a pending payout **without** a linked bank account
3. Click "Approve & Disburse"
4. Expected: **ReasonDialog** requesting bank/transfer reference
5. Enter reference: "CBE-TXN-TEST-001"
6. Confirm
7. Expected: Toast "Payout approved", status updated to "Paid"

#### Test 7: Financial Dashboard Time Ranges
1. Navigate to "Financial Overview"
2. **Test Case 7.1:** "This Month" filter
   - Select "This Month" button
   - Expected: Charts show data from 1st of current month to today
   - Verify date range in URL params or state
3. **Test Case 7.2:** Custom date range
   - Click "Custom"
   - Select start date: 2026-10-01
   - Select end date: 2026-10-31
   - Expected: Charts refresh with October data only
4. **Test Case 7.3:** Date validation
   - Try to set end date before start date
   - Expected: Validation error or disabled state

#### Test 8: Expense Review (Maker-Checker)
1. Navigate to "Expenses" tab
2. **Test Case 8.1:** Submit expense (as Financial Manager)
   - Click "New Expense"
   - Fill: Category="Office Supplies", Amount=5000, Description="Paper & toner"
   - Submit
   - Expected: Toast "Expense submitted. A Super Admin must approve it before payment."
3. **Test Case 8.2:** Attempt self-approval (should fail)
   - As Financial Manager, try to approve own expense
   - Expected: "Approve" button disabled OR backend returns 403
4. Login as Super Admin (separate test session)
5. **Test Case 8.3:** Super Admin approves expense
   - Navigate to Financial Manager → Expenses
   - Click "Approve" on pending expense
   - Expected: Expense status changes to "Approved"
6. **Test Case 8.4:** Super Admin rejects with reason
   - Click "Reject" on another expense
   - Expected: **ReasonDialog** appears
   - Enter reason: "Insufficient documentation"
   - Confirm
   - Expected: Toast "Expense rejected", audit record created

**✅ PASS CRITERIA:**
- [ ] All `window.prompt` replaced with accessible dialogs
- [ ] Confirmations show transaction details before action
- [ ] Maker-checker separation enforced (FM cannot approve own expenses)
- [ ] "This Month" correctly spans from month start
- [ ] Rejection reasons recorded in audit trail

---

### C. Super Admin Dashboard (30 minutes)

#### Test 9: CMS Content Management
1. Login as Super Admin
2. Navigate to `/super-admin` → "Content" tab (or URL: `#content`)
3. **Test Case 9.1:** Edit CMS fields
   - Change Platform Title: "Green Path Ethiopia"
   - Change Amharic Title: "ግሪን ፓዝ ኢትዮጵያ"
   - Change Oromo Title: ""  (intentionally empty)
   - Click "Save & Publish"
4. Expected: **ConfirmDialog** appears
   - Description: "This immediately updates the public website..."
   - Confirm
5. Expected: Toast "Platform configuration updated"
6. Reload page, verify:
   - Platform Title persists
   - Amharic title persists
   - Oromo title remains empty (not replaced with default)

#### Test 10: Delivery Pricing Configuration
1. Navigate to "Finance" tab
2. **Test Case 10.1:** Create delivery pricing rule
   - Name: "Test Urban Standard"
   - Region: (select from dropdown)
   - Category: (select from dropdown or "All categories")
   - Fee Type: Percentage
   - Fee Value: 15
   - Minimum Fee: 50
   - Maximum Fee: 500
   - Effective From: 2026-11-06 00:00
   - Effective To: 2026-12-31 23:59
3. Click "Save"
4. **Test Case 10.2:** Validation errors
   - Try: Fee Value = 150 (>100%)
   - Expected: Error "A percentage fee cannot exceed 100%"
   - Try: Maximum Fee = 30 (< Minimum 50)
   - Expected: Error "Maximum fee cannot be lower than the minimum fee"
   - Try: Effective To before Effective From
   - Expected: Error "The end date must be after the start date"
5. Fix errors and save successfully

#### Test 11: Financial Configuration Approval
1. Navigate to Financial Controls section
2. Find a pending configuration
3. Click "Approve"
4. Expected: **ConfirmDialog** appears
   - Shows config name and version
   - Warning: "cannot be undone from this screen"
5. Confirm
6. Expected: Config status changes to "Active", toast notification

#### Test 12: Pricing Rule Deactivation
1. Find an active delivery pricing rule
2. Click "Deactivate"
3. Expected: **ReasonDialog** appears
   - Description: "Existing agreements keep their terms..."
   - Requires reason for audit trail
4. Enter reason: "Superseded by new regional policy"
5. Confirm
6. Expected: Rule status changes to "Inactive", reason recorded

**✅ PASS CRITERIA:**
- [ ] CMS Amharic/Oromo titles persist correctly
- [ ] Empty CMS fields remain empty (not replaced with defaults)
- [ ] Pricing validation catches all error cases
- [ ] Tab URL syncs with browser hash (`#content`, `#finance`)
- [ ] All high-risk actions show confirmation dialogs

---

### D. Geographic Restrictions (25 minutes)

#### Test 13: Regional Admin Scope
1. Create Regional Admin for "Addis Ababa" region
2. Login as Regional Admin
3. Navigate to user directory
4. **Test Case 13.1:** User visibility
   - Expected: See only users from Addis Ababa region
   - Should NOT see users from Oromia, Tigray, etc.
5. **Test Case 13.2:** Attempt to approve user from different region
   - Manually craft API request (or use DevTools)
   - `POST /api/v1/admin/users/{user_id}/override/` with Oromia user
   - Expected: 403 Forbidden

#### Test 14: Zonal Admin Scope
1. Create Zonal Admin for "Kirkos" zone (Addis Ababa)
2. Login as Zonal Admin
3. Navigate to user directory
4. Expected: See only users from Kirkos zone
5. Should NOT see users from other zones in Addis Ababa

#### Test 15: Super Admin National Scope
1. Login as Super Admin
2. Navigate to user directory
3. Expected: See ALL users from ALL regions
4. Expected: Regional filter dropdown shows all regions

**✅ PASS CRITERIA:**
- [ ] Regional Admins see only their assigned region
- [ ] Zonal Admins see only their assigned zone
- [ ] Wereda Admins see only their assigned wereda
- [ ] Geographic restrictions enforced by backend (not just UI)
- [ ] Super Admin has unrestricted national scope

---

### E. Search & CSV Export (15 minutes)

#### Test 16: Search Debouncing
1. Login as Super Admin
2. Navigate to "Account Control" panel
3. **Test Case 16.1:** Search field behavior
   - Type quickly: "farmer"
   - Observe Network tab in DevTools
   - Expected: API call triggers **400ms after typing stops** (not on every keystroke)
4. Navigate to "System Admin" → Orders tab
5. **Test Case 16.2:** Order search debouncing
   - Type quickly: "ORD-2026"
   - Expected: API call triggers after 400ms debounce

#### Test 17: CSV Export
1. Navigate to "Regional Financial Reports"
2. Click "Export CSV"
3. Download file: `GreenPath_Regional_Financial_Report_2026-11-06.csv`
4. **Test Case 17.1:** Open in Excel/LibreOffice
   - Verify Amharic characters render correctly (UTF-8 BOM working)
5. **Test Case 17.2:** Formula injection protection
   - Inspect CSV content in text editor
   - Find any cell that starts with `=`, `+`, `-`, `@`
   - Expected: Cell should be prefixed with single quote `'` to prevent formula execution

**✅ PASS CRITERIA:**
- [ ] Search inputs debounce at 400ms (verify in Network tab)
- [ ] CSV exports include UTF-8 BOM (Amharic renders correctly)
- [ ] CSV cells starting with formula chars are escaped with `'`

---

### F. Modal Accessibility (10 minutes)

#### Test 18: Keyboard Navigation
1. Login as Financial Manager
2. Navigate to Payouts tab
3. Click "Approve & Disburse" (opens ReasonDialog)
4. **Test Case 18.1:** Focus trap
   - Press Tab repeatedly
   - Expected: Focus cycles within modal (never escapes to background)
5. **Test Case 18.2:** Escape key
   - Press Esc
   - Expected: Modal closes, focus returns to "Approve" button
6. **Test Case 18.3:** ARIA attributes
   - Open DevTools → Elements
   - Inspect modal element
   - Expected: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` present

**✅ PASS CRITERIA:**
- [ ] Tab key trapped within modal
- [ ] Escape key closes modal
- [ ] Focus returns to trigger element on close
- [ ] Proper ARIA attributes present

---

### G. Print Layout (5 minutes)

#### Test 19: Print Preview
1. Navigate to Regional Financial Reports
2. Open browser print preview (Ctrl+P)
3. **Test Case 19.1:** Chrome removed
   - Expected: Header, sidebar, navigation hidden
   - Expected: Only report content and charts visible
4. **Test Case 19.2:** Page breaks
   - Expected: Tables and charts don't break mid-content

**✅ PASS CRITERIA:**
- [ ] Navigation elements hidden in print view
- [ ] Content readable and properly formatted

---

## PART 4: EDGE CASES & SECURITY

### Test 20: Concurrent Sessions
1. Login as Farmer in Browser A
2. Login as same Farmer in Browser B
3. In Browser A, change password
4. Expected: Browser B's session invalidated, forced to re-login

### Test 21: Stale Token Handling
1. Login successfully
2. Backend: Manually expire access token in database
3. Frontend: Make API call
4. Expected: Automatic refresh attempt, or logout if refresh fails

### Test 22: SQL Injection Attempts
1. Login form email field: Enter `' OR 1=1--`
2. Expected: Login fails (parameterized queries prevent injection)
3. Search field: Enter `'; DROP TABLE users;--`
4. Expected: Treated as literal string, no database modification

---

## PART 5: PERFORMANCE CHECKS

### Test 23: Bundle Size
1. Run production build: `npm run build`
2. Check `dist/` folder sizes
3. Expected: Main bundle < 600KB gzipped
4. Expected: Code-split chunks loaded on demand

### Test 24: API Response Times
1. Open DevTools → Network tab
2. Navigate through dashboards
3. Observe API response times
4. Expected: Most endpoints < 500ms
5. Expected: No N+1 query problems (backend test coverage: 82%)

---

## PART 6: REGRESSION TESTS

Run these to ensure fixes didn't break existing functionality:

- [ ] Marketplace browsing works
- [ ] Product listing creation works
- [ ] Order placement works
- [ ] Messaging/chat works
- [ ] WebSocket real-time updates work
- [ ] File uploads work
- [ ] Notifications display correctly
- [ ] Dark mode toggle works
- [ ] Mobile responsive layout works

---

## PART 7: KNOWN LIMITATIONS

**Not Tested (Require Live Services):**
- Chapa payment gateway integration (use sandbox mode)
- SMS notifications (mock service)
- Email delivery (check logs, not actual delivery)
- Voice transcription (optional feature)

**Backend Migrations Pending:**
- `assistant.0002_alter_assistantconversation_options_and_more`
- `registrations.0011_alter_userregistration_options_and_more`

Run `python manage.py migrate` before testing to apply these.

---

## PART 8: TEST RESULT TRACKING

For each test case above, mark:
- ✅ PASS — Verified working end-to-end
- ⚠️ PARTIAL — Some aspects work, minor issues found
- ❌ FAIL — Critical defect, blocks workflow
- 🔒 BLOCKED — Cannot test due to environment/credentials

### Example Result Log:
```
Test 1.1: Invalid credentials → ✅ PASS
Test 1.2: Login lockout → ✅ PASS (persists across reload)
Test 5.2: Approve deposit → ✅ PASS (ConfirmDialog shows correctly)
Test 8.2: Maker-checker → ⚠️ PARTIAL (UI button disabled, need to verify backend 403)
Test 13.1: Regional scope → 🔒 BLOCKED (need to create test Regional Admin first)
```

---

## FINAL CHECKLIST

Before declaring production-ready:
- [ ] All 24 test cases executed
- [ ] Zero ❌ FAIL results
- [ ] All 🔒 BLOCKED tests resolved or documented
- [ ] Security tests (20-22) passed
- [ ] Performance benchmarks met
- [ ] Regression tests passed
- [ ] Backend test suite: 574 passed ✅
- [ ] Frontend build: successful ✅
- [ ] TypeScript compilation: zero errors ✅

---

**Document Version:** 1.0  
**Last Updated:** 2026-11-06  
**Estimated Testing Time:** 3-4 hours for comprehensive coverage
