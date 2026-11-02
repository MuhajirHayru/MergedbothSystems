"use client";

import * as React from "react";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Toast/Notification component - Temporary feedback messages
 * 
 * Design: Appears at top-right, auto-dismisses, stack support
 * Used for success, error, info, warning feedback
 */

export interface ToastProps {
  id?: string;
  title?: string;
  description?: string;
  variant?: "default" | "success" | "info" | "warning" | "destructive";
  duration?: number;
  onClose?: () => void;
}

const variantConfig = {
  default: {
    container: "bg-background border-border",
    icon: Info,
  },
  success: {
    container: "bg-success/10 border-success/20",
    icon: CheckCircle2,
  },
  info: {
    container: "bg-info/10 border-info/20",
    icon: Info,
  },
  warning: {
    container: "bg-warning/10 border-warning/20",
    icon: AlertTriangle,
  },
  destructive: {
    container: "bg-destructive/10 border-destructive/20",
    icon: XCircle,
  },
};

function Toast({
  title,
  description,
  variant = "default",
  duration = 5000,
  onClose,
}: ToastProps) {
  const [isVisible, setIsVisible] = React.useState(true);
  const config = variantConfig[variant];
  const Icon = config.icon;

  React.useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onClose?.(), 300); // Wait for exit animation
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  if (!isVisible) return null;

  return (
    <div
      role="alert"
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-[var(--radius-md)] border p-4 shadow-[var(--shadow-lg)] transition-all animate-in slide-in-from-top-2",
        config.container
      )}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-1">
        {title && <div className="font-medium text-sm">{title}</div>}
        {description && <div className="text-sm opacity-90">{description}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={() => {
            setIsVisible(false);
            setTimeout(() => onClose(), 300);
          }}
          className="shrink-0 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * ToastContainer - Container for stacking toasts
 */
function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {children}
    </div>
  );
}

/**
 * Simple toast context and hook for programmatic usage
 */
type ToastInput = Omit<ToastProps, "id" | "onClose">;

interface ToastContextValue {
  toasts: (ToastProps & { id: string })[];
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<(ToastProps & { id: string })[]>([]);

  const showToast = React.useCallback((toast: ToastInput) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer>
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onClose={() => dismissToast(toast.id)} />
        ))}
      </ToastContainer>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export { Toast, ToastContainer };
