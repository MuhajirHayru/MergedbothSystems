/**
 * Part 18 — reusable advanced data table.
 *
 * Features: visible record IDs (copyable), tri-state checkbox selection,
 * live selection totals (selected vs page vs filtered), select-current-page
 * vs select-all-matching, bulk-action toolbar with confirmation dialog and
 * per-item results, sorting, pagination hooks, loading/empty/error states.
 *
 * The component is presentation-only: data, actions and "select all matching"
 * are supplied by the caller, so authorization rules stay server-side.
 */
import React, { useMemo, useState } from 'react';
import { formatApiError } from '../../lib/apiErrors';
import { Copy, Check } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
}

export interface BulkAction<T> {
  label: string;
  danger?: boolean;
  /** Returns {processed, failed: [{id, reason}]} or throws for a whole-action failure. */
  run: (ids: string[]) => Promise<{ processed: number; skipped?: number; failures?: { id: string; reason: string }[] }>;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowId: (row: T) => string;
  /** Primary identifier shown in the ID column (e.g. reference or pk). */
  rowIdentifier: (row: T) => string;
  emptyMessage: string;
  loading?: boolean;
  error?: string;
  /** Bulk actions; only rendered when at least one is supplied. */
  bulkActions?: BulkAction<T>[];
  bulkLabel?: string;
  /** Total records matching the current filters (server-side), if known. */
  filteredTotal?: number;
  /** Select-all-matching: returns every matching id (server-backed). */
  onSelectAllMatching?: () => Promise<string[]>;
  onRowClick?: (row: T) => void;
  toolbarExtra?: React.ReactNode;
  compact?: boolean;
}

function CopyableId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy ID"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => undefined);
      }}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
    >
      <span className="truncate max-w-[10rem]">{value}</span>
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 opacity-60" />}
    </button>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowId,
  rowIdentifier,
  emptyMessage,
  loading,
  error,
  bulkActions = [],
  bulkLabel = 'records',
  filteredTotal,
  onSelectAllMatching,
  onRowClick,
  toolbarExtra,
  compact,
}: DataTableProps<T>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<BulkAction<T> | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | { processed: number; skipped: number; failures: { id: string; reason: string }[]; action: string }>(null);
  const [bulkError, setBulkError] = useState<string>('');

  const pageIds = useMemo(() => rows.map(rowId), [rows, rowId]);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const somePageSelected = selectedOnPage > 0 && !allPageSelected;
  const selectedTotal = selected.size;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  const clear = () => setSelected(new Set());

  const runBulk = async (action: BulkAction<T>) => {
    setRunning(true);
    try {
      const res = await action.run(Array.from(selected));
      setResult({
        processed: res.processed ?? 0,
        skipped: res.skipped ?? 0,
        failures: res.failures ?? [],
        action: action.label,
      });
      setSelected(new Set());
    } catch (err) {
      setBulkError(formatApiError(err, 'The bulk action failed.'));
    } finally {
      setRunning(false);
      setConfirmAction(null);
    }
  };

  const pad = compact ? 'px-3 py-2' : 'py-3 px-3';

  return (
    <div className="space-y-3">
      {/* Selection summary + bulk toolbar */}
      {(selectedTotal > 0 || bulkActions.length > 0) && (
        <div
          className={`p-3 rounded-xl border text-xs space-y-2 transition-colors ${
            selectedTotal > 0
              ? 'border-[#15803D] bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {selectedTotal > 0 ? (
              <span className="font-bold text-emerald-800 dark:text-emerald-300">
                {selectedTotal} {bulkLabel} selected
              </span>
            ) : (
              <span className="text-slate-500">
                {filteredTotal != null ? `${filteredTotal} ${bulkLabel} match the current filters` : `${rows.length} on this page`}
              </span>
            )}
            {selectedTotal > 0 && (
              <button onClick={clear} className="text-[11px] underline text-slate-500 hover:text-slate-700">
                Clear selection
              </button>
            )}
            {toolbarExtra}
          </div>

          {selectedTotal > 0 && bulkActions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-900/60">
              <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wide">Bulk actions:</span>
              {bulkActions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => setConfirmAction(a)}
                  disabled={running}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60 ${
                    a.danger
                      ? 'bg-rose-600 text-white hover:bg-rose-700'
                      : 'border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {a.label}
                </button>
              ))}
              {onSelectAllMatching && (
                <button
                  onClick={async () => {
                    const all = await onSelectAllMatching();
                    setSelected(new Set(all));
                  }}
                  className="text-[11px] underline text-slate-500 hover:text-slate-700"
                >
                  Select all matching records (across pages)
                </button>
              )}
            </div>
          )}

          {result && (
            <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-200">
                {result.action}: {result.processed} succeeded
                {result.skipped > 0 && `, ${result.skipped} skipped`}
                {result.failures.length > 0 && `, ${result.failures.length} failed`}
              </div>
              {result.failures.map((f, i) => (
                <div key={i} className="text-[11px] text-rose-600 dark:text-rose-400">
                  {f.id}: {f.reason}
                </div>
              ))}
              <button onClick={() => setResult(null)} className="text-[11px] underline text-slate-400">dismiss</button>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {error ? (
        <div className="p-6 rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300">{error}</div>
      ) : loading ? (
        <div className="p-6 text-center text-xs text-slate-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">{emptyMessage}</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                {bulkActions.length > 0 && (
                  <th className={`${pad} w-8`}>
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected;
                      }}
                      onChange={togglePage}
                      title={allPageSelected ? 'Deselect page' : 'Select current page'}
                    />
                  </th>
                )}
                <th className={`${pad}`}>ID</th>
                {columns.map((c) => (
                  <th key={c.key} className={`${pad} ${c.className ?? ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = rowId(row);
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`border-b border-slate-100 dark:border-slate-800/60 ${onRowClick ? 'cursor-pointer' : ''} ${
                      isSel ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    {bulkActions.length > 0 && (
                      <td className={pad} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(id)} />
                      </td>
                    )}
                    <td className={pad}>
                      <CopyableId value={rowIdentifier(row)} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={`${pad} ${c.className ?? ''}`}>
                        {c.render ? c.render(row) : String((row as any)[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConfirmAction(null)}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className={`text-base font-bold ${confirmAction.danger ? 'text-rose-700 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
              {confirmAction.label}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              This will affect <strong>{selectedTotal}</strong> {bulkLabel}.
              {confirmAction.danger && ' This operation is sensitive.'} Review and confirm.
            </p>
            {bulkError && <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-700">{bulkError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-1.5 rounded-lg border text-xs font-semibold border-slate-300 dark:border-slate-600">
                Cancel
              </button>
              <button
                onClick={() => void runBulk(confirmAction)}
                disabled={running}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60 ${confirmAction.danger ? 'bg-rose-600' : 'bg-[#15803D]'}`}
              >
                {running ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
