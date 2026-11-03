This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

For local development, set `NEXT_PUBLIC_MARKETPLACE_REGISTER_URL=http://localhost:3000/register` in `frontend/.env.local` (copy `frontend/.env.example` as a starting point). This URL must point to the Marketplace frontend. DriverApp adds `role=DRIVER`, which selects Driver in Marketplace's existing `/register` flow. Set the URL explicitly for every deployment; production must use the deployed Marketplace origin, never the local example. Because this is a `NEXT_PUBLIC_*` value, restart the development server after changing it and rebuild the frontend after changing it for production.

For local Marketplace-backed driver sign-in, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8001/api`, `NEXT_PUBLIC_MARKETPLACE_API_BASE_URL=http://localhost:8000`, and `NEXT_PUBLIC_MARKETPLACE_INTEGRATED=true`. DriverApp sends email and password to Marketplace `POST /api/v1/auth/login/`, then exchanges the short-lived access token with DriverApp `POST /api/integrations/v2/driver/session/`. DriverApp accepts only a verified, approved canonical Marketplace driver identity; registration remains managed in Marketplace. The Marketplace API URL is public configuration and must never contain credentials or secrets.

For an integrated deployment, also set `MARKETPLACE_INTEGRATION_ENABLED=true` in the DriverApp backend and configure `GREENPATH_MARKETPLACE_API_BASE_URL`, `MARKETPLACE_LOGIN_ALLOWED_ORIGINS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` for the deployed Marketplace API and DriverApp frontend. Keep `MARKETPLACE_INTEGRATION_SECRET` server-side. Configure Marketplace's `GREENPATH_DRIVER_INTEGRATION_BASE_URL` and `GREENPATH_DRIVER_INTEGRATION_SECRET` with the matching DriverApp integration endpoint and secret to deliver approval and suspension events. Apply the existing DriverApp migrations before enabling the session exchange. Do not put any integration secret in `NEXT_PUBLIC_*` variables.

These frontend variables are inlined at build time. Restart `next dev` after editing `.env.local`, and rebuild the frontend after changing them for production. Production deployments must set explicit deployed URLs; do not use the local examples.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
