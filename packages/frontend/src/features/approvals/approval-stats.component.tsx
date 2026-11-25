import clsx from 'clsx';

import { card } from '@/components/ui';
import { StatIllustration } from '@/features/equipment/stat-illustrations';

import type { QueueCounts } from './queue-api';
import { type QueueCriteria, type TabId } from './queue-model';

type Tone = 'warning' | 'info' | 'success';

/** The queues worth a number at a glance; the other tabs (rejected, mine) stay one click away in the tab strip. */
const CARDS: readonly { tab: TabId; countKey: keyof QueueCounts; label: string; hint: string; tone: Tone; art: string; open: boolean }[] = [
  { tab: 'RESPONSIBLE', countKey: 'responsible', label: 'First approval', hint: 'Responsible stage', tone: 'warning', art: 'open', open: true },
  { tab: 'ACCOUNTABLE', countKey: 'accountable', label: 'Final approval', hint: 'Accountable stage', tone: 'warning', art: 'verified', open: true },
  { tab: 'RETURNED', countKey: 'returned', label: 'Returned to me', hint: 'Needs correcting', tone: 'info', art: 'returned', open: true },
  { tab: 'APPROVED', countKey: 'approved', label: 'Approved', hint: 'Closed requests', tone: 'success', art: 'approved', open: false },
];

/** The icon badge and the share pill: tinted in the card's status colour (written out so Tailwind sees every class). */
const BADGE: Record<Tone, string> = {
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  success: 'bg-success text-success-foreground',
};

/** On a selected (navy) card the badge and the pill turn into translucent white chips. */
const ON_SELECTED = 'group-aria-pressed:bg-card-selected-foreground/15 group-aria-pressed:text-card-selected-foreground';

const fmt = (n: number) => n.toLocaleString();

/**
 * The summary above the queue: a card per queue (the number waiting; clicking opens that tab, and the open tab is
 * the dark one). Everything comes from the answer's counts.
 */
export function ApprovalStats({
  counts,
  criteria,
  onSelectTab,
}: {
  /** Null until the first answer arrives. */
  counts: QueueCounts | null;
  criteria: QueueCriteria;
  onSelectTab: (tab: TabId) => void;
}) {
  const openTotal = counts ? counts.responsible + counts.accountable + counts.returned : 0;
  return (
    <section aria-label="Approvals summary" className="grid shrink-0 grid-cols-2 gap-300 lg:grid-cols-4">
      {CARDS.map((c) => (
        <StatCard
          key={c.tab}
          def={c}
          count={counts ? counts[c.countKey] : null}
          // The open queues show their share of everything waiting (stage 1, stage 2 and returned together).
          share={counts && c.open && openTotal > 0 ? Math.round((counts[c.countKey] / openTotal) * 100) : null}
          active={criteria.tab === c.tab}
          onClick={() => onSelectTab(c.tab)}
        />
      ))}
    </section>
  );
}

function StatCard({ def, count, share, active, onClick }: { def: (typeof CARDS)[number]; count: number | null; share: number | null; active: boolean; onClick: () => void }) {
  if (count === null) {
    return (
      <div className={`${card} flex animate-pulse flex-col gap-200 px-400 py-300 motion-reduce:animate-none`}>
        <span className="flex items-start justify-between gap-200">
          <span className="icon-size-500 rounded-badge bg-muted" />
          <span className="w-1/4 rounded-lg bg-muted text-200 leading-200">&nbsp;</span>
        </span>
        <span className="flex flex-col gap-100">
          <span className="w-1/2 rounded-md bg-muted text-200 leading-200">&nbsp;</span>
          <span className="w-2/3 rounded-md bg-muted text-600 leading-600">&nbsp;</span>
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${def.label}: ${fmt(count)}${share !== null ? ` (${share}% of open work)` : ''}`}
      onClick={onClick}
      title={active ? `${def.label} is open` : `Open ${def.label.toLowerCase()}`}
      className={clsx(
        card,
        'group relative isolate flex min-w-0 flex-col gap-200 overflow-hidden px-400 py-300 text-left transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
        'hover:border-secondary-hover-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'aria-pressed:border-card-selected-border aria-pressed:bg-card-selected aria-pressed:hover:border-card-selected-border'
      )}
    >
      {/* The same drawing, large, faint and tilted, coming in from the corner: a watermark, like the Equipment cards. */}
      <StatIllustration id={def.art} tone={def.tone} onSelected={active} className="pointer-events-none absolute -bottom-400 -right-300 -z-10 w-20 origin-bottom-right -rotate-12 text-foreground opacity-10 group-aria-pressed:text-card-selected-foreground group-aria-pressed:opacity-20" />

      <span className="flex items-start justify-between gap-200">
        <span aria-hidden="true" className={clsx('flex icon-size-500 shrink-0 items-center justify-center rounded-badge', BADGE[def.tone], ON_SELECTED)}>
          <StatIllustration id={def.art} tone={def.tone} onSelected={active} className="icon-size-300" />
        </span>
        {share !== null ? <span className={clsx('rounded-lg px-200 py-100 text-200 font-medium leading-200', BADGE[def.tone], ON_SELECTED)}>{share}%</span> : null}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="truncate text-200 font-medium leading-200 text-muted-foreground group-aria-pressed:text-card-selected-muted">{def.label}</span>
        <span className="flex min-w-0 items-baseline gap-200">
          <span className="text-600 font-semibold leading-600 group-aria-pressed:text-card-selected-foreground">{fmt(count)}</span>
          <span className="min-w-0 truncate text-200 text-muted-foreground group-aria-pressed:text-card-selected-muted">{def.hint}</span>
        </span>
      </span>
    </button>
  );
}
