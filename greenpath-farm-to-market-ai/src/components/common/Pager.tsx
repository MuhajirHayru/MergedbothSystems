/**
 * Shared table pagination control.
 * Labeled Previous / Next buttons with an explicit "Page X of Y · N matching"
 * summary. `total` may be omitted when only the current page size is known.
 */
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const Pager: React.FC<{
  page: number;
  pageSize: number;
  total?: number;
  hasMore: boolean;
  onPrev: () => void;
  onNext: () => void;
}> = ({ page, pageSize, total, hasMore, onPrev, onNext }) => {
  const totalPages = total != null && pageSize > 0 ? Math.ceil(total / pageSize) : null;
  return (
    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1">
      <span>
        Page {page}
        {totalPages != null ? ` of ${totalPages}` : ''}
        {total != null ? ` · ${total} matching` : ''}
      </span>
      <div className="flex gap-1.5">
        <button onClick={onPrev} disabled={page <= 1} aria-label="Previous page"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800">
          <ChevronLeft className="w-3.5 h-3.5" /> Previous
        </button>
        <button onClick={onNext} disabled={!hasMore} aria-label="Next page"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800">
          Next <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

/** Client-side slice helper for the current page. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}
