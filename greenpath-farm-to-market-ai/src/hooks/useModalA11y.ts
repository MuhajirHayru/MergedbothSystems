import { useEffect, useRef } from 'react';

/**
 * Minimal modal accessibility behaviour shared by every dashboard modal:
 * closes on Escape and moves keyboard focus to the panel when it opens
 * (WCAG 2.1 / 2.2 — keyboard operability and visible focus).
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(onClose: () => void) {
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return panelRef;
}
