import React, { useEffect, useId, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useModalA11y } from '../../hooks/useModalA11y';

interface BaseProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string;
  danger?: boolean;
  children?: React.ReactNode;
  onCancel: () => void;
}

export interface ConfirmDialogProps extends BaseProps {
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy,
  error,
  danger,
  children,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const panelRef = useModalA11y<HTMLDivElement>(onCancel, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 space-y-4 my-8 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {danger && <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
              {description && <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{description}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        {error && (
          <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60 ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#15803D] hover:bg-[#166534]'
            }`}
          >
            {busy ? 'Workingâ€¦' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface ReasonDialogProps extends BaseProps {
  label?: string;
  placeholder?: string;
  requireReason?: boolean;
  initialReason?: string;
  onConfirm: (reason: string) => void;
}

export const ReasonDialog: React.FC<ReasonDialogProps> = ({
  open,
  title,
  description,
  label = 'Reason',
  placeholder = 'Explain why this action is being takenâ€¦',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy,
  error,
  danger,
  requireReason = true,
  initialReason = '',
  children,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const panelRef = useModalA11y<HTMLFormElement>(onCancel, open);
  const [reason, setReason] = useState(initialReason);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setLocalError('');
    }
  }, [open, initialReason]);

  if (!open) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = reason.trim();
    if (requireReason && !value) {
      setLocalError('A reason is required for this action.');
      return;
    }
    setLocalError('');
    onConfirm(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <form
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 space-y-4 my-8 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            {danger && <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
            <div>
              <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h3>
              {description && <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">{description}</div>}
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        <div>
          <label htmlFor={`${titleId}-reason`} className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            {label}{requireReason && <span className="text-rose-500"> *</span>}
          </label>
          <textarea
            id={`${titleId}-reason`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
          />
        </div>
        {(localError || error) && (
          <div role="alert" className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">
            {localError || error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60 ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#15803D] hover:bg-[#166534]'
            }`}
          >
            {busy ? 'Workingâ€¦' : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

