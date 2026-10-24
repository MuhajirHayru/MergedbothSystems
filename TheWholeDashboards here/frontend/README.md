# Green Path frontend

## Local production-mode verification

The `dev` script runs `next dev`, which compiles routes on demand and displays
the Next.js development indicator. To verify production behavior locally, build
and start the optimized application:

```powershell
npm run build
npm run start -- --port 3001
```

The production server defaults to port 3000 when `--port` is omitted. Django's
default local CORS allowlist includes `localhost` and `127.0.0.1` on ports 3000
and 3001. For deployments, set `DJANGO_CORS_ORIGINS` to the exact frontend
origins; do not use wildcard origins.

## API configuration

Set these public frontend variables before `npm run build`. Next.js embeds
`NEXT_PUBLIC_*` values into the generated client bundle, so changing them only
when starting the production server does not update the built application.

- `NEXT_PUBLIC_API_URL`: Django REST API root, for example
  `https://api.example.com/api/v1`.
- `NEXT_PUBLIC_WS_URL`: Django host used for WebSocket connections, for example
  `https://api.example.com`; the client converts the scheme to `wss`.

Use the same API and WebSocket endpoints intended for the target deployment.
Keep Django credentials and other server-only secrets out of `NEXT_PUBLIC_*`
variables.
