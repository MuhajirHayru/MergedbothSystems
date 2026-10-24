"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Building2, CheckCircle2, Landmark, Pencil, Plus, Star, Trash2 } from "lucide-react"

import {
  createBankAccount,
  deleteBankAccount,
  loadBankAccounts,
  loadPayoutBanks,
  updateBankAccount,
  type BankAccount,
  type PayoutBank,
} from "@/lib/driver-features"
import { ConfirmationDialog } from "./ui"

type FormState = {
  bank: string
  account_holder_name: string
  account_number: string
  confirm_account_number: string
  branch: string
  branch_code: string
  account_type: string
  nickname: string
  is_default: boolean
}

const EMPTY_FORM: FormState = {
  bank: "",
  account_holder_name: "",
  account_number: "",
  confirm_account_number: "",
  branch: "",
  branch_code: "",
  account_type: "Savings",
  nickname: "",
  is_default: false,
}

function statusLabel(status: string) {
  if (status === "REQUIRES_REVIEW") return "Requires review"
  if (status === "NOT_VERIFIED") return "Not verified"
  return status.replaceAll("_", " ").toLowerCase()
}

export default function DriverBankAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [banks, setBanks] = useState<PayoutBank[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [linked, setLinked] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [pendingDelete, setPendingDelete] = useState<BankAccount | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [accountResponse, bankResponse] = await Promise.all([
        loadBankAccounts(),
        loadPayoutBanks(),
      ])
      setAccounts(Array.isArray(accountResponse.results) ? accountResponse.results : [])
      setLinked(accountResponse.linked !== false)
      setBanks(Array.isArray(bankResponse.results) ? bankResponse.results : [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your payout accounts.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, bank: banks[0]?.id ? String(banks[0].id) : "" })
    setError("")
    setNotice("")
    setFormOpen(true)
  }

  function openEdit(account: BankAccount) {
    setEditing(account)
    setForm({
      bank: String(account.bank),
      account_holder_name: account.account_holder_name,
      account_number: "",
      confirm_account_number: "",
      branch: account.branch ?? "",
      branch_code: account.branch_code ?? "",
      account_type: account.account_type ?? "Savings",
      nickname: account.nickname ?? "",
      is_default: account.is_default,
    })
    setError("")
    setNotice("")
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError("")
    setNotice("")
    const number = form.account_number.trim()
    const confirmation = form.confirm_account_number.trim()
    if (!editing && (!number || !confirmation)) {
      setError("Enter and confirm the account number.")
      setWorking(false)
      return
    }
    if (number !== confirmation) {
      setError("The account numbers do not match.")
      setWorking(false)
      return
    }
    const payload = {
      bank: Number(form.bank),
      account_holder_name: form.account_holder_name.trim(),
      branch: form.branch.trim(),
      branch_code: form.branch_code.trim(),
      account_type: form.account_type.trim(),
      nickname: form.nickname.trim(),
      is_default: form.is_default,
      ...(number ? { account_number: number, confirm_account_number: confirmation } : {}),
    }
    try {
      if (editing) {
        await updateBankAccount(editing.id, payload)
        setNotice("Payout account updated.")
      } else {
        await createBankAccount(payload)
        setNotice("Payout account added.")
      }
      closeForm()
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The payout account could not be saved.")
    } finally {
      setWorking(false)
    }
  }

  async function makeDefault(account: BankAccount) {
    if (working) return
    setWorking(true)
    setError("")
    setNotice("")
    try {
      await updateBankAccount(account.id, { is_default: true })
      setNotice("Default payout account updated.")
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The default account could not be changed.")
    } finally {
      setWorking(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setWorking(true)
    setError("")
    setNotice("")
    try {
      await deleteBankAccount(pendingDelete.id)
      setNotice("Payout account removed.")
      setPendingDelete(null)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The payout account could not be removed.")
      setPendingDelete(null)
    } finally {
      setWorking(false)
    }
  }

  const defaultAccount = accounts.find((account) => account.is_default) ?? accounts[0] ?? null
  const needsReview = accounts.filter((account) => account.status === "REQUIRES_REVIEW").length

  return (
    <section
      className="settings-section bank-accounts-page"
      id="bank-accounts"
      aria-labelledby="bank-accounts-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">PAYOUTS</p>
          <h2 id="bank-accounts-heading">Bank accounts</h2>
        </div>
        <button
          className="button button-primary button-small"
          type="button"
          onClick={openAdd}
          disabled={loading || working || !linked || banks.length === 0}
        >
          <Plus size={13} aria-hidden="true" /> Add account
        </button>
      </div>
      <p className="panel-description">
        Register where approved withdrawals should be paid. Account numbers are encrypted by the
        Marketplace; DriverApp only receives the masked number. Adding an account does not verify
        it or move money.
      </p>

      {!loading && accounts.length > 0 && (
        <div className="bank-accounts-overview">
          <span>
            <small>Registered</small>
            <strong>{accounts.length}</strong>
          </span>
          <span>
            <small>Default payout account</small>
            <strong>{defaultAccount ? defaultAccount.bank_name : "Not set"}</strong>
          </span>
          <span>
            <small>Needs further review</small>
            <strong>{needsReview}</strong>
          </span>
          <a className="button button-secondary button-small" href="#financial-summary">
            <Landmark size={13} aria-hidden="true" /> Back to wallet
          </a>
        </div>
      )}

      {!linked && (
        <p className="feedback feedback-warning" role="status">
          Payout accounts are available after opening DriverApp from your Marketplace driver
          account.
        </p>
      )}
      {loading && <p className="panel-description" role="status">Loading payout accounts…</p>}
      {error && <p className="feedback feedback-error" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

      {!loading && accounts.length === 0 && linked && (
        <div className="bank-accounts-empty">
          <span className="bank-account-icon" aria-hidden="true">
            <Landmark size={20} />
          </span>
          <div>
            <strong>No payout account registered yet</strong>
            <p className="panel-description">
              Add a bank account so you can request withdrawals from your wallet.
            </p>
          </div>
          <button
            className="button button-primary button-small"
            type="button"
            onClick={openAdd}
            disabled={working || banks.length === 0}
          >
            <Plus size={13} aria-hidden="true" /> Add your first account
          </button>
        </div>
      )}

      {accounts.length > 0 && (
        <ul className="bank-account-list">
          {accounts.map((account) => (
            <li key={account.id} className="bank-account-item">
              <span className="bank-account-icon" aria-hidden="true">
                <Building2 size={18} />
              </span>
              <div className="bank-account-copy">
                <strong>
                  {account.bank_name}
                  {account.is_default && (
                    <span className="status-pill status-approved">
                      <Star size={10} aria-hidden="true" /> Default
                    </span>
                  )}
                </strong>
                <span className="bank-account-number">{account.masked_account_number}</span>
                <small>
                  {account.account_holder_name}
                  {account.branch ? ` · ${account.branch}` : ""}
                  {account.account_type ? ` · ${account.account_type}` : ""}
                </small>
              </div>
              <span
                className={`status-pill status-${
                  account.status === "REQUIRES_REVIEW" ? "warning" : "pending"
                }`}
              >
                {statusLabel(account.status)}
              </span>
              <div className="bank-account-actions">
                {!account.is_default && (
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    onClick={() => void makeDefault(account)}
                    disabled={working}
                  >
                    Set default
                  </button>
                )}
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => openEdit(account)}
                  disabled={working}
                >
                  <Pencil size={12} aria-hidden="true" /> Edit
                </button>
                <button
                  className="button button-warning button-small"
                  type="button"
                  onClick={() => setPendingDelete(account)}
                  disabled={working}
                >
                  <Trash2 size={12} aria-hidden="true" /> Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <form className="bank-account-form" onSubmit={handleSubmit}>
          <div className="section-heading">
            <div>
              <p className="eyebrow">{editing ? "EDIT ACCOUNT" : "NEW ACCOUNT"}</p>
              <h3>{editing ? "Update payout account" : "Register payout account"}</h3>
            </div>
            <button className="button button-secondary button-small" type="button" onClick={closeForm} disabled={working}>
              Cancel
            </button>
          </div>
          <div className="form-grid">
            <label className="form-field">
              Bank
              <select
                value={form.bank}
                onChange={(event) => setForm((current) => ({ ...current, bank: event.target.value }))}
                required
              >
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>{bank.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Account holder name
              <input
                value={form.account_holder_name}
                onChange={(event) => setForm((current) => ({ ...current, account_holder_name: event.target.value }))}
                required
                maxLength={255}
              />
            </label>
            <label className="form-field">
              Account number {editing ? "(leave blank to keep current)" : ""}
              <input
                value={form.account_number}
                onChange={(event) => setForm((current) => ({ ...current, account_number: event.target.value }))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={64}
                required={!editing}
              />
            </label>
            <label className="form-field">
              Confirm account number
              <input
                value={form.confirm_account_number}
                onChange={(event) => setForm((current) => ({ ...current, confirm_account_number: event.target.value }))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={64}
                required={!editing}
              />
            </label>
            <label className="form-field">
              Branch
              <input
                value={form.branch}
                onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
                maxLength={120}
              />
            </label>
            <label className="form-field">
              Account type
              <select
                value={form.account_type}
                onChange={(event) => setForm((current) => ({ ...current, account_type: event.target.value }))}
              >
                <option value="Savings">Savings</option>
                <option value="Current">Current</option>
                <option value="Mobile wallet">Mobile wallet</option>
              </select>
            </label>
            <label className="form-field">
              Nickname (optional)
              <input
                value={form.nickname}
                onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))}
                maxLength={80}
              />
            </label>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))}
            />
            Use this as my default withdrawal account
          </label>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="button button-secondary" type="button" onClick={closeForm} disabled={working}>
              Cancel
            </button>
            <button className="button button-primary" type="submit" disabled={working}>
              {working ? "Saving…" : editing ? "Save changes" : "Register account"}
            </button>
          </div>
        </form>
      )}

      <p className="field-hint">
        <CheckCircle2 size={13} aria-hidden="true" /> Bank verification is performed by the
        Marketplace finance team. Accounts remain <strong>not verified</strong> until that review
        happens.
      </p>

      <ConfirmationDialog
        open={pendingDelete !== null}
        title="Remove payout account?"
        description="This account will no longer be available for withdrawal requests. A payout under review locks its account until the review finishes."
        confirmLabel="Remove account"
        destructive
        busy={working}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
