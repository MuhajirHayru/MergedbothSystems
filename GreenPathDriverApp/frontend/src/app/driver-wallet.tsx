"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowDownLeft,
  ArrowUpFromLine,
  Banknote,
  Clock3,
  History,
  Landmark,
  RefreshCw,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react"

import {
  loadBankAccounts,
  loadDriverWallet,
  requestPayout,
  type BankAccount,
  type DriverWalletResponse,
  type WalletPayout,
  type WalletTransaction,
} from "@/lib/driver-features"
import { ConfirmationDialog } from "./ui"

const CREDIT_TYPES = new Set([
  "FUNDING",
  "ESCROW_RELEASE",
  "RESERVATION_RELEASE",
  "DELIVERY_FEE_EARNING",
  "REFUND",
])

function readable(value?: string) {
  return (value ?? "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function money(value: string | number, currency = "ETB") {
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} ${currency}`
  return `${number.toLocaleString("en-ET", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

function dateLabel(value?: string) {
  if (!value) return "Not recorded"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not recorded"
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function typeTone(type?: string) {
  if (!type) return "neutral"
  return CREDIT_TYPES.has(type) ? "credit" : "debit"
}

function payoutTone(status: string) {
  const value = status.toLowerCase()
  if (value === "paid") return "approved"
  if (value === "rejected") return "rejected"
  return "pending"
}

function transactionLabel(transaction: WalletTransaction) {
  if (transaction.description) return transaction.description
  return readable(transaction.transaction_type) || "Balance activity"
}

export default function DriverWallet() {
  const [wallet, setWallet] = useState<DriverWalletResponse | null>(null)
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const [accountsError, setAccountsError] = useState("")
  const [notice, setNotice] = useState("")
  const [formError, setFormError] = useState("")
  const [working, setWorking] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [accountId, setAccountId] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("all")
  const [dateCutoff, setDateCutoff] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const idempotencyKey = useRef("")
  const amountInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (mode === "refresh") setRefreshing(true)
    try {
      const data = await loadDriverWallet()
      setWallet(data)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your wallet.")
      if (mode === "initial") setWallet(null)
    } finally {
      if (mode === "initial") setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    try {
      const response = await loadBankAccounts()
      const list = Array.isArray(response.results) ? response.results : []
      setAccounts(list)
      setAccountsError("")
      setAccountId((current) => {
        if (current && list.some((account) => account.id === current)) return current
        return list.find((account) => account.is_default)?.id ?? list[0]?.id ?? ""
      })
    } catch (reason) {
      setAccounts([])
      setAccountsError(
        reason instanceof Error ? reason.message : "Could not load your payout accounts.",
      )
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
      void loadAccounts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load, loadAccounts])

  useEffect(() => {
    if (!withdrawOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="alertdialog"]')) {
        setWithdrawOpen(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    const timer = window.setTimeout(() => amountInput.current?.focus(), 30)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.clearTimeout(timer)
    }
  }, [withdrawOpen])

  const currency = wallet?.wallet?.currency ?? wallet?.summary?.currency ?? "ETB"
  const summary = useMemo(() => {
    const source = wallet?.summary
    const available = source?.available_balance ?? wallet?.wallet?.available_balance ?? "0"
    const pending = source?.pending_balance ?? wallet?.wallet?.held_balance ?? "0"
    const earnings =
      source?.total_earnings ??
      wallet?.wallet?.incoming_total ??
      (wallet?.transactions ?? []).reduce(
        (total, transaction) => total + Math.max(0, Number(transaction.amount) || 0),
        0,
      )
    const withdrawn =
      source?.total_withdrawn ??
      (wallet?.payouts ?? [])
        .filter((payout) => payout.status?.toUpperCase() === "PAID")
        .reduce((total, payout) => total + (Number(payout.amount) || 0), 0)
    return {
      available,
      pending,
      withdrawable: source?.withdrawable_balance ?? available,
      earnings,
      withdrawn,
      pendingWithdrawals: source?.pending_withdrawals ?? "0",
      pendingCount:
        source?.pending_withdrawal_count ??
        (wallet?.payouts ?? []).filter((payout) => payout.status?.toUpperCase() === "PENDING")
          .length,
    }
  }, [wallet])

  const withdrawableNumber = Number(summary.withdrawable)
  const amountNumber = Number(amount)
  const selectedAccount = accounts.find((account) => account.id === accountId) ?? null
  const transactionTypes = useMemo(
    () =>
      Array.from(
        new Set(
          (wallet?.transactions ?? [])
            .map((transaction) => transaction.transaction_type)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
    [wallet],
  )
  const filteredTransactions = useMemo(() => {
    const cutoff = dateCutoff
    const term = search.trim().toLowerCase()
    return (wallet?.transactions ?? []).filter((transaction) => {
      if (typeFilter !== "all" && transaction.transaction_type !== typeFilter) return false
      const status = (transaction.status ?? "POSTED").toUpperCase()
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (cutoff !== null) {
        const created = transaction.created_at ? new Date(transaction.created_at).getTime() : 0
        if (!created || created < cutoff) return false
      }
      if (term) {
        const haystack = [
          transaction.reference,
          transaction.description,
          transaction.order_reference,
          transaction.external_reference,
          transaction.transaction_type,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [wallet, typeFilter, statusFilter, dateCutoff, search])
  function openWithdraw() {
    setFormError("")
    setNotice("")
    setWithdrawOpen(true)
    idempotencyKey.current = ""
    void loadAccounts()
  }

  function closeWithdraw() {
    if (working) return
    setWithdrawOpen(false)
    setConfirming(false)
    setAmount("")
    setFormError("")
  }

  function reviewWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")
    setNotice("")
    if (!selectedAccount) {
      setFormError("Add a payout bank account before requesting a withdrawal.")
      return
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setFormError("Enter a withdrawal amount greater than zero.")
      return
    }
    if (Number.isFinite(withdrawableNumber) && amountNumber > withdrawableNumber) {
      setFormError(`You can withdraw at most ${money(summary.withdrawable, currency)}.`)
      return
    }
    if (!idempotencyKey.current) {
      idempotencyKey.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `withdrawal-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }
    setConfirming(true)
  }

  async function submitWithdrawal() {
    if (!selectedAccount || working) return
    setWorking(true)
    setFormError("")
    setNotice("")
    try {
      const created = await requestPayout(
        amountNumber.toFixed(2),
        `${selectedAccount.bank_name} ${selectedAccount.masked_account_number}`,
        { payoutAccount: selectedAccount.id, idempotencyKey: idempotencyKey.current },
      )
      const reference =
        created.external_reference || String(created.id ?? "").slice(0, 8).toUpperCase()
      setNotice(
        `Withdrawal request ${reference || "submitted"} created with status ${readable(
          created.status,
        )}. The Financial Manager reviews every payout before money moves.`,
      )
      setAmount("")
      setConfirming(false)
      setWithdrawOpen(false)
      idempotencyKey.current = ""
      await Promise.all([load("refresh"), loadAccounts()])
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Payout request could not be submitted.",
      )
    } finally {
      setWorking(false)
    }
  }

  if (loading) {
    return (
      <section className="work-panel wallet-panel" id="financial-summary" aria-busy="true">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PAYMENTS</p>
            <h2>Earnings and payouts</h2>
          </div>
        </div>
        <div className="wallet-summary-grid" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="wallet-summary-card wallet-summary-skeleton" key={index}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
        <p className="panel-description" role="status">
          Loading your earnings and payouts…
        </p>
      </section>
    )
  }

  if (!wallet) {
    return (
      <section className="work-panel wallet-panel" id="financial-summary" aria-labelledby="wallet-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PAYMENTS</p>
            <h2 id="wallet-heading">Earnings and payouts</h2>
          </div>
          <span className="status-pill status-rejected">Unavailable</span>
        </div>
        <p className="feedback feedback-error" role="alert">
          {error || "Your wallet could not be loaded."}
        </p>
        <button className="button button-primary" type="button" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </section>
    )
  }

  if (!wallet.linked) {
    return (
      <section
        className="work-panel wallet-panel"
        id="financial-summary"
        aria-labelledby="wallet-heading"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">PAYMENTS</p>
            <h2 id="wallet-heading">Earnings and payouts</h2>
          </div>
          <span className="status-pill status-pending">Unlinked</span>
        </div>
        <p className="panel-description">
          {wallet.detail ||
            "Open DriverApp from your Marketplace driver account to see your earnings and payout status."}
        </p>
      </section>
    )
  }

  return (
    <section
      className="work-panel wallet-panel"
      id="financial-summary"
      aria-labelledby="wallet-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">PAYMENTS</p>
          <h2 id="wallet-heading">Earnings and payouts</h2>
        </div>
        <span className="status-pill status-approved">Marketplace linked</span>
      </div>
      <p className="panel-description">
        Every balance and withdrawal decision comes from the GreenPath Marketplace wallet.
        DriverApp never keeps a second ledger or moves money itself.
      </p>

      <div className="wallet-summary-grid">
        <article className="wallet-summary-card wallet-summary-available">
          <span className="stat-card-label">
            <WalletCards size={14} aria-hidden="true" /> Available balance
          </span>
          <strong className="wallet-summary-value">{money(summary.available, currency)}</strong>
          <small>Cleared funds ready for a payout request</small>
        </article>
        <article className="wallet-summary-card wallet-summary-pending">
          <span className="stat-card-label">
            <Clock3 size={14} aria-hidden="true" /> Pending balance
          </span>
          <strong className="wallet-summary-value">{money(summary.pending, currency)}</strong>
          <small>
            {summary.pendingCount > 0
              ? `${summary.pendingCount} withdrawal request${
                  summary.pendingCount === 1 ? "" : "s"
                } awaiting review`
              : "Held while a payout is under review"}
          </small>
        </article>
        <article className="wallet-summary-card wallet-summary-withdrawable">
          <span className="stat-card-label">
            <ArrowDownLeft size={14} aria-hidden="true" /> Withdrawable balance
          </span>
          <strong className="wallet-summary-value">
            {money(summary.withdrawable, currency)}
          </strong>
          <small>Maximum amount you can request now</small>
        </article>
        <article className="wallet-summary-card wallet-summary-earnings">
          <span className="stat-card-label">
            <TrendingUp size={14} aria-hidden="true" /> Total earnings
          </span>
          <strong className="wallet-summary-value">{money(summary.earnings, currency)}</strong>
          <small>Delivery fees credited to this wallet</small>
        </article>
        <article className="wallet-summary-card wallet-summary-withdrawn">
          <span className="stat-card-label">
            <ArrowUpFromLine size={14} aria-hidden="true" /> Total withdrawn
          </span>
          <strong className="wallet-summary-value">{money(summary.withdrawn, currency)}</strong>
          <small>Payouts marked paid by the Financial Manager</small>
        </article>
      </div>

      <div className="wallet-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={openWithdraw}
          disabled={refreshing}
        >
          <ArrowDownLeft size={15} aria-hidden="true" /> Withdraw funds
        </button>
        <a className="button button-secondary" href="#bank-accounts">
          <Landmark size={15} aria-hidden="true" /> Manage bank accounts
        </a>
        <a className="button button-secondary" href="#wallet-transactions">
          <History size={15} aria-hidden="true" /> Transaction history
        </a>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void Promise.all([load("refresh"), loadAccounts()])}
          disabled={refreshing}
        >
          <RefreshCw
            size={15}
            aria-hidden="true"
            className={refreshing ? "wallet-spin" : undefined}
          />
          {refreshing ? "Refreshing…" : "Refresh balance"}
        </button>
      </div>

      {notice && (
        <p className="feedback feedback-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="feedback feedback-error" role="alert">
          {error}{" "}
          <button className="text-button" type="button" onClick={() => void load("refresh")}>
            Retry
          </button>
        </p>
      )}

      <section className="wallet-block" id="wallet-transactions" aria-labelledby="wallet-transactions-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TRANSACTIONS</p>
            <h3 id="wallet-transactions-heading">
              Balance activity
              <span className="wallet-count">{wallet.transactions.length}</span>
            </h3>
          </div>
        </div>

        <div className="wallet-filters">
          <label className="form-field">
            Search
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Reference, order, description"
            />
          </label>
          <label className="form-field">
            Type
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All types</option>
              {transactionTypes.map((type) => (
                <option key={type} value={type}>
                  {readable(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Status
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="POSTED">Posted</option>
            </select>
          </label>
          <label className="form-field">
            Date
            <select
              value={dateFilter}
              onChange={(event) => {
                const value = event.target.value
                setDateFilter(value)
                setDateCutoff(
                  value === "all"
                    ? null
                    : Date.now() - Number(value) * 24 * 60 * 60 * 1000,
                )
              }}
            >
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </label>
        </div>

        {wallet.transactions.length === 0 ? (
          <p className="document-empty">
            No wallet activity yet. Delivery fee earnings and withdrawals will appear here.
          </p>
        ) : filteredTransactions.length === 0 ? (
          <div className="wallet-empty">
            <p className="document-empty">No transactions match these filters.</p>
            <button
              className="button button-secondary button-small"
              type="button"
              onClick={() => {
                setTypeFilter("all")
                setStatusFilter("all")
                setDateFilter("all")
                setDateCutoff(null)
                setSearch("")
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="wallet-table-scroll">
            <table className="wallet-table">
              <caption className="sr-only">Wallet transactions</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Description</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="wallet-table-number">
                    Amount
                  </th>
                  <th scope="col">Date</th>
                  <th scope="col">Order</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((transaction, index) => {
                  const delta = Number(transaction.available_delta ?? 0)
                  const signedAmount =
                    delta === 0
                      ? money(transaction.amount, currency)
                      : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), currency)}`
                  return (
                    <tr
                      key={transaction.id ?? transaction.reference ?? index}
                      className={`wallet-row-${typeTone(transaction.transaction_type)}`}
                    >
                      <td className="wallet-reference">
                        {transaction.reference || "—"}
                      </td>
                      <td>
                        <strong>{transactionLabel(transaction)}</strong>
                      </td>
                      <td>
                        <span
                          className={`wallet-type wallet-type-${typeTone(
                            transaction.transaction_type,
                          )}`}
                        >
                          {readable(transaction.transaction_type) || "Activity"}
                        </span>
                      </td>
                      <td
                        className={`wallet-table-number wallet-amount wallet-amount-${typeTone(
                          transaction.transaction_type,
                        )}`}
                      >
                        {signedAmount}
                      </td>
                      <td>{dateLabel(transaction.created_at)}</td>
                      <td>{transaction.order_reference || "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="wallet-block" id="wallet-payouts" aria-labelledby="wallet-payouts-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">WITHDRAWALS</p>
            <h3 id="wallet-payouts-heading">
              Withdrawal history
              <span className="wallet-count">{wallet.payouts.length}</span>
            </h3>
          </div>
        </div>
        {wallet.payouts.length === 0 ? (
          <p className="document-empty">No withdrawal requests yet.</p>
        ) : (
          <div className="wallet-table-scroll">
            <table className="wallet-table">
              <caption className="sr-only">Withdrawal history</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col" className="wallet-table-number">
                    Amount
                  </th>
                  <th scope="col">Destination</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Review note</th>
                </tr>
              </thead>
              <tbody>
                {wallet.payouts.map((payout: WalletPayout, index) => (
                  <tr key={payout.id ?? `${payout.destination}-${index}`}>
                    <td className="wallet-reference">
                      {payout.external_reference ||
                        (payout.id
                          ? `PAYOUT-${String(payout.id).slice(0, 8).toUpperCase()}`
                          : "—")}
                    </td>
                    <td className="wallet-table-number wallet-amount">
                      {money(payout.amount, payout.currency ?? currency)}
                    </td>
                    <td>
                      <span className="wallet-destination">
                        <Banknote size={13} aria-hidden="true" />
                        {payout.payout_account_bank
                          ? `${payout.payout_account_bank} ${
                              payout.payout_account_masked ?? ""
                            }`
                          : payout.destination}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${payoutTone(payout.status)}`}>
                        {readable(payout.status)}
                      </span>
                    </td>
                    <td>{dateLabel(payout.submitted_at)}</td>
                    <td>{payout.review_notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {withdrawOpen && (
        <div
          className="dialog-backdrop wallet-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeWithdraw()
          }}
        >
          <section
            className="wallet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-heading"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">WITHDRAWAL</p>
                <h2 id="withdraw-heading">Request a withdrawal</h2>
              </div>
              <button
                className="button button-secondary button-small"
                type="button"
                onClick={closeWithdraw}
                disabled={working}
                aria-label="Close withdrawal form"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            {accounts.length === 0 ? (
              <div className="wallet-dialog-empty">
                <Landmark size={26} aria-hidden="true" />
                <h3>Add a payout account first</h3>
                <p className="panel-description">
                  Withdrawals need a registered bank account. Your account stays unverified until
                  the Marketplace finance team reviews it.
                </p>
                {accountsError && (
                  <p className="feedback feedback-error" role="alert">
                    {accountsError}
                  </p>
                )}
                <div className="form-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => void loadAccounts()}
                  >
                    <RefreshCw size={14} aria-hidden="true" /> Check again
                  </button>
                  <a
                    className="button button-primary"
                    href="#bank-accounts"
                    onClick={closeWithdraw}
                  >
                    <Landmark size={14} aria-hidden="true" /> Manage bank accounts
                  </a>
                </div>
              </div>
            ) : (
              <form className="wallet-withdraw-form" onSubmit={reviewWithdrawal}>
                <div className="wallet-withdraw-summary">
                  <span>
                    <small>Withdrawable</small>
                    <strong>{money(summary.withdrawable, currency)}</strong>
                  </span>
                  <span>
                    <small>Pending review</small>
                    <strong>{money(summary.pending, currency)}</strong>
                  </span>
                  <span>
                    <small>Withdrawal fee</small>
                    <strong>{money(0, currency)}</strong>
                  </span>
                  <span>
                    <small>You receive</small>
                    <strong>
                      {money(Number.isFinite(amountNumber) ? Math.max(0, amountNumber) : 0, currency)}
                    </strong>
                  </span>
                </div>

                <label className="form-field">
                  Payout account
                  <select
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value)
                      idempotencyKey.current = ""
                      setFormError("")
                    }}
                    required
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bank_name} · {account.masked_account_number}
                        {account.is_default ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-hint">
                  {selectedAccount
                    ? `${selectedAccount.account_holder_name} · ${readable(
                        selectedAccount.status,
                      )}. Review status does not block a request; the Financial Manager verifies it before paying.`
                    : "Select the account that should receive this payout."}
                </p>

                <label className="form-field">
                  Amount ({currency})
                  <input
                    ref={amountInput}
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={Number.isFinite(withdrawableNumber) ? summary.withdrawable : undefined}
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value)
                      idempotencyKey.current = ""
                      setFormError("")
                    }}
                    placeholder="0.00"
                    required
                  />
                </label>
                <button
                  className="button button-secondary button-small wallet-max-button"
                  type="button"
                  onClick={() => {
                    setAmount(Number.isFinite(withdrawableNumber) ? withdrawableNumber.toFixed(2) : "")
                    idempotencyKey.current = ""
                  }}
                  disabled={!Number.isFinite(withdrawableNumber) || withdrawableNumber <= 0}
                >
                  Use full withdrawable balance
                </button>

                <p className="panel-description">
                  The Marketplace reserves this amount from your available balance, then the
                  Financial Manager approves or rejects the payout. Rejected requests return the
                  held amount to your available balance.
                </p>

                {formError && (
                  <p className="feedback feedback-error" role="alert">
                    {formError}
                  </p>
                )}

                <div className="form-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={closeWithdraw}
                    disabled={working}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={working || amountNumber <= 0}
                  >
                    Review withdrawal
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

      <ConfirmationDialog
        open={confirming}
        title="Submit withdrawal request?"
        description={
          selectedAccount
            ? `${money(amountNumber || 0, currency)} will be requested to ${
                selectedAccount.bank_name
              } ${selectedAccount.masked_account_number}. Fee: ${money(
                0,
                currency,
              )}. The Marketplace holds the amount until the Financial Manager approves or rejects the request.`
            : ""
        }
        confirmLabel="Submit request"
        busy={working}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void submitWithdrawal()}
      />
    </section>
  )
}
