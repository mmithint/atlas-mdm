import clsx from 'clsx';
import { CircleCheck, ClipboardCheck, Hourglass, Undo2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { card } from '@/components/ui';

import type { QueueCounts, QueueFacet } from './queue-api';
import { type QueueCriteria, type TabId } from './queue-model';

type Tone = 'warning' | 'info' | 'success';

/** The queues worth a number at a glance; the other tabs (rejected, mine) stay one click away in the tab strip. */
const CARDS: readonly { tab: TabId; countKey: keyof QueueCounts; label: string; hint: string; tone: Tone; icon: LucideIcon }[] = [
  { tab: 'RESPONSIBLE', countKey: 'responsible', label: 'First approval', hint: 'Responsible stage', tone: 'warning', icon: Hourglass },
  { tab: 'ACCOUNTABLE', countKey: 'accountable', label: 'Final approval', hint: 'Accountable stage', tone: 'warning', icon: ClipboardCheck },
  { tab: 'RETURNED', countKey: 'returned', label: 'Returned to me', hint: 'Needs correcting', tone: 'info', icon: Undo2 },
  { tab: 'APPROVED', countKey: 'approved', label: 'Approved', hint: 'Closed requests', tone: 'success', icon: CircleCheck },
];

/** The icon badge: a tint of the card's status colour (written out so Tailwind sees every class). */
const BADGE: Record<Tone, string> = {
  warning: 'bg-warning text-warning-foreground',
  info: 'bg-info text-info-foreground',
  success: 'bg-success text-success-foreground',
};

/** On a selected (navy) card the badge turns into a translucent white chip. */
const ON_SELECTED = 'group-aria-pressed:bg-card-selected-foreground/15 group-aria-pressed:text-card-selected-foreground';

const fmt = (n: number) => n.toLocaleString();

const BREAKDOWNS = [
  { kind: 'FIELD', label: 'Field', noun: 'field' },
  { kind: 'PROFIT_CENTER', label: 'Profit centre', noun: 'profit centre' },
] as const;
const TOP = 5;

/**
 * The summary above the queue: a card per queue (the number waiting, clicking opens that tab; the open tab is
 * the dark one) and a chart card that breaks the open tab down by field or profit centre. Clicking a bar applies
 * that value as the tab's filter, the same one as in Filters. Everything comes from the answer's counts and facets.
 */
export function ApprovalStats({
  counts,
  facets,
  criteria,
  onSelectTab,
  onChange,
}: {
  /** Null until the first answer arrives. */
  counts: QueueCounts | null;
  facets: readonly QueueFacet[];
  criteria: QueueCriteria;
  onSelectTab: (tab: TabId) => void;
  onChange: (next: QueueCriteria) => void;
}) {
  return (
    <section aria-label="Approvals summary" className="grid shrink-0 grid-cols-2 gap-300 sm:grid-cols-4 xl:grid-cols-6">
      {CARDS.map((c) => (
        <StatCard key={c.tab} def={c} count={counts ? counts[c.countKey] : null} active={criteria.tab === c.tab} onClick={() => onSelectTab(c.tab)} />
      ))}
      <Breakdown facets={facets} loading={counts === null} criteria={criteria} onChange={onChange} />
    </section>
  );
}

function StatCard({ def, count, active, onClick }: { def: (typeof CARDS)[number]; count: number | null; active: boolean; onClick: () => void }) {
  const Icon = def.icon;
  if (count === null) {
    return (
      <div className={`${card} flex animate-pulse flex-col gap-200 px-400 py-300 motion-reduce:animate-none`}>
        <span className="flex items-center justify-between">
          <span className="w-1/2 rounded-md bg-muted text-200">&nbsp;</span>
          <span className="icon-size-500 rounded-lg bg-muted" />
        </span>
        <span className="w-1/3 rounded-md bg-muted text-600 leading-600">&nbsp;</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${def.label}: ${fmt(count)}`}
      onClick={onClick}
      title={active ? `${def.label} is open` : `Open ${def.label.toLowerCase()}`}
      className={clsx(
        card,
        'group flex min-w-0 flex-col gap-100 px-400 py-300 text-left transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none',
        'hover:border-secondary-hover-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'aria-pressed:border-card-selected-border aria-pressed:bg-card-selected aria-pressed:hover:border-card-selected-border'
      )}
    >
      <span className="flex items-center justify-between gap-200">
        <span className="min-w-0 truncate text-200 font-medium text-muted-foreground group-aria-pressed:text-card-selected-muted">{def.label}</span>
        <span aria-hidden="true" className={clsx('flex icon-size-500 shrink-0 items-center justify-center rounded-lg', BADGE[def.tone], ON_SELECTED)}>
          <Icon className="icon-size-200" />
        </span>
      </span>
      <span className="flex min-w-0 items-baseline gap-200">
        <span className="text-600 font-semibold leading-600 group-aria-pressed:text-card-selected-foreground">{fmt(count)}</span>
        <span className="min-w-0 truncate text-200 text-muted-foreground group-aria-pressed:text-card-selected-muted">{def.hint}</span>
      </span>
    </button>
  );
}

/** The open tab's requests by field or profit centre: ranked bars in one hue, the number beside each (not colour alone). */
function Breakdown({ facets, loading, criteria, onChange }: { facets: readonly QueueFacet[]; loading: boolean; criteria: QueueCriteria; onChange: (next: QueueCriteria) => void }) {
  const [kind, setKind] = useState<(typeof BREAKDOWNS)[number]['kind']>('FIELD');
  const by = BREAKDOWNS.find((b) => b.kind === kind) ?? BREAKDOWNS[0];
  const current = kind === 'FIELD' ? criteria.fieldCode : criteria.profitCenter;
  const rows = facets
    .filter((f) => f.kind === kind)
    .map((f) => ({ value: f.value, label: f.label || f.value, n: f.n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const shown = rows.slice(0, TOP);
  // A value in the address stays visible even when it is not among the biggest.
  const picked = rows.find((r) => r.value === current);
  if (picked && !shown.includes(picked)) shown[TOP - 1] = picked;
  const max = Math.max(1, ...shown.map((r) => r.n));
  const apply = (value: string) => onChange(kind === 'FIELD' ? { ...criteria, fieldCode: value === current ? '' : value } : { ...criteria, profitCenter: value === current ? '' : value });

  return (
    <figure className={`${card} col-span-full flex min-w-0 flex-col gap-200 px-400 py-300 xl:col-span-2`}>
      <figcaption className="flex items-center justify-between gap-200">
        <span className="text-200 font-medium text-muted-foreground">In this tab, by {by.noun}</span>
        <span role="group" aria-label="Break down by" className="flex gap-100">
          {BREAKDOWNS.map((b) => (
            <button
              key={b.kind}
              type="button"
              aria-pressed={b.kind === kind}
              onClick={() => setKind(b.kind)}
              className="rounded-md px-200 py-100 text-200 font-medium text-muted-foreground hover:bg-hover-overlay hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {b.label}
            </button>
          ))}
        </span>
      </figcaption>
      {loading ? (
        <p className="py-300 text-200 text-muted-foreground">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="py-300 text-200 text-muted-foreground">No requests in this tab to break down.</p>
      ) : (
        <ul className="space-y-100">
          {shown.map((r) => (
            <li key={r.value}>
              <button
                type="button"
                aria-pressed={r.value === current}
                aria-label={`${r.label}: ${r.n}. ${r.value === current ? 'Remove this filter' : 'Show only these'}`}
                onClick={() => apply(r.value)}
                className="grid w-full grid-cols-[minmax(0,7rem)_1fr_1.5rem] items-center gap-200 rounded-md px-100 py-100 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-info"
              >
                <span className="truncate text-200 text-muted-foreground" title={r.label}>
                  {r.label}
                </span>
                <span aria-hidden="true" className="h-200 rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${(r.n / max) * 100}%`, minWidth: '4px' }} />
                </span>
                <span aria-hidden="true" className="text-right text-200 font-semibold tabular-nums">
                  {r.n}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > TOP ? <p className="text-200 text-muted-foreground">+{rows.length - TOP} more in Filters</p> : null}
    </figure>
  );
}
