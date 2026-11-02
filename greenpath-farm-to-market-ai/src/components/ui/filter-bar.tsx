"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * FilterBar — one row above a list: controls on the left, actions on the
 * right, then the chips for every filter that is currently applied.
 */

export interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  children?: React.ReactNode;
  actions?: React.ReactNode;
  activeFilters?: ActiveFilter[];
  onClearAll?: () => void;
  className?: string;
}

export function FilterBar({
  children,
  actions,
  activeFilters = [],
  onClearAll,
  className,
}: FilterBarProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">{children}</div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Active filters</span>
          {activeFilters.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-foreground"
            >
              {filter.label}
              <button
                type="button"
                onClick={filter.onRemove}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove filter ${filter.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {onClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
