import clsx from 'clsx';

import { card } from '@/components/ui';

import type { Selection } from './facets';
import { StatIllustration } from './stat-illustrations';
import { STATS, selectionAfterClick, statValues, type StatTone, type StatValue } from './stats';
import type { AllRows } from './use-filtered-search';

/** The icon badge and the share pill: tinted in the card's status colour (written out so Tailwind sees each class). */
const PILL: Record<StatTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  danger: 'bg-danger-bg text-danger-text',
};

/** The badge and the pill on a selected (navy) card. Variants come after the tone classes in the CSS, so they win. */
const ON_SELECTED = 'group-aria-pressed:bg-card-selected-foreground/15 group-aria-pressed:text-card-selected-foreground';

const fmt = (n: number) => n.toLocaleString();

/**
 * The metric cards above the Equipment table: a big number, what it counts, and an icon badge. They are
 * worked out from every row of the current search and the ticked filters, so they follow every change;
 * clicking a card applies its filter (the same one as in the Filter panel), clicking it again removes it.
 */
export function StatCards({
  all,
  serverTotal,
  selection,
  onChange,
}: {
  /** Every row of the search (see use-filtered-search.ts). */
  all: AllRows;
  /** The search's own count, which is known even when there are too many rows to count the rest. */
  serverTotal: number | null;
  selection: Selection;
  onChange: (selection: Selection) => void;
}) {
  if (all.status === 'idle' || all.status === 'loading') {
    return (
      <div className="grid shrink-0 grid-cols-2 gap-300 sm:grid-cols-3 xl:grid-cols-5" aria-busy="true" aria-label="Loading the equipment summary">
        {/* Same sizes as a real card, so nothing moves when the numbers arrive. */}
        {STATS.map((s) => (
          <div key={s.id} className={`${card} flex animate-pulse flex-col gap-200 px-400 py-300 motion-reduce:animate-none`}>
            <span className="flex items-start justify-between gap-200">
              <span className="icon-size-500 rounded-badge bg-muted" />
              <span className="w-1/4 rounded-lg bg-muted text-200 leading-200">&nbsp;</span>
            </span>
            <span className="flex flex-col gap-100">
              <span className="w-1/2 rounded-md bg-muted text-200 leading-200">&nbsp;</span>
              <span className="w-2/3 rounded-md bg-muted text-600 leading-600">&nbsp;</span>
            </span>
          </div>
        ))}
      </div>
    );
  }

  const values: StatValue[] =
    all.status === 'ready'
      ? statValues(all.rows, selection)
      : STATS.map((def) => ({ def, count: def.id === 'all' && serverTotal !== null ? serverTotal : NaN, of: NaN, active: false }));
  const unavailable = all.status !== 'ready';

  return (
    <section aria-label="Equipment summary" className="shrink-0 space-y-200">
      <div className="grid grid-cols-2 gap-300 sm:grid-cols-3 xl:grid-cols-5">
        {values.map((v) => (
          <StatCard
            key={v.def.id}
            value={v}
            disabled={unavailable}
            empty={all.status === 'ready' && all.rows.length === 0}
            onClick={() => onChange(selectionAfterClick(v.def, selection))}
          />
        ))}
      </div>
      {all.status === 'too-many' ? (
        <p className="text-200 text-muted-foreground">This search is too large to summarise. Narrow it with a box under a column header or a facility to see the other figures.</p>
      ) : null}
      {all.status === 'error' ? (
        <p className="text-200 text-destructive">
          The summary could not be worked out: {all.message}{' '}
          <button type="button" className="font-medium text-link underline-offset-2 hover:underline" onClick={all.retry}>
            Try again
          </button>
        </p>
      ) : null}
    </section>
  );
}

function StatCard({ value, disabled, empty, onClick }: { value: StatValue; disabled: boolean; empty: boolean; onClick: () => void }) {
  const { def, count, of, active } = value;
  const known = Number.isFinite(count);
  const isTotal = def.facetId === undefined;
  const share = known && !isTotal && of > 0 ? Math.round((count / of) * 100) : null;

  // What sits beside the number, and the card's full name for screen readers.
  let context: string;
  if (!known) context = 'Narrow the search to see';
  else if (empty) context = 'none in this search';
  else if (isTotal) context = active ? 'in this search' : `of ${fmt(of)}, filtered`;
  else context = `of ${fmt(of)}`;
  const name = `${def.label}: ${known ? fmt(count) : 'not available'}${known && !isTotal && !empty ? ` of ${fmt(of)}` : ''}${share !== null ? ` (${share}%)` : ''}`;

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={name}
      disabled={disabled && !(isTotal && known)}
      onClick={onClick}
      title={isTotal ? 'Show every heater in this search' : active ? `Remove the "${def.label}" filter` : `Show only heaters ${def.label.toLowerCase()}`}
      className={clsx(
        card,
        'group relative isolate flex min-w-0 flex-col gap-200 overflow-hidden px-400 py-300 text-left transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
        'hover:border-secondary-hover-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:hover:border-border',
        // Selected: a dark shade of the primary blue, with light text (tokens: --color-card-selected*).
        'aria-pressed:border-card-selected-border aria-pressed:bg-card-selected aria-pressed:hover:border-card-selected-border'
      )}
    >
      {/* The same drawing, large, faint and tilted, coming in from the corner: a watermark, like the reference cards. */}
      <StatIllustration id={def.id} tone={def.tone} onSelected={active} className="pointer-events-none absolute -bottom-400 -right-300 -z-10 w-20 origin-bottom-right -rotate-12 text-foreground opacity-10 group-aria-pressed:text-card-selected-foreground group-aria-pressed:opacity-20" />

      <span className="flex items-start justify-between gap-200">
        {/* The icon badge: the drawing, small, on a tint of the card's status colour; on a selected (navy) card
            the badge and the pill turn into translucent white chips with white and light-blue marks. */}
        <span aria-hidden="true" className={clsx('flex icon-size-500 shrink-0 items-center justify-center rounded-badge', PILL[def.tone], ON_SELECTED)}>
          <StatIllustration id={def.id} tone={def.tone} onSelected={active} className="icon-size-300" />
        </span>
        {share !== null ? <span className={clsx('rounded-lg px-200 py-100 text-200 font-medium leading-200', PILL[def.tone], ON_SELECTED)}>{share}%</span> : null}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="truncate text-200 font-medium leading-200 text-muted-foreground group-aria-pressed:text-card-selected-muted">{def.label}</span>
        <span className="flex min-w-0 items-baseline gap-200">
          <span className="text-600 font-semibold leading-600 text-foreground group-aria-pressed:text-card-selected-foreground">{known ? fmt(count) : '—'}</span>
          <span className="min-w-0 truncate text-200 text-muted-foreground group-aria-pressed:text-card-selected-muted">{context}</span>
        </span>
      </span>
    </button>
  );
}
