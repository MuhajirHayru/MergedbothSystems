"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Label } from "./label";

/**
 * DateRangePicker — the single date filter shape used by dashboards and
 * reports: today / 7 / 30 / 90 days / custom. Values are ISO `yyyy-mm-dd`
 * strings so they can be sent to the API unchanged.
 */

export type DatePreset = "today" | "7d" | "30d" | "90d" | "custom";

export interface DateRangeValue {
  preset: DatePreset;
  from: string;
  to: string;
}

const PRESETS: { value: DatePreset; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "7d", label: "7 days", days: 6 },
  { value: "30d", label: "30 days", days: 29 },
  { value: "90d", label: "90 days", days: 89 },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function rangeForPreset(preset: Exclude<DatePreset, "custom">, now = new Date()): DateRangeValue {
  const days = PRESETS.find((item) => item.value === preset)?.days ?? 29;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { preset, from: isoDate(from), to: isoDate(now) };
}

export function defaultDateRange(): DateRangeValue {
  return rangeForPreset("30d");
}

export interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  id?: string;
}

export function DateRangePicker({ value, onChange, className, id = "date-range" }: DateRangePickerProps) {
  function selectPreset(preset: DatePreset) {
    if (preset === "custom") {
      onChange({ ...value, preset });
      return;
    }
    onChange(rangeForPreset(preset));
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="inline-flex flex-wrap gap-1 rounded-[var(--radius-sm)] border border-border bg-card p-1"
        role="group"
        aria-label="Date range presets"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => selectPreset(preset.value)}
            aria-pressed={value.preset === preset.value}
            className={cn(
              "rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value.preset === preset.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => selectPreset("custom")}
          aria-pressed={value.preset === "custom"}
          className={cn(
            "rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value.preset === "custom"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          Custom
        </button>
      </div>

      {value.preset === "custom" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id={`${id}-from`}
              type="date"
              size="sm"
              value={value.from}
              max={value.to || undefined}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id={`${id}-to`}
              type="date"
              size="sm"
              value={value.to}
              min={value.from || undefined}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
