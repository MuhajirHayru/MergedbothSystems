import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Badge — compact status indicator.
 * StatusPill — thin mapping from workflow status strings to Badge variants.
 */

const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        primary: "border-transparent bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        success: "border-transparent bg-success/10 text-success",
        info: "border-transparent bg-info/10 text-info",
        warning: "border-transparent bg-warning/10 text-warning",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        accent: "border-transparent bg-accent/15 text-accent-foreground",
        outline: "border-border bg-transparent text-foreground",
        neutral: "border-border bg-muted text-muted-foreground",
        // Workflow aliases kept for the documentation page
        pending: "border-transparent bg-warning/10 text-warning",
        approved: "border-transparent bg-success/10 text-success",
        rejected: "border-transparent bg-destructive/10 text-destructive",
        active: "border-transparent bg-success/10 text-success",
        inactive: "border-border bg-muted text-muted-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  onRemove?: () => void;
  icon?: React.ReactNode;
}

function Badge({ className, variant, size, onRemove, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {icon ? (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Remove"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

type PillVariant = NonNullable<BadgeProps["variant"]>;

const STATUS_VARIANTS: Record<string, PillVariant> = {
  // Products
  ACTIVE: "success",
  APPROVED: "success",
  VERIFIED: "success",
  DELIVERED: "success",
  PAID: "success",
  COMPLETED: "success",
  RELEASED: "success",
  INACTIVE: "neutral",
  DRAFT: "warning",
  SOLD: "info",
  DELETED: "neutral",
  DEACTIVATED: "neutral",
  // Review workflow
  PENDING: "warning",
  UNDER_REVIEW: "warning",
  PROCESSING: "info",
  SUBMITTED: "info",
  SHIPPED: "info",
  IN_TRANSIT: "info",
  CONFIRMED: "info",
  REJECTED: "destructive",
  FAILED: "destructive",
  FLAGGED: "destructive",
  DISPUTED: "destructive",
  SUSPENDED: "warning",
  CANCELLED: "neutral",
  // Order statuses (Title-Case from the API)
  Processing: "info",
  Confirmed: "info",
  Shipped: "info",
  Delivered: "success",
  Cancelled: "neutral",
};

const ROLE_VARIANTS: Record<string, PillVariant> = {
  FARMER: "success",
  WHOLESALER: "info",
  RETAILER: "primary",
  DRIVER: "warning",
  USER_ADMIN: "warning",
  FINANCIAL_MANAGER: "info",
  SUPER_ADMIN: "outline",
};

export function StatusPill({
  value,
  kind = "status",
  className,
}: {
  value: string;
  kind?: "status" | "role" | "neutral";
  className?: string;
}) {
  const variant =
    kind === "role"
      ? ROLE_VARIANTS[value] ?? "neutral"
      : kind === "neutral"
        ? "neutral"
        : STATUS_VARIANTS[value] ??
          (value ? "neutral" : "outline");

  return (
    <Badge variant={variant} className={className}>
      {value}
    </Badge>
  );
}

export { Badge, badgeVariants };
