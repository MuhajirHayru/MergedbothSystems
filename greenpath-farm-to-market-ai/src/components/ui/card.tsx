import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Card — flat surface with a 1px border and 10px radius.
 *
 * Two supported APIs:
 *   <Card className="p-5">…</Card>
 *   <Card><CardHeader><CardTitle/></CardHeader><CardContent/></Card>
 */

const cardVariants = cva(
  "rounded-[var(--radius-md)] border border-border bg-card text-card-foreground",
  {
    variants: {
      variant: {
        default: "",
        elevated: "shadow-[var(--shadow-md)]",
        interactive: "transition-shadow hover:shadow-[var(--shadow-md)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  )
);
Card.displayName = "Card";

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Legacy API: renders the heading and optional subtitle on the left. */
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Legacy API: rendered on the right of the header row. */
  action?: React.ReactNode;
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, title, subtitle, action, children, ...props }, ref) => {
    const legacy = title !== undefined || action !== undefined;

    if (!legacy) {
      return (
        <div ref={ref} className={cn("flex flex-col gap-1.5 p-5", className)} {...props}>
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4",
          className
        )}
        {...props}
      >
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
          {children}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-base font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center gap-3 p-5 pt-0", className)}
      {...props}
    />
  )
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
