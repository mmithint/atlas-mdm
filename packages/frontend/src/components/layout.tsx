import clsx from 'clsx';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { badge, card } from './ui';

/**
 * Page building blocks shared by the screens added for the APP-D preview and later phases (rules, field view,
 * scorecard, home): a page header, a titled panel, accessible tabs, and the table classes the built screens
 * already use (S-2, S-3).
 */

export const TABLE = 'w-full min-w-max border-collapse text-250 leading-250';
export const HEAD_ROW = 'bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground';
export const TH = 'px-300 py-200 font-semibold';
export const TD = 'px-300 py-200 align-top';
export const ROW = 'border-t border-divider hover:bg-row-hover';

export type Tone = 'neutral' | 'warning' | 'success' | 'info' | 'danger';

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={badge[tone]} title={title}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-300">
      <div className="min-w-0">
        <h1 className="break-words text-600 font-semibold">{title}</h1>
        {subtitle ? <p className="mt-100 max-w-3xl text-300 text-muted-foreground">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-200">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={clsx(card, 'p-400', className)}>
      <div className="flex flex-wrap items-start justify-between gap-200">
        <div className="min-w-0">
          <h2 id={id} className="text-400 font-semibold">
            {title}
          </h2>
          {hint ? <p className="mt-100 text-200 text-muted-foreground">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-200">{actions}</div> : null}
      </div>
      <div className="mt-300">{children}</div>
    </section>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
}

/** A row of tabs (WAI-ARIA tabs pattern): arrow keys move between them, the panel is labelled by the tab. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  children,
}: {
  tabs: readonly TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  children: ReactNode;
}) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    onChange(target.id);
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(`${base}-tab-${target.id}`)}`)?.focus();
  };
  return (
    <div>
      <div ref={list} role="tablist" aria-label={label} className="flex flex-wrap gap-100 border-b border-border" onKeyDown={onKey}>
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              id={`${base}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={clsx(
                '-mb-px border-b-2 px-300 py-200 text-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-ring font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="pt-400">
        {children}
      </div>
    </div>
  );
}

/** A label above a form control, with an optional hint and error under it. */
export function FormField({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-100">
      <label htmlFor={htmlFor} className="block text-300 font-medium">
        {label}
      </label>
      {children}
      {error ? <p className="text-200 text-destructive">{error}</p> : hint ? <p className="text-200 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
