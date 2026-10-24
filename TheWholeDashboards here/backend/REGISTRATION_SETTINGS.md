# Marketplace registration settings

The registration form reads dynamic field settings from
`GET /api/v1/registration/form-fields/?stage=INITIAL&role=DRIVER`. The response
must have a `results` array containing the visible, required `full_name` and
`email` fields and the `phone` field for `DRIVER`. A non-success response or an
incomplete response intentionally leaves registration disabled.

## Restore settings on an existing Marketplace database

The existing Django migrations seed the configurable fields and extend the
initial registration fields to the `DRIVER` role. In particular,
`registrations.0009_driver_registration_fields` updates the `full_name`,
`email`, and `phone` role assignments. Do not create field rows by hand or
replace these settings with frontend defaults.

1. Deploy or check out the Marketplace backend version that includes the
   `DRIVER` role and registration migrations. Restart the backend process after
   deploying the code so the service uses that version.
2. Back up the configured Marketplace database using the project's normal
   database backup procedure. Check `python manage.py showmigrations
   registrations` and review `python manage.py migrate --plan`.
3. Apply the pending migrations with `python manage.py migrate`. This uses the
   existing migration and settings architecture; it does not reset the
   database. For production, follow the deployment's normal reviewed migration
   procedure.
4. As a Super Admin, open `/super-admin/registration-fields` and confirm that
   the INITIAL `full_name`, `email`, and `phone` fields include `DRIVER` in
   their roles. `full_name` and `email` must remain visible and required. Keep
   the phone field available according to the existing phone policy. Save any
   intentional dynamic settings through this page.
5. Request the URL above again. It should return HTTP 200 with
   `{ "results": [...] }`; confirm the returned field rows satisfy the
   requirements before enabling registration traffic.

If the endpoint still fails after deployment and migrations, inspect the
response and the Super Admin field settings. Do not bypass the registration
guard or use the page's reference fields as registration settings.
