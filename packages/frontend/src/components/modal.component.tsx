import { X } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  readonly title: string;
  /** Called for Escape, the close button and a click on the backdrop; ignored while `busy`. */
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Buttons, right-aligned under the content. */
  readonly footer?: ReactNode;
  /** True while an action is running: the dialog cannot be dismissed. */
  readonly busy?: boolean;
  readonly size?: 'md' | 'lg';
}

/**
 * A dialog over the page (confirmations, the request form, result lists).
 *
 * Hand-made on purpose: the app has no dialog library and a new dependency is not worth one component.
 * It does what a dialog must: `role="dialog"` with `aria-modal` and a label, Escape and the backdrop close
 * it (not while an action is running), focus moves in when it opens, Tab stays inside it, and focus returns
 * to what had it before.
 */
export function Modal({ title, onClose, children, footer, busy = false, size = 'md' }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], textarea, input, select');
    (first ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || panel.current === null) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-300 sm:items-center">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/50"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-full w-full flex-col rounded-lg border border-border bg-card text-card-foreground shadow-lg focus-visible:outline-none',
          size === 'lg' ? 'max-w-3xl' : 'max-w-lg'
        )}
      >
        <header className="flex items-start justify-between gap-300 border-b border-border px-400 py-300">
          <h2 id={titleId} className="min-w-0 break-words text-400 font-semibold">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="rounded-md p-100 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X aria-hidden="true" className="icon-size-300" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-400 py-300">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-end gap-200 border-t border-border px-400 py-300">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
