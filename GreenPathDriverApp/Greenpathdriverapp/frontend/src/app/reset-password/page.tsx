import { Suspense } from "react";

import PasswordResetForm from "./password-reset-form";

type ResetSearchParams = Promise<{
  uid?: string | string[];
  token?: string | string[];
}>;

async function ResetPasswordContent({
  searchParams,
}: {
  searchParams: ResetSearchParams;
}) {
  const params = await searchParams;
  const uid = typeof params.uid === "string" ? params.uid : "";
  const token = typeof params.token === "string" ? params.token : "";

  return <PasswordResetForm uid={uid} token={token} />;
}

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: ResetSearchParams;
}) {
  return (
    <Suspense fallback={<main className="auth-loading">Loading password reset…</main>}>
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  );
}