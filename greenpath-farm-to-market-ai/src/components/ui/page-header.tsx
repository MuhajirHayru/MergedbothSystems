import * as React from "react";
import { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

/**
 * PageHeader component - Consistent page title section
 * 
 * Design: Title, description, and optional primary action
 * Used at the top of every page for consistency
 */

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: Omit<ButtonProps, "icon"> & {
    label: string;
    icon?: LucideIcon;
  };
  className?: string;
}

function PageHeader({ title, description, action, className }: PageHeaderProps) {
  const actionProps: Omit<ButtonProps, "icon"> & { label: string; icon?: LucideIcon } = action ?? {
    label: "",
  };
  const { label, icon: ActionIcon, ...buttonProps } = actionProps;

  return (
    <div className={cn("flex items-start justify-between gap-4 mb-6", className)}>
      <div className="flex-1 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        )}
      </div>
      {action ? (
        <Button
          {...buttonProps}
          variant={buttonProps.variant ?? "primary"}
          size={buttonProps.size ?? "md"}
          icon={ActionIcon ? <ActionIcon /> : undefined}
        >
          {label}
        </Button>
      ) : null}
    </div>
  );
}

export { PageHeader };
