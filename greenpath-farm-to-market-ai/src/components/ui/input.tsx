import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Modern Input component for GreenPath
 * 
 * Design: Clean, accessible, with proper focus states
 * Uses design tokens from globals.css
 */

const inputVariants = cva(
  "flex w-full rounded-[var(--radius-sm)] border border-input bg-background px-3 py-2 text-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "",
        error: "border-destructive focus-visible:ring-destructive",
      },
      size: {
        sm: "h-8 text-xs",
        md: "h-10 text-sm",
        lg: "h-12 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  error?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, size, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          inputVariants({ variant: error ? "error" : variant, size }),
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
Input.displayName = "Input";

export { Input, inputVariants };
