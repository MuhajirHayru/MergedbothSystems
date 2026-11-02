"use client";

import * as React from "react";
import { Check, Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * PasswordInput — password field with a reveal toggle.
 * PasswordStrength — client-side feedback only; the backend remains the
 * authority on password policy.
 */

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "new-password",
  placeholder,
  invalid = false,
  required = true,
  ...rest
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  invalid?: boolean;
  required?: boolean;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange" | "type" | "size"
>) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...rest}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        aria-invalid={invalid || undefined}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

const RULES = [
  { key: "length", label: "At least 8 characters", test: (value: string) => value.length >= 8 },
  { key: "case", label: "Upper and lower case letters", test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { key: "number", label: "A number", test: (value: string) => /\d/.test(value) },
  { key: "symbol", label: "A symbol", test: (value: string) => /[^A-Za-z0-9]/.test(value) },
];

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function PasswordStrength({ value }: { value: string }) {
  const passed = RULES.filter((rule) => rule.test(value));
  const score = value.length === 0 ? 0 : passed.length;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {RULES.map((rule, index) => (
            <span
              key={rule.key}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                index < score
                  ? score >= 3
                    ? "bg-success"
                    : score === 2
                      ? "bg-warning"
                      : "bg-destructive"
                  : "bg-border"
              )}
            />
          ))}
        </div>
        <span
          className={cn(
            "shrink-0 text-xs font-medium",
            value.length === 0 && "text-muted-foreground",
            value.length > 0 && score < 3 && "text-warning",
            score >= 3 && "text-success"
          )}
          aria-live="polite"
        >
          {value.length === 0 ? "Add a password" : LABELS[Math.max(1, score)]}
        </span>
      </div>

      <ul className="grid gap-1 sm:grid-cols-2">
        {RULES.map((rule) => {
          const ok = rule.test(value);
          return (
            <li
              key={rule.key}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                ok ? "text-success" : "text-muted-foreground"
              )}
            >
              <Check
                className={cn("h-3 w-3", ok ? "opacity-100" : "opacity-30")}
                aria-hidden="true"
              />
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The only client-side requirement is the one the API already enforces (8+
 * characters). Strength is guidance, not a second policy.
 */
export function passwordMeetsPolicy(value: string) {
  return value.length >= 8;
}
