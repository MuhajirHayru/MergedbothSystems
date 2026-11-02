import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Textarea component - Multi-line text input
 * 
 * Design: Consistent with Input component styling
 */

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-[var(--radius-sm)] border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${props.id}-error` : undefined}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
