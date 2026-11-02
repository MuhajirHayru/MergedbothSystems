"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Skeleton } from "./skeleton";

/**
 * Table primitives used by every list view.
 *
 * TableWrap keeps its historical minimal API; DataTable adds sticky headers,
 * client-side sorting, optional server pagination and a card layout on mobile
 * so no page needs a horizontally scrolling table on a phone.
 */

export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-left">{children}</table>
    </div>
  );
}

type Align = "left" | "center" | "right";

const alignClass: Record<Align, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export function Th({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: Align;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
        alignClass[align],
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  className?: string;
  align?: Align;
}) {
  return (
    <td
      className={cn(
        "border-b border-border/70 px-4 py-3 text-sm text-foreground",
        alignClass[align],
        className
      )}
    >
      {children}
    </td>
  );
}

export function Pagination({
  page,
  count,
  pageSize = 20,
  onPage,
}: {
  page: number;
  count: number;
  pageSize?: number;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);

  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  const pages: number[] = [];
  for (let i = start; i <= end; i += 1) pages.push(i);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"
    >
      <p className="text-xs text-muted-foreground">
        Showing {from}–{to} of {count}
      </p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        {pages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            onClick={() => onPage(pageNumber)}
            aria-current={pageNumber === page ? "page" : undefined}
            className={cn(
              "h-8 min-w-8 rounded-[var(--radius-sm)] px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              pageNumber === page
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {pageNumber}
          </button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Enables sorting for this column. */
  sortValue?: (row: T) => string | number;
  align?: Align;
  className?: string;
  /** Shown instead of the header on the mobile card layout. */
  cardLabel?: string;
  /** Hide this column in the mobile card layout. */
  mobileHidden?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Accessible description of the table contents. */
  caption: string;
  page?: number;
  count?: number;
  onPage?: (page: number) => void;
  pageSize?: number;
  initialSort?: { key: string; direction: SortDirection };
  skeletonRows?: number;
}

type SortDirection = "asc" | "desc";

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  caption,
  page,
  count,
  onPage,
  pageSize = 20,
  initialSort,
  skeletonRows = 5,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<{ key: string; direction: SortDirection } | null>(
    initialSort ?? null
  );

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return rows;

    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue?.(a);
      const right = column.sortValue?.(b);
      if (left === right) return 0;
      if (left === undefined || left === null) return 1;
      if (right === undefined || right === null) return -1;
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [rows, columns, sort]);

  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  }

  if (loading) {
    return (
      <div className="space-y-3 p-4" role="status" aria-live="polite">
        <span className="sr-only">Loading table</span>
        {Array.from({ length: skeletonRows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex gap-4">
            {columns.map((column) => (
              <Skeleton key={column.key} className="h-6 flex-1" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <>{empty ?? <p className="px-4 py-10 text-center text-sm text-muted-foreground">No records found.</p>}</>;
  }

  return (
    <>
      {/* Mobile: stacked cards instead of a scrolling table */}
      <ul className="divide-y divide-border md:hidden">
        {sortedRows.map((row) => (
          <li key={rowKey(row)}>
            <button
              type="button"
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              disabled={!onRowClick}
              className={cn(
                "w-full px-4 py-3 text-left",
                onRowClick && "transition-colors hover:bg-muted/60"
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-foreground">
                  {columns[0].cell(row)}
                </span>
                <span className="shrink-0">{columns[1] ? columns[1].cell(row) : null}</span>
              </div>
              <dl className="mt-2 space-y-1">
                {columns
                  .slice(2)
                  .filter((column) => !column.mobileHidden)
                  .map((column) => (
                    <div key={column.key} className="flex items-center justify-between gap-3">
                      <dt className="text-xs text-muted-foreground">
                        {column.cardLabel ?? column.header}
                      </dt>
                      <dd className="text-xs text-foreground">{column.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden md:block">
        <TableWrap>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sort?.key === column.key;
                const SortIcon = !column.sortValue
                  ? null
                  : isSorted
                    ? sort?.direction === "asc"
                      ? ArrowUp
                      : ArrowDown
                    : ChevronsUpDown;
                const align = column.align ?? "left";

                return (
                  <Th key={column.key} align={align} className={column.className}>
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-[var(--radius-sm)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          align === "right" && "flex-row-reverse"
                        )}
                        aria-label={`Sort by ${typeof column.header === "string" ? column.header : column.key}`}
                      >
                        {column.header}
                        {SortIcon ? <SortIcon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </Th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer hover:bg-muted/60"
                )}
              >
                {columns.map((column) => (
                  <Td key={column.key} align={column.align} className={column.className}>
                    {column.cell(row)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {page !== undefined && count !== undefined && onPage ? (
        <Pagination page={page} count={count} pageSize={pageSize} onPage={onPage} />
      ) : null}
    </>
  );
}
