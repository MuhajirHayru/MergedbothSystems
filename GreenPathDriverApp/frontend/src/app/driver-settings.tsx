"use client"

import { useState, type FormEvent } from "react"
import { Eye, EyeOff, Landmark, LogOut, ShieldCheck } from "lucide-react"

import { apiRequest } from "@/lib/logistics-api"

type SettingsUser = {
  username: string
  email: string
  first_name: string
  last_name: string
  role: string
  is_active: boolean
}

type DriverSettingsProps = {
  user: SettingsUser
  phone?: string
  preferredLanguage?: string
  onSignOut: () => void
  signingOut?: boolean
}

type PasswordFieldProps = {
  name: string
  label: string
  autoComplete: string
  minLength?: number
}

function PasswordInput({ name, label, autoComplete, minLength }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const id = `settings-${name}`
  return (
    <label className="form-field" htmlFor={id}>
      {label}
      <span className="password-control">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          className="password-toggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </label>
  )
}

export default function DriverSettings({
  user,
  phone,
  preferredLanguage,
  onSignOut,
  signingOut = false,
}: DriverSettingsProps) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const languageLabel =
    preferredLanguage === "am" ? "Amharic" : preferredLanguage === "om" ? "Afaan Oromo" : "English"

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const form = event.currentTarget
    const currentPassword = (form.elements.namedItem("current_password") as HTMLInputElement | null)?.value ?? ""
    const newPassword = (form.elements.namedItem("new_password") as HTMLInputElement | null)?.value ?? ""
    const confirmPassword = (form.elements.namedItem("confirm_password") as HTMLInputElement | null)?.value ?? ""
    setError("")
    setNotice("")

    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.")
      return
    }
    if (newPassword.length < 8) {
      setError("The new password must be at least 8 characters long.")
      return
    }

    setWorking(true)
    try {
      const result = await apiRequest<{ success: boolean; detail: string }>(
        "/auth/password/change/",
        {
          method: "POST",
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
            confirm_password: confirmPassword,
          }),
        },
      )
      setNotice(result.detail || "Your password was updated.")
      form.reset()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The password could not be changed.")
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="settings-workspace" id="settings">
      <section className="settings-section" aria-labelledby="settings-account">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ACCOUNT</p>
            <h2 id="settings-account">Account settings</h2>
          </div>
          <span className={`status-pill status-${user.is_active ? "active" : "suspended"}`}>
            {user.is_active ? "Active" : "Suspended"}
          </span>
        </div>
        <ul className="settings-list">
          <li>
            <span>
              <strong>Name</strong>
              <small>{`${user.first_name} ${user.last_name}`.trim() || user.username}</small>
            </span>
            <a className="text-button" href="#driver-application">Open profile</a>
          </li>
          <li>
            <span>
              <strong>Email</strong>
              <small>{user.email || "Not provided"}</small>
            </span>
            <span className="field-hint">Managed by Marketplace</span>
          </li>
          <li>
            <span>
              <strong>Phone</strong>
              <small>{phone || "Not provided"}</small>
            </span>
            <a className="text-button" href="#driver-application">Edit in profile</a>
          </li>
          <li>
            <span>
              <strong>Preferred language</strong>
              <small>{languageLabel}</small>
            </span>
            <a className="text-button" href="#driver-application">Edit in profile</a>
          </li>
        </ul>
      </section>

      <section className="settings-section" aria-labelledby="settings-security">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SECURITY</p>
            <h2 id="settings-security">Change password</h2>
          </div>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <p className="panel-description">
          Your password is stored by GreenPath Marketplace. DriverApp forwards the change
          over your verified Marketplace session and never stores the password locally.
        </p>
        <form className="profile-form" onSubmit={handlePasswordChange}>
          <div className="form-grid">
            <PasswordInput
              name="current_password"
              label="Current password"
              autoComplete="current-password"
            />
            <PasswordInput
              name="new_password"
              label="New password"
              autoComplete="new-password"
              minLength={8}
            />
            <PasswordInput
              name="confirm_password"
              label="Confirm new password"
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          {notice && <p className="feedback feedback-success" role="status">{notice}</p>}
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={working}>
              {working ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-section" aria-labelledby="settings-payouts">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PAYOUTS</p>
            <h2 id="settings-payouts">Bank accounts</h2>
          </div>
          <Landmark size={18} aria-hidden="true" />
        </div>
        <p className="panel-description">
          Manage the bank accounts that can receive your approved driver withdrawals. Accounts
          are masked and reviewed by the Marketplace finance team.
        </p>
        <div className="form-actions">
          <a className="button button-primary" href="#bank-accounts">
            <Landmark size={14} aria-hidden="true" /> Manage bank accounts
          </a>
          <a className="button button-secondary" href="#financial-summary">
            Open wallet
          </a>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-session">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SESSION</p>
            <h2 id="settings-session">Session and sign out</h2>
          </div>
        </div>
        <p className="panel-description">
          Availability changes do not end this session. Sign out when you finish using a
          shared device.
        </p>
        <div className="form-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
          >
            <LogOut size={14} aria-hidden="true" />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </section>
    </div>
  )
}
