"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = {
  label: string;
  name: string;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
};

export function PasswordField({
  label,
  name,
  autoComplete,
  minLength,
  required = true,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const inputId = `password-${name}`;

  return (
    <div className="form-field">
      <label htmlFor={inputId}>{label}</label>
      <span className="password-control">
        <input
          id={inputId}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          className="password-toggle"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </span>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return <span className={`status-pill status-${status}`}>{text}</span>;
}

type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      returnFocusTo.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      confirmButton.current?.focus();
    } else {
      returnFocusTo.current?.focus();
      returnFocusTo.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
          if (event.key === "Tab") {
            const dialogButtons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
            if (dialogButtons.length < 2) return;
            const first = dialogButtons[0];
            const last = dialogButtons[dialogButtons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <span className={`dialog-symbol${destructive ? " dialog-symbol-danger" : ""}`} aria-hidden="true">
          {destructive ? "!" : "?"}
        </span>
        <h2 id="confirmation-title">{title}</h2>
        <p id="confirmation-description">{description}</p>
        <div className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={busy}>
            Go back
          </button>
          <button
            ref={confirmButton}
            className={`button ${destructive ? "button-danger" : "button-primary"}`}
            type="button"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
