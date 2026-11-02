"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";

/**
 * ChartCard — the frame every chart sits in: title, optional description and
 * action, a legend, and consistent loading/empty handling. Chart bodies render
 * as children so no chart library is required by the design system itself.
 */

export interface ChartLegendItem {
  label: string;
  className: string;
}

export interface ChartCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  legend?: ChartLegendItem[];
  loading?: boolean;
  empty?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function ChartCard({
  title,
  description,
  action,
  legend,
  loading = false,
  empty,
  children,
  footer,
  className,
  bodyClassName,
}: ChartCardProps) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {legend && legend.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-4 px-5 pt-4">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-2.5 w-2.5 rounded-full", item.className)} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={cn("min-h-48 flex-1 p-5", bodyClassName)}>
        {loading ? (
          <div className="space-y-3" role="status" aria-live="polite">
            <span className="sr-only">Loading chart</span>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ) : empty ? (
          <EmptyState title={empty} />
        ) : (
          children
        )}
      </div>

      {footer ? (
        <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">{footer}</div>
      ) : null}
    </Card>
  );
}
