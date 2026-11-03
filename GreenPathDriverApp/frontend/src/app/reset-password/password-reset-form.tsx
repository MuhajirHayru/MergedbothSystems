"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

import { apiRequest } from "@/lib/logistics-api";
import { PasswordField } from "../ui";

export default function PasswordResetForm({ uid, token }: { uid: string; token: string }) {
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (uid || token) window.history.replaceState(null, "", "/reset-password");
  }, [uid, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/password-reset/confirm/", {
        method: "POST",
        body: JSON.stringify({ uid, token, new_password: form.get("new_password") }),
      });
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reset link could not be used.");
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
        <div className="auth-brand-copy"><p className="eyebrow">ACCOUNT SECURITY</p><h1>A secure return to your workspace.</h1><p>Password recovery links are single-use and expire automatically.</p></div>
        <span className="auth-edition">GREENPATH LOGISTICS · RECOVERY</span>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <p className="eyebrow">PASSWORD RECOVERY</p>
          <h2>{complete ? "Password updated" : "Choose a new password"}</h2>
          <p className="auth-subtitle">{complete ? "Your account is ready for secure sign-in." : "Set a strong password. The server validates and stores only a password hash."}</p>
          {!complete && uid && token && <form className="auth-form" onSubmit={submit}>
            <PasswordField label="New password" name="new_password" autoComplete="new-password" minLength={12} />
            <button className="button button-primary" type="submit" disabled={working}>{working ? "Updating…" : "Update password"}</button>
          </form>}
          {(!uid || !token) && !complete && <p className="feedback feedback-error" role="alert">This reset link is incomplete. Request a new password reset.</p>}
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {complete && <p className="feedback feedback-success" role="status">The reset link has been consumed and cannot be reused.</p>}
          <div className="auth-links"><Link className="text-button" href="/">Back to sign in</Link></div>
        </div>
      </section>
    </main>
  );
}