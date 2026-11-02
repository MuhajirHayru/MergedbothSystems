import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Select component - Native select with consistent styling
 * 
 * Design: Matches Input component, supports multiple and searchable (via datalist)
 * For complex select needs, will add Combobox component later
 */

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <select
        className={cn(
          "flex h-10 w-full rounded-[var(--radius-sm)] border border-input bg-background px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus-visible:ring-destructive",
          className
        )}
        ref={ref}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${props.id}-error` : undefined}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";

export { Select };
