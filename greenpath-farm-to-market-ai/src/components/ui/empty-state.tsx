import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * EmptyState — helpful, quiet placeholder with an optional call to action.
 *
 * `icon` accepts a Lucide component or a rendered element.
 * `action` accepts a rendered node or `{ label, onClick }`.
 */

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon | React.ReactNode;
  action?:
    | React.ReactNode
    | {
        label: string;
        onClick: () => void;
      };
  className?: string;
}

function isEmptyStateAction(
  action: EmptyStateProps["action"]
): action is { label: string; onClick: () => void } {
  return (
    typeof action === "object" &&
    action !== null &&
    "label" in action &&
    "onClick" in action
  );
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  const isElement = React.isValidElement(icon);
  const Icon = icon as LucideIcon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-14 text-center",
        className
      )}
    >
      {icon ? (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {isElement ? (
            <span aria-hidden="true">{icon as React.ReactNode}</span>
          ) : (
            <Icon className="h-5 w-5" aria-hidden="true" />
          )}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-3">
          {isEmptyStateAction(action) ? (
            <Button onClick={action.onClick}>{action.label}</Button>
          ) : (
            action
          )}
        </div>
      ) : null}
    </div>
  );
}

export { EmptyState };
