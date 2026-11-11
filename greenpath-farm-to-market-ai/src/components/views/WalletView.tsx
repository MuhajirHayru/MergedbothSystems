import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/apiClient';
import {
  DollarSign,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  ShieldCheck,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  CreditCard,
  Smartphone,
  ExternalLink,
  X,
} from 'lucide-react';

export const WalletView: React.FC = () => {
  const { currentUser, setNotification } = useApp();
  const [wallet, setWallet] = useState<any>({ availableBalanceETB: 0, heldBalanceETB: 0, totalVolumeETB: 0, transactions: [] });
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wRes, txRes, payoutRes, bankRes] = await Promise.all([
          api.wallet.summary(),
          api.wallet.transactions(),
          api.wallet.payouts(),
          api.wallet.bankAccounts(),
        ]);
        if (cancelled) return;
        const w = wRes?.data ?? {};
        setWallet({
          availableBalanceETB: Number(w.available_balance ?? w.availableBalanceETB ?? 0),
          heldBalanceETB: Number(w.held_balance ?? w.heldBalanceETB ?? 0),
          totalVolumeETB: Number(w.incoming_total ?? w.totalVolumeETB ?? 0),
          transactions: (Array.isArray(txRes?.data?.results) ? txRes.data.results : Array.isArray(txRes?.data) ? txRes.data : []).map((tx: any) => ({
            id: tx.id,
            date: tx.created_at ? new Date(tx.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
            reference: tx.reference ?? tx.external_reference ?? '—',
            type: String(tx.transaction_type ?? '').toLowerCase(),
            amountETB: Number(tx.amount ?? 0),
            direction: Number(tx.available_delta ?? 0) < 0 || Number(tx.held_delta ?? 0) < 0 ? 'out' : 'in',
            counterparty: tx.order_reference ? `Order ${tx.order_reference}` : 'Wallet operation',
            description: tx.description ?? '',
            status: 'posted',
          })),
          payouts: Array.isArray(payoutRes?.data?.results) ? payoutRes.data.results : Array.isArray(payoutRes?.data) ? payoutRes.data : [],
        });
        setBankAccounts(Array.isArray(bankRes?.data?.results) ? bankRes.data.results : Array.isArray(bankRes?.data) ? bankRes.data : []);
      } catch (e: any) {
        setNotification?.(e?.response?.data?.error || 'Failed to load wallet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, reloadKey]);

  useEffect(() => {
    const fundingId = new URLSearchParams(window.location.search).get('funding');
    if (!fundingId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.wallet.verifyFunding(fundingId);
        const status = result?.data?.status;
        if (!cancelled) {
          setNotification?.(
            status === 'AWAITING_APPROVAL'
              ? 'Chapa payment verified. A Financial Manager must approve it before funds are credited.'
              : `Chapa payment status: ${status || 'pending'}.`
          );
        }
      } catch (err: any) {
        if (!cancelled) {
          setNotification?.(err?.response?.data?.error || 'Could not verify the Chapa payment.');
        }
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('funding');
        window.history.replaceState({}, '', url.toString());
        if (!cancelled) setReloadKey((value) => value + 1);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);

  // Deposit Form
  const [depositAmount, setDepositAmount] = useState<number>(50000);
  const [depositMethod, setDepositMethod] = useState<'Chapa' | 'Telebirr' | 'CBE Birr' | 'Bank Transfer'>('Chapa');

  // Payout Form
  const [payoutAmount, setPayoutAmount] = useState<number>(25000);
  const [selectedBankId, setSelectedBankId] = useState<string>(bankAccounts[0]?.id || '');
  // One idempotency key per payout intent. It survives a failed/uncertain
  // request (safe retry) and is replaced when amount or destination changes.
  const payoutIntentRef = useRef<{
    amount: number;
    bankId: string;
    key: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedBankId && bankAccounts[0]) setSelectedBankId(bankAccounts[0].id);
  }, [bankAccounts, selectedBankId]);

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAmount || depositAmount <= 0) return;
    try {
      const result = await api.wallet.chapaInitialize({
        amount: depositAmount,
        method: depositMethod,
      });
      const checkoutUrl = result?.data?.checkout_url;
      if (!checkoutUrl) throw new Error('Chapa did not return a checkout URL.');
      setShowDepositModal(false);
      window.location.assign(checkoutUrl);
    } catch (err: any) {
      setNotification?.(err?.response?.data?.error || 'Deposit failed');
    }
  };

  const handlePayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutAmount || payoutAmount <= 0) return;
    const targetBank = bankAccounts.find((b) => b.id === selectedBankId) || bankAccounts[0];
    if (targetBank) {
      const currentIntent = payoutIntentRef.current;
      const key =
        currentIntent &&
        currentIntent.amount === payoutAmount &&
        currentIntent.bankId === targetBank.id
          ? currentIntent.key
          : crypto.randomUUID();
      payoutIntentRef.current = { amount: payoutAmount, bankId: targetBank.id, key };
      try {
        await api.wallet.createPayout({
          amount: payoutAmount,
          payout_account: targetBank.id,
          destination: `${targetBank.bank_name || targetBank.bankName} ${targetBank.masked_account_number || targetBank.maskedAccountNumber}`,
        }, key);
        payoutIntentRef.current = null;
        setNotification?.('Payout requested. It will be reviewed by a Financial Manager.');
        setShowPayoutModal(false);
        setReloadKey((value) => value + 1);
      } catch (err: any) {
        setNotification?.(err?.response?.data?.error || 'Payout failed');
      }
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>Chapa Financial Multi-Rail · Escrow Vault</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Wallet & Financial Settlements
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time balance breakdown in Ethiopian Birr (ETB), instant Chapa top-up, and escrow holdings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPayoutModal(true)}
            className="px-4 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-lg transition-colors"
          >
            Withdraw
          </button>
          <button
            onClick={() => setShowDepositModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Deposit</span>
          </button>
        </div>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Available Balance */}
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Available Trading Balance</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700 dark:text-emerald-400">
            {wallet.availableBalanceETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400">
            Liquid funds available for new purchase escrow orders
          </div>
        </div>

        {/* Held in Escrow */}
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Held in Platform Escrow</span>
            <Lock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-amber-600 dark:text-amber-400">
            {wallet.heldBalanceETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400">
            Locked pending cargo delivery & quality confirmation
          </div>
        </div>

        {/* Total Volume */}
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Cumulative Settlement Volume</span>
            <ArrowUpRight className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 dark:text-slate-100">
            {wallet.totalVolumeETB.toLocaleString()} ETB
          </div>
          <div className="text-[11px] text-slate-400">
            Total lifetime trading executed on GreenPath
          </div>
        </div>
      </div>

      {/* Transaction History Table */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
          Financial Ledger Records (ETB)
        </h3>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 font-semibold">
                <th className="py-3 px-3">Date</th>
                <th className="py-3 px-3">Reference</th>
                <th className="py-3 px-2">Type</th>
                <th className="py-3 px-3 text-right">Amount (ETB)</th>
                <th className="py-3 px-3">Counterparty / Description</th>
                <th className="py-3 px-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {wallet.transactions.map((tx: any) => (
                <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="py-3 px-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                    {tx.date}
                  </td>
                  <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                    {tx.reference}
                  </td>
                  <td className="py-3 px-2 capitalize">
                    <span className="px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]">
                      {String(tx.type ?? '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                    {tx.amountETB.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                    <div className="font-medium">{tx.counterparty}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-xs">{tx.description}</div>
                  </td>
                  <td className="py-3 px-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 capitalize">
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deposit Modal (Chapa Multi-rail) */}
      {showDepositModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-600" />
                <span>Fund Wallet (Chapa Gateway)</span>
              </h3>
              <button onClick={() => setShowDepositModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleDepositSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Deposit Amount (ETB)</label>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-sm"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Payment Rail</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'Chapa' as const, label: 'Chapa Multi-Rail', note: 'Instant' },
                    { id: 'Telebirr' as const, label: 'Telebirr SuperApp', note: 'Fast' },
                    { id: 'CBE Birr' as const, label: 'CBE Birr', note: 'CBE direct' },
                    { id: 'Bank Transfer' as const, label: 'Bank Wire Slip', note: 'Manual verification' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setDepositMethod(m.id)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        depositMethod === m.id
                          ? 'border-[#15803D] bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-[#15803D]'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-200">{m.label}</div>
                      <div className="text-[10px] text-slate-400">{m.note}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Proceed to Secure Checkout
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payout Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                <span>Request Commercial Bank Payout</span>
              </h3>
              <button onClick={() => setShowPayoutModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePayoutSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold mb-1">Payout Amount (ETB)</label>
                <input
                  type="number"
                  min={500}
                  max={wallet.availableBalanceETB}
                  value={payoutAmount}
                  onChange={(e) => setPayoutAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono font-bold text-sm"
                />
                <span className="text-[10px] text-slate-400">
                  Max available: {wallet.availableBalanceETB.toLocaleString()} ETB
                </span>
              </div>

              <div>
                <label className="block font-semibold mb-1">Target Verified Bank Account</label>
                <select
                  value={selectedBankId}
                  onChange={(e) => setSelectedBankId(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name || b.bankName} - {b.masked_account_number || b.maskedAccountNumber} ({b.account_holder_name || b.accountHolderName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  Withdraw
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
