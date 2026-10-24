"use client";

import { useState } from "react";
import { ArrowUpRight, Truck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { DRIVER_APP_URL, establishDriverAppSession } from "@/lib/api/client";

export default function DriverAccessPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openDriverApp() {
    setBusy(true);
    setError("");
    try {
      await establishDriverAppSession();
      window.location.assign(DRIVER_APP_URL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DriverApp access could not be established.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Driver access" allow={["DRIVER"]}>
      <div className="mx-auto max-w-2xl space-y-5">
        <Card className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-amber-50 p-3 text-amber-700"><Truck className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Your GreenPath driver account</h1>
              <p className="text-sm text-gray-600">Marketplace is your identity and approval authority.</p>
            </div>
          </div>
          <p className="text-sm leading-6 text-gray-700">
            Your verified driver authorization is synchronized to DriverApp. Continue with this account to view eligible delivery offers and manage shipment progress.
          </p>
          {error && <ErrorBanner message={error} />}
          <Button type="button" loading={busy} disabled={!DRIVER_APP_URL} onClick={() => void openDriverApp()}>
            Continue to DriverApp <ArrowUpRight className="h-4 w-4" />
          </Button>
          {!DRIVER_APP_URL && (
            <p className="text-xs text-amber-800">DriverApp browser and API URLs are not configured for this environment.</p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
