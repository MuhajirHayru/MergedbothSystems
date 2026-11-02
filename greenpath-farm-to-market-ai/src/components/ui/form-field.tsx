"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * FormField component - Complete form field with label, input, and error
 * 
 * Design: Wraps any input with consistent label and error styling
 * Handles accessibility attributes automatically
 */

export interface FormFieldProps {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactElement;
  className?: string;
}

function FormField({ label, required, error, hint, children, className }: FormFieldProps) {
  const id = React.useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // Clone the child element and inject id and error props
  const child = children as React.ReactElement<{
    id?: string;
    error?: string;
    "aria-describedby"?: string;
  }>;

  const childWithProps = React.cloneElement(child, {
    id: child.props.id || id,
    error,
    "aria-describedby":
      cn(error && errorId, hint && hintId, child.props["aria-describedby"]).trim() || undefined,
  });

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
      )}
      {childWithProps}
      {hint && !error && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <div id={errorId} className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Field — the original page-level field wrapper (label, hint, error).
 * Kept as the small, explicit API most forms already use.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="flex items-start gap-1.5 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export { FormField };
