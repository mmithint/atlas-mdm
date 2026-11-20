import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { button } from '@/components/ui';

/**
 * A button that opens a small panel under it. The panel stays open while a person works inside it and
 * closes on Escape (focus returns to the button) or a click anywhere outside. It is not modal, so the
 * page behind it stays usable.
 */
export function Popover({
  label,
  icon,
  count = 0,
  children,
}: {
  /** The button's text, also the panel's accessible name. */
  label: string;
  icon?: ReactNode;
  /** A number shown on the button, such as the filters in use; hidden at zero. */
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        className={button.small}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
        {count > 0 ? (
          <span className="rounded-sm bg-primary px-100 text-200 text-primary-foreground">
            {count}
            <span className="sr-only"> in use</span>
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className="absolute right-0 z-20 mt-100 w-64 rounded-md border border-border bg-card p-300 shadow-lg"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
