/**
 * The rules of screen S-2 (Approvals) that need no React and no network, so they can be tested on
 * their own: the six tabs, what the address holds, how a row is described, and how rows are selected
 * for a bulk approval.
 *
 * Which request belongs to which tab, who may decide it, and the order of the list are all decided in
 * T-SQL (`app.usp_request_queue`); nothing here re-implements them. This file only turns what the
 * server answered into words and into the address bar.
 */
import type { BulkResultRow, QueueFacet, QueueRow } from './queue-api';

// ---- the six tabs -----------------------------------------------------------------------

export type TabId = 'RESPONSIBLE' | 'ACCOUNTABLE' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'MY_REQUESTS';

/** The key of the tab's number in the answer's `counts`. */
export type CountKey = 'responsible' | 'accountable' | 'returned' | 'approved' | 'rejected' | 'mine';

export interface TabDef {
  id: TabId;
  label: string;
  countKey: CountKey;
  /** The two tabs where a person acts: they show checkboxes and the bulk button. */
  pending: boolean;
  /**
   * False where the age filter means nothing: it counts the hours a request has been OPEN, and an approved
   * or rejected request is closed. The server ignores it there, so the screen disables it and never sends it.
   */
  ageApplies: boolean;
  emptyTitle: string;
  /** Starts with the client's own wording from the compressor queue (REF-16). */
  emptyHint: string;
}

const NONE_FOR_USER = 'No requests match this tab for the logged-in user.';

export const QUEUE_TABS: readonly TabDef[] = [
  {
    id: 'RESPONSIBLE',
    label: 'My Responsible',
    countKey: 'responsible',
    pending: true,
    ageApplies: true,
    emptyTitle: 'Nothing waiting for your first approval',
    emptyHint: `${NONE_FOR_USER} A request appears here when it is routed to a group you belong to and needs the first, responsible, approval.`,
  },
  {
    id: 'ACCOUNTABLE',
    label: 'My Accountable',
    countKey: 'accountable',
    pending: true,
    ageApplies: true,
    emptyTitle: 'Nothing waiting for your final approval',
    emptyHint: `${NONE_FOR_USER} A request appears here after the responsible stage approved it and it is routed to a group you belong to.`,
  },
  {
    id: 'RETURNED',
    label: 'Returned to me',
    countKey: 'returned',
    pending: false,
    ageApplies: true,
    emptyTitle: 'Nothing has been returned to you',
    emptyHint: `${NONE_FOR_USER} An approver returns a request with a comment when it needs correcting; it then appears here for the person or group it went back to.`,
  },
  {
    id: 'APPROVED',
    label: 'Approved',
    countKey: 'approved',
    pending: false,
    ageApplies: false,
    emptyTitle: 'No approved requests yet',
    emptyHint: 'Requests approved at both stages are listed here. Everyone can see them.',
  },
  {
    id: 'REJECTED',
    label: 'Rejected',
    countKey: 'rejected',
    pending: false,
    ageApplies: false,
    emptyTitle: 'No rejected requests',
    emptyHint: 'Requests an approver rejected, with the reason, are listed here. Everyone can see them.',
  },
  {
    id: 'MY_REQUESTS',
    label: 'My Requests',
    countKey: 'mine',
    pending: false,
    ageApplies: true,
    emptyTitle: 'You have not raised any requests',
    emptyHint: `${NONE_FOR_USER} Open a heater and choose Request change to propose a change; your requests, in any status, are listed here.`,
  },
];

export const DEFAULT_TAB: TabId = 'RESPONSIBLE';

/** The tab for an address value; anything unknown is the first tab. */
export function tabById(value: string | null | undefined): TabDef {
  return QUEUE_TABS.find((t) => t.id === value) ?? (QUEUE_TABS[0] as TabDef);
}

// ---- what the person asked for (the address bar) ----------------------------------------

export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
/** The most requests one bulk approval may name (the function refuses more). */
export const BULK_LIMIT = 100;

export interface AgeOption {
  /** Sent as `minAgeHours`; 0 = any age. */
  hours: number;
  label: string;
}

export const AGE_OPTIONS: readonly AgeOption[] = [
  { hours: 0, label: 'Any age' },
  { hours: 24, label: 'Over 1 day' },
  { hours: 72, label: 'Over 3 days' },
  { hours: 168, label: 'Over 7 days' },
];

