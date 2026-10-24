import { Suspense } from "react";

import ActivationForm from "./activation-form";

type ActivationSearchParams = Promise<{
  uid?: string | string[];
  token?: string | string[];
}>;

async function ActivateAccountContent({
  searchParams,
}: {
  searchParams: ActivationSearchParams;
}) {
  const params = await searchParams;
  const uid = typeof params.uid === "string" ? params.uid : "";
  const token = typeof params.token === "string" ? params.token : "";

  return <ActivationForm uid={uid} token={token} />;
}

export default function ActivateAccountPage({
  searchParams,
}: {
  searchParams: ActivationSearchParams;
}) {
  return (
    <Suspense fallback={<main className="auth-loading">Loading activation link…</main>}>
      <ActivateAccountContent searchParams={searchParams} />
    </Suspense>
  );
}