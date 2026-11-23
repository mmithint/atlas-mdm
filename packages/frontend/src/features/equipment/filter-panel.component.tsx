import { ChevronDown, ListFilter, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { button, inputCompact } from '@/components/ui';

import { FACETS, cleared, facetOptions, facetUseful, selectedCount, toggled, type Facet, type FacetOption, type Selection } from './facets';
import { MAX_FILTERED_ROWS, type AllRows } from './use-filtered-search';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A square icon-only button; its name is the aria-label, and the title shows it on hover. */
const ICON_BUTTON =
  'inline-flex h-800 w-800 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-hover-overlay hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none';

/** A facet with more options than this gets a search box. */
const SEARCH_FROM = 8;
/** Facets open when the panel opens (the rest open on a click), plus any with ticked values. */
const OPEN_AT_START = 6;

export interface FilterPanelProps {
  id: string;
  /** True below the large breakpoint: the panel floats over the page instead of sitting beside the table. */
  overlay: boolean;
  /** Every row of the search: what the checkboxes list and count. */
  all: AllRows;
  selection: Selection;
  /** Heaters that pass the ticked values, once known. */
  matchCount: number | null;
  onChange: (selection: Selection) => void;
  onClose: () => void;
  /** Shown above the checkboxes: the saved filters. */
  top?: ReactNode;
}

/**
 * The Filter panel of screen S-4: a list of checkboxes for each field, as on a shop's filter.
 * Ticking a value filters the table at once; values of one field widen the list, fields narrow it.
 * Beside the table on a wide screen; over the page, as a dialog, on a smaller one.
 */
export function FilterPanel({ id, overlay, all, selection, matchCount, onChange, onClose, top }: FilterPanelProps) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const count = selectedCount(selection);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const rows = all.status === 'ready' ? all.rows : null;
  const facets = useMemo(
    () =>
      rows === null
        ? []
        : FACETS.map((facet) => ({ facet, options: facetOptions(rows, facet, selection) })).filter((f) => facetUseful(f.options)),
    [rows, selection]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    // As a dialog, Tab stays inside the panel.
    if (!overlay || event.key !== 'Tab' || panel.current === null) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const head = items[0];
    const tail = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === head || document.activeElement === heading.current)) {
      event.preventDefault();
      tail?.focus();
    } else if (!event.shiftKey && document.activeElement === tail) {
      event.preventDefault();
      head?.focus();
    }
  };

  const body = (
    <aside
      ref={panel}
      id={id}
      aria-labelledby={titleId}
      {...(overlay ? { role: 'dialog', 'aria-modal': true } : {})}
      onKeyDown={onKeyDown}
      className={clsx(
        'flex flex-col bg-card text-card-foreground',
        overlay
          ? 'fixed inset-y-0 right-0 z-40 w-full max-w-sm border-l border-border shadow-elevated'
          : 'w-filter-panel shrink-0 self-stretch overflow-hidden rounded-lg border border-border md:max-h-full'
      )}
    >
      <header className="flex shrink-0 items-center gap-200 border-b border-border px-400 py-300">
        <ListFilter aria-hidden="true" className="icon-size-200 text-muted-foreground" />
        <h2 id={titleId} ref={heading} tabIndex={-1} className="flex-1 text-400 font-semibold focus:outline-none">
          Filters
        </h2>
        {count > 0 ? (
          <button type="button" className={button.ghost} onClick={() => onChange({})}>
            Clear all
          </button>
        ) : null}
        <button type="button" className={ICON_BUTTON} onClick={onClose} aria-label="Close filters" title="Close filters">
          <X aria-hidden="true" className="icon-size-200" />
        </button>
      </header>

      {top}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {all.status === 'loading' || all.status === 'idle' ? (
          <div className="p-400">
            <LoadingState rows={6} label="Loading the filter values" />
          </div>
        ) : null}
        {all.status === 'error' ? (
          <div className="p-400">
            <ErrorState title="The filter values could not be loaded" message={all.message} onRetry={all.retry} />
          </div>
        ) : null}
        {all.status === 'too-many' ? (
          <div className="p-400">
            <EmptyState
              title="Too many heaters to filter"
              hint={`The filters work on up to ${MAX_FILTERED_ROWS.toLocaleString()} heaters at a time, and this search matches ${all.total.toLocaleString()}. Narrow it first with a box under a column header or a facility.`}
            />
          </div>
        ) : null}
        {all.status === 'ready' && facets.length === 0 ? (
          <div className="p-400">
            <EmptyState title="Nothing to filter" hint="Every heater in this search has the same values, so there is nothing to choose between." />
          </div>
        ) : null}
        {facets.map(({ facet, options }, i) => (
          <FacetSection
            key={facet.id}
            panelId={id}
            facet={facet}
            options={options}
            startOpen={i < OPEN_AT_START || options.some((o) => o.checked)}
            onToggle={(value) => onChange(toggled(selection, facet.id, value))}
            onClear={() => onChange(cleared(selection, facet.id))}
          />
        ))}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-300 border-t border-border px-400 py-300">
        <p className="text-200 text-muted-foreground" aria-live="polite">
          {count === 0
            ? 'Tick values to filter the list.'
            : matchCount === null
              ? `${count} selected`
              : `${matchCount} ${matchCount === 1 ? 'heater matches' : 'heaters match'}`}
        </p>
        {overlay ? (
          <button type="button" className={button.primary} onClick={onClose}>
            {matchCount === null || count === 0 ? 'Show heaters' : `Show ${matchCount} ${matchCount === 1 ? 'heater' : 'heaters'}`}
          </button>
        ) : null}
      </footer>
    </aside>
  );

  if (!overlay) return body;
  return (
    <>
      <button type="button" aria-label="Close filters" tabIndex={-1} className="fixed inset-0 z-30 bg-mask" onClick={onClose} />
      {body}
    </>
  );
}

