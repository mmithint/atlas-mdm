import { Moon, Sun, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';

import { useTheme } from '@/hooks/theme.context';

/**
 * The signed-in person at the foot of the navigation rail: their avatar opens a small menu with who they are and the
 * light or dark theme. It opens beside the rail (on a phone, as a sheet along the foot of the screen), closes on
 * Escape or a click outside, and gives focus back to the avatar.
 */
export function AccountMenu({ name, roleLine, initials, collapsed }: { name: string; roleLine: string; initials: string | null; collapsed: boolean }) {
  const { isDark, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstItem.current?.focus();
    const close = () => {
      setOpen(false);
      trigger.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const avatar = (
    <span aria-hidden="true" className="flex icon-size-600 shrink-0 items-center justify-center rounded-full bg-primary text-200 font-semibold text-primary-foreground">
      {initials ?? <UserRound className="icon-size-200" />}
    </span>
  );

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${name}, ${roleLine}`}
        title={collapsed ? `${name} · ${roleLine}` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'flex w-full min-w-0 items-center gap-200 rounded-md p-100 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          collapsed && 'justify-center'
        )}
      >
        {avatar}
        {collapsed ? null : (
          <span className="min-w-0">
            <span className="block truncate text-300 font-medium" aria-label="Signed in as">
              {name}
            </span>
            <span className="block truncate text-200 text-sidebar-muted" aria-label="Your roles">
              {roleLine}
            </span>
          </span>
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="fixed inset-x-400 bottom-400 z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-elevated md:absolute md:inset-x-auto md:bottom-0 md:left-full md:ml-300 md:w-64"
        >
          <div className="flex items-center gap-200 border-b border-border px-300 py-300">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-300 font-medium">{name}</p>
              <p className="truncate text-200 text-muted-foreground">{roleLine}</p>
            </div>
          </div>
          <div className="p-100">
            <button
              ref={firstItem}
              type="button"
              role="menuitem"
              onClick={toggleTheme}
              className="flex w-full items-center gap-200 rounded-md px-200 py-200 text-left text-300 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isDark ? <Sun aria-hidden="true" className="icon-size-300" /> : <Moon aria-hidden="true" className="icon-size-300" />}
              {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