/** What the address holds. The row offset is deliberately NOT here: a pasted link opens page 1. */
export interface QueueCriteria {
  tab: TabId;
  /** Empty = no filter, like the three below. */
  profitCenter: string;
  fieldCode: string;
  ruleId: string;
  /** 0 = any age. */
  minAgeHours: number;
  /** Only requests that carry a note (the "TBD" ones). */
  noteOnly: boolean;
  pageSize: number;
}

/** Reads the criteria from the address query; anything unreadable falls back to a default. */
export function criteriaFromQuery(query: URLSearchParams): QueueCriteria {
  const tab = tabById(query.get('tab'));
  const age = Number(query.get('age'));
  const size = Number(query.get('size'));
  return {
    tab: tab.id,
    profitCenter: (query.get('pc') ?? '').trim(),
    fieldCode: (query.get('field') ?? '').trim(),
    ruleId: (query.get('rule') ?? '').trim(),
    // A pasted link may carry an age on a tab where it means nothing: it is dropped, not kept hidden.
    minAgeHours: tab.ageApplies && AGE_OPTIONS.some((o) => o.hours === age) ? age : 0,
    noteOnly: query.get('note') === '1',
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** The address query for the criteria; values that equal the default are left out. */
export function queryFromCriteria(c: QueueCriteria): Record<string, string | undefined> {
  return {
    tab: c.tab === DEFAULT_TAB ? undefined : c.tab,
    pc: c.profitCenter || undefined,
    field: c.fieldCode || undefined,
    rule: c.ruleId || undefined,
    age: c.minAgeHours > 0 ? String(c.minAgeHours) : undefined,
    note: c.noteOnly ? '1' : undefined,
    size: c.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(c.pageSize),
  };
}

/** One key for everything that changes the list; the page position is kept apart from it. */
export const criteriaKey = (c: QueueCriteria): string =>
  [c.tab, c.profitCenter, c.fieldCode, c.ruleId, c.minAgeHours, c.noteOnly ? 1 : 0, c.pageSize].join('|');

export const hasFilters = (c: QueueCriteria): boolean => filterCount(c) > 0;

/** How many of the filters are in use (shown on the filter button). */
export const filterCount = (c: QueueCriteria): number =>
  [c.profitCenter !== '', c.fieldCode !== '', c.ruleId !== '', c.minAgeHours > 0, c.noteOnly].filter(Boolean).length;

/** The same tab and page size with no filter. */
export const withoutFilters = (c: QueueCriteria): QueueCriteria => ({
  ...c,
  profitCenter: '',
  fieldCode: '',
  ruleId: '',
  minAgeHours: 0,
  noteOnly: false,
});

/**
 * Another tab starts with no filter: the filter choices (profit centres, fields, rules) come from the
 * tab's own rows, so a choice made on one tab could hide every row of the next.
 */
export const switchTab = (c: QueueCriteria, tab: TabId): QueueCriteria => ({ ...withoutFilters(c), tab });

// ---- the three filter lists -------------------------------------------------------------

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * The choices of one filter, from the answer's `facets` (the distinct values of the tab's rows). The
 * value now in the address is always offered, even when the tab has no such row, so the control never
 * shows a value that is not its own.
 */
export function facetOptions(facets: readonly QueueFacet[], kind: string, current: string): FilterOption[] {
  const options = facets
    .filter((f) => f.kind === kind)
    .map((f) => ({ value: f.value, label: `${f.label || f.value} (${f.n})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (current !== '' && !options.some((o) => o.value === current)) options.push({ value: current, label: current });
  return options;
}

// ---- how a row is described -------------------------------------------------------------

export type Tone = 'neutral' | 'warning' | 'success' | 'info';

const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING_RESPONSIBLE: { label: 'Awaiting responsible', tone: 'warning' },
  PENDING_ACCOUNTABLE: { label: 'Awaiting accountable', tone: 'warning' },
  RETURNED: { label: 'Returned', tone: 'info' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'neutral' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
};

export function statusView(status: string): { label: string; tone: Tone } {
  return STATUS[status] ?? { label: status.toLowerCase().replace(/_/g, ' '), tone: 'neutral' };
}

/** Hours open as people read it: "5 h" up to two days, then "3 d"; a closed request has none. */
export function ageText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours) || hours < 0) return '';
  if (hours < 1) return '<1 h';
  if (hours < 48) return `${Math.floor(hours)} h`;
  return `${Math.floor(hours / 24)} d`;
}

type SourceInput = Pick<QueueRow, 'sourceLabel' | 'sourceType' | 'requestedBy'>;

/**
 * Where the request came from: the label ("Rule HEATER_DUTY v2", "Field submission") and, for a person's
 * request, who submitted it. A request raised by the system (a rule run, an import) has no submitter to
 * show: its label already says which.
 */
export function sourceView(row: SourceInput): { label: string; by: string | null } {
  const system = row.requestedBy.toLowerCase().startsWith('system:');
  return { label: row.sourceLabel, by: system || row.sourceType === 'BUSINESS_RULE' ? null : row.requestedBy };
}

type TimeInput = Pick<QueueRow, 'sourceType' | 'detectedAtUtc' | 'requestedAtUtc'>;

/** The time to show: when the rule found it (rule requests) or when the person submitted it. */
export function timeView(row: TimeInput): { label: 'Detected' | 'Submitted'; iso: string | null } {
  if (row.sourceType === 'BUSINESS_RULE' && row.detectedAtUtc) return { label: 'Detected', iso: row.detectedAtUtc };
  return { label: 'Submitted', iso: row.requestedAtUtc };
}

/** "TBD" is a badge (PTD-06: fired / unfired is flagged to be decided); any other note is plain text. */
export function noteView(note: string | null | undefined): { tbd: boolean; text: string } | null {
  const text = (note ?? '').trim();
  if (text === '') return null;
  return { tbd: text.toUpperCase() === 'TBD', text };
}

// ---- selecting rows for a bulk approval ----------------------------------------------------

type Selectable = Pick<QueueRow, 'requestId' | 'canApprove'>;

/**
 * Only a request the server says the person may APPROVE can be selected (`canApprove`, not `canDecide`:
 * a person who approved the first stage may still reject or return the second, but not approve it).
 */
export const selectableIds = (rows: readonly Selectable[]): number[] =>
  rows.filter((r) => r.canApprove).map((r) => r.requestId);

/** The selection restricted to what is still on the page and approvable (a reload may have changed rows). */
export function pruneSelection(selected: ReadonlySet<number>, rows: readonly Selectable[]): ReadonlySet<number> {
  const allowed = new Set(selectableIds(rows));
  return new Set([...selected].filter((id) => allowed.has(id)));
}

export function toggleId(selected: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** True when there is something to select and all of it is selected. */
export function allSelected(selected: ReadonlySet<number>, rows: readonly Selectable[]): boolean {
  const ids = selectableIds(rows);
  return ids.length > 0 && ids.every((id) => selected.has(id));
}

/** "Select all on this page": every approvable row, or nothing when they all are selected already. */
export function toggleAll(selected: ReadonlySet<number>, rows: readonly Selectable[]): ReadonlySet<number> {
  return allSelected(selected, rows) ? new Set<number>() : new Set(selectableIds(rows));
}

/** Request numbers in the order of the page, as the bulk function wants them. */
export const orderedSelection = (selected: ReadonlySet<number>, rows: readonly Selectable[]): number[] =>
  selectableIds(rows).filter((id) => selected.has(id));

// ---- paging text ------------------------------------------------------------------------

/** "21 to 40 of 130"; "No rows" when the list is empty. */
export function rangeText(offset: number, shown: number, total: number): string {
  if (shown === 0 || total === 0) return 'No rows';
  return `${offset + 1} to ${offset + shown} of ${total}`;
}

// ---- the bulk result ----------------------------------------------------------------------

const MERGED = ['APPLIED', 'ALREADY_APPLIED'];

/**
 * For an approved request whose copy into the golden record did not complete: the sentence for the
 * result list. The approval itself always stands (an approval is never undone by a merge, `01` §2.2);
 * until the data engineer's merge procedure exists (DE-5) the stub answers "merge not yet implemented",
 * so this line appears for every final approval. Null when there is nothing to say.
 */
export function mergeNote(row: Pick<BulkResultRow, 'outcome' | 'merge'>): string | null {
  if (row.outcome !== 'DECIDED' || row.merge === null) return null;
  if (MERGED.includes(row.merge.outcome)) return null;
  const why = row.merge.message || row.merge.error || row.merge.outcome;
  return `approved; update of the golden record pending: ${why}`;
}