function FacetSection({
  panelId,
  facet,
  options,
  startOpen,
  onToggle,
  onClear,
}: {
  panelId: string;
  facet: Facet;
  options: readonly FacetOption[];
  startOpen: boolean;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [query, setQuery] = useState('');
  const listId = `${panelId}-${facet.id}-options`;
  const ticked = options.filter((o) => o.checked).length;
  const needle = query.trim().toLowerCase();
  const shown = needle === '' ? options : options.filter((o) => o.checked || o.label.toLowerCase().includes(needle));

  return (
    <section className="border-b border-divider px-400 py-300 last:border-b-0">
      <div className="flex items-center gap-200">
        <button
          type="button"
          className="flex flex-1 items-center gap-200 rounded-md text-left text-300 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown aria-hidden="true" className={clsx('icon-size-200 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', open ? '' : '-rotate-90')} />
          <span className="flex-1">{facet.label}</span>
          {ticked > 0 ? <span className="text-200 font-normal text-muted-foreground">{ticked} selected</span> : null}
        </button>
        {ticked > 0 ? (
          <button type="button" className="text-200 font-medium text-link hover:text-link-hover hover:underline" onClick={onClear} aria-label={`Clear ${facet.label}`}>
            Clear
          </button>
        ) : null}
      </div>

      {open ? (
        <div id={listId} className="mt-200 space-y-200">
          {options.length > SEARCH_FROM ? (
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-200 top-1/2 icon-size-100 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label={`Search ${facet.label}`}
                placeholder={`Search ${facet.label.toLowerCase()}`}
                className={`${inputCompact} pl-600`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />
            </div>
          ) : null}
          <ul className="max-h-facet-list space-y-100 overflow-y-auto" aria-label={facet.label}>
            {shown.map((o, i) => {
              const boxId = `${listId}-${i}`;
              const none = o.count === 0 && !o.checked;
              return (
                <li key={o.value}>
                  <label
                    htmlFor={boxId}
                    className={clsx('flex items-center gap-200 rounded-md px-100 py-100 text-300', none ? 'cursor-not-allowed text-disabled-foreground' : 'cursor-pointer hover:bg-hover')}
                  >
                    <input
                      id={boxId}
                      type="checkbox"
                      aria-label={`${o.label} (${o.count})`}
                      className="icon-size-200 shrink-0 accent-primary"
                      checked={o.checked}
                      disabled={none}
                      onChange={() => onToggle(o.value)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={o.label}>
                      {o.label}
                    </span>
                    <span className="shrink-0 text-200 tabular-nums text-muted-foreground">{o.count}</span>
                  </label>
                </li>
              );
            })}
            {shown.length === 0 ? <li className="px-100 py-100 text-200 text-muted-foreground">No {facet.label.toLowerCase()} matches “{query}”.</li> : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
