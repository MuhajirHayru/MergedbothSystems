"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "./button";
import { Modal, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from "./modal";

/**
 * ConfirmDialog — replaces `window.confirm` with a calm, keyboard-friendly
 * dialog. Financial actions should pass an explicit `confirmLabel` that names
 * the operation (for example "Release funds") so the consequence is clear.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onOpenChange={(next) => (next ? undefined : onClose())} size="sm">
      <ModalHeader onClose={loading ? undefined : onClose}>
        <div className="flex items-start gap-3">
          {tone === "destructive" ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
          ) : null}
          <div>
            <ModalTitle>{title}</ModalTitle>
            {description ? <ModalDescription>{description}</ModalDescription> : null}
          </div>
        </div>
      </ModalHeader>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "destructive" ? "destructive" : "primary"}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
