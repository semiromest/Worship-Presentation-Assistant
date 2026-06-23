import { useEffect, useRef, useCallback, type ReactNode } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
  closeOnEscape?: boolean;
  closeOnOverlayClick?: boolean;
}

export default function Dialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
  className,
  overlayClassName,
  closeOnEscape = true,
  closeOnOverlayClick = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocus.current = document.activeElement as HTMLElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusable[0] ?? panel;
      first.focus();
    });

    return () => {
      document.body.style.overflow = prevOverflow;
      previousFocus.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [open, closeOnEscape, onClose]);

  // Global focus trap: pull focus back if it escapes the modal
  useEffect(() => {
    if (!open) return;

    const handler = (e: FocusEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      if (e.target instanceof Node && !panel.contains(e.target)) {
        e.stopPropagation();
        const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        const first = focusable[0] ?? panel;
        first.focus();
      }
    };

    document.addEventListener('focusin', handler, true);
    return () => document.removeEventListener('focusin', handler, true);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panelRef.current) return;

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => !el.hasAttribute('disabled'));

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className={
        overlayClassName ??
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      }
      role="presentation"
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={className}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
