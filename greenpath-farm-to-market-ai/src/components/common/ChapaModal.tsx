import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { X, CheckCircle2, ShieldCheck, ArrowRight } from 'lucide-react';

interface ChapaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChapaModal: React.FC<ChapaModalProps> = ({ isOpen, onClose }) => {
  const { depositViaChapa, currentUser } = useApp();

  const [amountETB, setAmountETB] = useState<number>(50000);
  const [method, setMethod] = useState<'Telebirr' | 'CBE Birr' | 'Chapa' | 'Bank Transfer'>('Telebirr');
  const [phoneNumber, setPhoneNumber] = useState<string>(currentUser.phone || '+251 91 142 8820');
  const [step, setStep] = useState<'details' | 'processing' | 'success'>('details');
  const [reference, setReference] = useState<string>('');

  if (!isOpen) return null;

  const handleProceed = (e: React.FormEvent) => {
    e.preventDefault();
    if (amountETB <= 0) return;

    setStep('processing');
    const genRef = `CHP-TX-${Math.floor(100000 + Math.random() * 900000)}`;
    setReference(genRef);

    setTimeout(() => {
      depositViaChapa(amountETB, method, genRef);
      setStep('success');
    }, 1200);
  };

  const handleClose = () => {
    setStep('details');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
        {/* Chapa Brand Header */}
        <div className="bg-emerald-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-emerald-600 flex items-center justify-center font-bold text-xs text-white">
              CP
            </div>
            <div>
              <div className="font-semibold text-sm">Chapa Financial Gateway</div>
              <div className="text-[11px] text-emerald-200">Ethiopian Payment Switch Protocol</div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-emerald-200 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 'details' && (
          <form onSubmit={handleProceed} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Deposit Amount (ETB)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="500"
                  step="500"
                  required
                  value={amountETB}
                  onChange={(e) => setAmountETB(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700"
                />
                <span className="absolute right-3 top-2 text-xs font-bold text-slate-400">
                  ETB
                </span>
              </div>
              <div className="flex gap-2 mt-2">
                {[10000, 25000, 50000, 100000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmountETB(preset)}
                    className="text-[11px] font-mono px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
                  >
                    +{preset.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Ethiopian Payment Method
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'Telebirr', label: 'Telebirr SuperApp', note: 'Instant Mobile Wallet' },
                  { id: 'CBE Birr', label: 'CBE Birr (Commercial Bank)', note: 'Bank Integration' },
                  { id: 'Chapa', label: 'Chapa Direct Card', note: 'Visa & Mastercard' },
                  { id: 'Bank Transfer', label: 'Awash / BOA Transfer', note: 'RTGS Settlement' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMethod(item.id as any)}
                    className={`p-3 text-left border rounded-lg transition-colors ${
                      method === item.id
                        ? 'border-emerald-700 bg-emerald-50 text-emerald-950 font-medium'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{item.label}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{item.note}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Account / Phone Number
              </label>
              <input
                type="text"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+251 91 123 4567"
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-700"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center gap-1 text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-700" /> 256-bit NBE Compliant Escrow
              </span>
              <span className="font-semibold text-slate-900 font-mono tabular-nums">
                Total: {amountETB.toLocaleString()} ETB
              </span>
            </div>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 text-white font-medium text-xs rounded-lg transition-colors shadow-sm"
            >
              <span>Authenticate & Deposit via {method}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {step === 'processing' && (
          <div className="p-8 text-center space-y-4">
            <div className="w-10 h-10 border-3 border-emerald-800 border-t-transparent rounded-full animate-spin mx-auto" />
            <div className="font-semibold text-sm text-slate-900">
              Connecting to {method} Gateway...
            </div>
            <div className="text-xs text-slate-500">
              Validating payment credentials with the National Bank of Ethiopia clearing house.
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="p-6 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-700 mx-auto" />
            <div>
              <div className="text-base font-bold text-slate-900">Deposit Successful!</div>
              <div className="text-xs text-slate-500 mt-1">
                Your wallet balance has been updated immediately.
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-left text-xs space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500">Reference:</span>
                <span className="font-semibold text-slate-900">{reference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount:</span>
                <span className="font-semibold text-emerald-700">{amountETB.toLocaleString()} ETB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Channel:</span>
                <span className="font-semibold text-slate-900">{method}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium text-xs rounded-lg transition-colors"
            >
              Back to Wallet
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
