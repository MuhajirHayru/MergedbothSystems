import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card } from "./card";

/**
 * StatCard — a single KPI: label, value, optional delta and sparkline.
 *
 * Supports the original page API (`icon` element, `iconBg`, `sublabel`,
 * `actionLabel`/`onAction`) plus the design-system API (`delta`, `trend`,
 * `sparkline`) while the pages are migrated one phase at a time.
 */

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Icon element (page API) or Lucide component (design-system API). */
  icon?: React.ReactNode | React.ComponentType<{ className?: string }>;
  /** Tailwind classes for the icon tile. Legacy — prefer `tone`. */
  iconBg?: string;
  tone?: "primary" | "info" | "success" | "warning" | "destructive" | "neutral";
  sublabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  delta?: {
    value: number;
    label?: string;
  };
  trend?: "up" | "down" | "neutral";
  /** Values drawn as a sparkline; no axes, no labels. */
  sparkline?: number[];
  className?: string;
}

const TONE_TILE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;

  const width = 96;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-7 w-24 text-primary", className)}
      role="img"
      aria-label="Trend sparkline"
      focusable="false"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({
  label,
  value,
  icon,
  iconBg,
  tone = "primary",
  sublabel,
  actionLabel,
  onAction,
  delta,
  trend,
  sparkline,
  className,
}: StatCardProps) {
  const deltaValue = delta?.value ?? 0;
  const effectiveTrend =
    trend ?? (deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : "neutral");
  const DeltaIcon =
    effectiveTrend === "up" ? ArrowUp : effectiveTrend === "down" ? ArrowDown : Minus;

  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start gap-4">
        {icon ? (
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
              iconBg ?? TONE_TILE[tone]
            )}
            aria-hidden="true"
          >
            {React.isValidElement(icon) ? (
              icon
            ) : (
              (() => {
                const Icon = icon as React.ComponentType<{ className?: string }>;
                return <Icon className="h-5 w-5" />;
              })()
            )}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>

          {sublabel ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{sublabel}</p>
          ) : null}

          {delta ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <DeltaIcon
                className={cn(
                  "h-3.5 w-3.5",
                  effectiveTrend === "up" && "text-success",
                  effectiveTrend === "down" && "text-destructive",
                  effectiveTrend === "neutral" && "text-muted-foreground"
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "font-medium tabular-nums",
                  effectiveTrend === "up" && "text-success",
                  effectiveTrend === "down" && "text-destructive",
                  effectiveTrend === "neutral" && "text-muted-foreground"
                )}
              >
                {deltaValue > 0 ? "+" : ""}
                {deltaValue}%
              </span>
              {delta.label ? (
                <span className="text-muted-foreground">{delta.label}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {sparkline && sparkline.length > 1 ? (
          <Sparkline values={sparkline} className="mt-1 shrink-0 text-primary" />
        ) : null}
      </div>

      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {actionLabel}
          <span aria-hidden="true">&rarr;</span>
        </button>
      ) : null}
    </Card>
  );
}

export { StatCard, Sparkline };
