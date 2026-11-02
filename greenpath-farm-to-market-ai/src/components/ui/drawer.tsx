"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Drawer component - Side panel overlay
 * 
 * Design: Slides in from right/left, with backdrop
 * Used for filters, quick views, and side forms
 */

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  side?: "left" | "right";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

function Drawer({
  open,
  onOpenChange,
  children,
  side = "right",
  size = "md",
  className,
}: DrawerProps) {
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed inset-y-0 bg-background border-border flex flex-col w-full shadow-[var(--shadow-xl)]",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          sizeClasses[size],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

const DrawerHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }
>(({ className, onClose, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-start justify-between p-6 pb-4 border-b", className)}
    {...props}
  >
    <div className="flex-1">{children}</div>
    {onClose && (
      <button
        onClick={onClose}
        className="shrink-0 ml-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    )}
  </div>
));
DrawerHeader.displayName = "DrawerHeader";

const DrawerTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground mt-1.5", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

const DrawerContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex-1 overflow-y-auto p-6", className)} {...props} />
));
DrawerContent.displayName = "DrawerContent";

const DrawerFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-end gap-3 p-6 pt-4 border-t", className)}
    {...props}
  />
));
DrawerFooter.displayName = "DrawerFooter";

export { Drawer, DrawerHeader, DrawerTitle, DrawerDescription, DrawerContent, DrawerFooter };
