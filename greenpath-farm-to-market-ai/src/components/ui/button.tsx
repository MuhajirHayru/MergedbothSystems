import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Modern Button component for GreenPath
 * 
 * Design: Linear/Stripe-inspired, calm and clean
 * Uses new design tokens from globals.css
 * Consolidated from two previous implementations
 */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[var(--shadow-sm)] hover:bg-primary/90 active:bg-primary/95",
        primary:
          "bg-primary text-primary-foreground shadow-[var(--shadow-sm)] hover:bg-primary/90 active:bg-primary/95",
        secondary:
          "border border-input bg-background text-foreground shadow-[var(--shadow-sm)] hover:bg-muted hover:text-foreground",
        outline:
          "border border-input bg-transparent hover:bg-muted hover:text-foreground",
        ghost: "hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-sm)] hover:bg-destructive/90",
        danger:
          "bg-destructive text-destructive-foreground shadow-[var(--shadow-sm)] hover:bg-destructive/90",
        success:
          "bg-success text-success-foreground shadow-[var(--shadow-sm)] hover:bg-success/90",
        warning:
          "bg-warning text-warning-foreground shadow-[var(--shadow-sm)] hover:bg-warning/90",
        subtle:
          "bg-success/10 text-success hover:bg-success/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        md: "h-10 px-4 text-sm [&_svg]:size-4",
        lg: "h-12 px-6 text-sm [&_svg]:size-5",
        icon: "h-10 w-10 [&_svg]:size-4",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
        "icon-lg": "h-12 w-12 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  icon?: React.ReactNode;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      loading = false,
      icon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : icon ? (
          <span aria-hidden="true">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
