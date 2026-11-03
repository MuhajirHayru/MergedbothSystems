"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { apiRequest } from "@/lib/logistics-api";

export default function ActivationForm({ uid, token }: { uid: string; token: string }) {
  const [error, setError] = useState("");
  const [activated, setActivated] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (uid || token) window.history.replaceState(null, "", "/activate-account");
  }, [uid, token]);

  async function activate() {
    setWorking(true);
    setError("");
    try {
      await apiRequest("/auth/activate/", {
        method: "POST",
        body: JSON.stringify({ uid, token }),
      });
      setActivated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The activation link could not be used.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <Link className="brand" href="/" aria-label="GreenPath logistics">
          <span className="brand-mark">GP</span>
          <span className="brand-copy"><strong>greenpath</strong><span>LOGISTICS</span></span>
        </Link>
        <div className="auth-brand-copy"><p className="eyebrow">DRIVER ONBOARDING</p><h1>Verify your account before you begin.</h1><p>Account activation confirms control of the contact email used for your driver application.</p></div>
        <span className="auth-edition">GREENPATH LOGISTICS · ACTIVATION</span>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">ACCOUNT ACTIVATION</p>
          <h2>{activated ? "Account activated" : "Confirm your email"}</h2>
          <p className="auth-subtitle">{activated ? "Your driver account is active. Complete your profile and submit it for review." : "This one-time link expires automatically and cannot be reused."}</p>
          {!uid || !token ? <p className="feedback feedback-error" role="alert">This activation link is incomplete. Register again or contact support.</p> : !activated && <button className="button button-primary" type="button" onClick={activate} disabled={working}>{working ? "Activating…" : "Activate account"}</button>}
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {activated && <p className="feedback feedback-success" role="status">Email verified. You are signed in with a session-protected account.</p>}
          <div className="auth-links"><Link className="text-button" href="/">Continue to GreenPath</Link></div>
        </div>
      </section>
    </main>
  );
}