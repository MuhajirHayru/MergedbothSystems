"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Modal — centered floating layer, 16px radius.
 *
 * Simple API:   <Modal open onClose title description footer>…</Modal>
 * Compound API: <Modal open onOpenChange><ModalHeader onClose>…</ModalHeader></Modal>
 *
 * Both render the same dialog markup with Escape handling and scroll lock.
 */

const sizeClasses = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-screen-xl",
};

export type ModalSize = keyof typeof sizeClasses;

export interface ModalProps {
  open: boolean;
  /** Preferred close handler. */
  onOpenChange?: (open: boolean) => void;
  /** Legacy alias for `onOpenChange(false)`. */
  onClose?: () => void;
  /** Legacy simple-API heading. Omit when using the compound parts. */
  title?: string;
  description?: string;
  /** Legacy simple-API footer. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
  size?: ModalSize;
  className?: string;
}

function Modal({
  open,
  onOpenChange,
  onClose,
  title,
  description,
  footer,
  children,
  size = "md",
  className,
}: ModalProps) {
  const close = React.useCallback(() => {
    onClose?.();
    onOpenChange?.(false);
  }, [onClose, onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  if (!open) return null;

  const legacy = title !== undefined || footer !== undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-slate-950/45" onClick={close} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground shadow-[var(--shadow-xl)] sm:max-h-[calc(100dvh-2rem)]",
          sizeClasses[size],
          className
        )}
      >
        {legacy ? (
          <>
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                {description ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                ) : null}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close">
                <X />
              </Button>
            </div>
            {children ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {children}
              </div>
            ) : null}
            {footer ? (
              <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">
                {footer}
              </div>
            ) : null}
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

const ModalHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }
>(({ className, onClose, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4",
      className
    )}
    {...props}
  >
    <div className="min-w-0 flex-1">{children}</div>
    {onClose ? (
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
        <X />
      </Button>
    ) : null}
  </div>
));
ModalHeader.displayName = "ModalHeader";

const ModalTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-base font-semibold leading-tight tracking-tight", className)}
      {...props}
    />
  )
);
ModalTitle.displayName = "ModalTitle";

const ModalDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("mt-1 text-sm text-muted-foreground", className)} {...props} />
));
ModalDescription.displayName = "ModalDescription";

const ModalContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4", className)}
      {...props}
    />
  )
);
ModalContent.displayName = "ModalContent";

const ModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-4",
        className
      )}
      {...props}
    />
  )
);
ModalFooter.displayName = "ModalFooter";

export { Modal, ModalHeader, ModalTitle, ModalDescription, ModalContent, ModalFooter };
