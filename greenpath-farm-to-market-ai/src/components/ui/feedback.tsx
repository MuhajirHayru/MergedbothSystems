import * as React from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/** Spinner — inline loading indicator. */
function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("h-6 w-6 animate-spin text-primary", className)}
      aria-hidden="true"
    />
  );
}

/** PageLoader — centred loading state for a whole page or panel. */
function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex min-h-64 flex-col items-center justify-center gap-3 text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** ErrorBanner — friendly failure message with a retry action. */
function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-[var(--radius-md)] border border-destructive/20 bg-destructive/10 p-4"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex-1">
        <p className="text-sm text-foreground">{message}</p>
        {onRetry ? (
          <Button
            variant="link"
            size="sm"
            onClick={onRetry}
            className="mt-1 h-auto px-0 text-destructive"
          >
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** SuccessBanner — confirmation of a completed action. */
function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[var(--radius-md)] border border-success/20 bg-success/10 p-4"
    >
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
      <p className="text-sm text-foreground">{message}</p>
    </div>
  );
}

export { Spinner, PageLoader, ErrorBanner, SuccessBanner };
