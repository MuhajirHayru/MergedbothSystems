import * as React from "react";
import { AlertCircle, Check, Info, X, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Alert component - Contextual feedback messages
 * 
 * Design: Color-coded by severity, with icons
 * Used for success, info, warning, error messages
 */

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "info" | "warning" | "destructive";
  title?: string;
  onClose?: () => void;
}

const variantConfig = {
  default: {
    container: "bg-muted border-border text-foreground",
    icon: Info,
  },
  success: {
    container: "bg-success/10 border-success/20 text-success",
    icon: Check,
  },
  info: {
    container: "bg-info/10 border-info/20 text-info",
    icon: Info,
  },
  warning: {
    container: "bg-warning/10 border-warning/20 text-warning",
    icon: AlertTriangle,
  },
  destructive: {
    container: "bg-destructive/10 border-destructive/20 text-destructive",
    icon: AlertCircle,
  },
};

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "default", title, onClose, children, ...props }, ref) => {
    const config = variantConfig[variant];
    const Icon = config.icon;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "relative rounded-[var(--radius-md)] border p-4 flex gap-3",
          config.container,
          className
        )}
        {...props}
      >
        <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 space-y-1">
          {title && <div className="font-medium">{title}</div>}
          <div className="text-sm [&_p]:leading-relaxed">{children}</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);
Alert.displayName = "Alert";

export { Alert };
