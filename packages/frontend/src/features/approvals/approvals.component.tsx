import { ArrowRight, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card, input } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, isBlank, orBlank } from '@/lib/format';

import { BulkConfirmDialog, BulkResultDialog } from './bulk-dialogs.component';
import { bulkApproveRequests, fetchQueue, type BulkAnswer, type QueuePage, type QueueRow } from './queue-api';
import {
  AGE_OPTIONS,
  PAGE_SIZES,
  QUEUE_TABS,
  ageText,
  allSelected,
  criteriaFromQuery,
  criteriaKey,
  facetOptions,
  hasFilters,
  noteView,
  orderedSelection,
  pruneSelection,
  queryFromCriteria,
  rangeText,
  selectableIds,
  sourceView,
  statusView,
  switchTab,
  tabById,
  timeView,
  toggleAll,
  toggleId,
  withoutFilters,
  type QueueCriteria,
  type TabDef,
  type TabId,
} from './queue-model';

type Dialog = { kind: 'none' } | { kind: 'confirm'; ids: number[] } | { kind: 'result'; answer: BulkAnswer };

const PANEL_ID = 'queue-panel';

const CANNOT_APPROVE =
  'You may not approve this request: it is outside your group or your area, or you approved its first stage. Open it to see why.';

const AGE_NOT_APPLICABLE = 'The age filter applies to open requests only. An approved or rejected request is closed, so it has no age.';

/**
 * S-2 Approvals (POC-APP-08, POC-APP-10): the work list of an approver. Six tabs, each a different
 * question put to the same list (waiting for my group at the first stage, at the second, returned to
 * me, approved, rejected, raised by me); filters; and, on the two tabs where a person acts, a bulk
 * approval of the selected requests.
 *
 * Which request is in which tab, who may decide it and the order are the server's (`getRequestQueue`):
 * the screen asks and draws. The address holds the tab, the filters and the page size, so a view can be
 * pasted into a message and the back button works; the page position is not in the address.
 */
export function Approvals() {
  const route = useHashRoute();
  const criteria = useMemo(() => criteriaFromQuery(route.query), [route.query]);
  const key = criteriaKey(criteria);
  const tab = tabById(criteria.tab);

  // Page position and selection belong to one view of the list: a new tab, filter, page size, page or
  // reload starts them again. They are reset while rendering (the pattern React documents for state that
  // follows a key), so no stale selection ever shows for a frame.
  const [pageState, setPageState] = useState({ key, index: 0 });
  if (pageState.key !== key) setPageState({ key, index: 0 });
  const pageIndex = pageState.key === key ? pageState.index : 0;
  const [reload, setReload] = useState(0);
  const requestKey = `${key}|${pageIndex}|${reload}`;

  const state = useLoad(requestKey, () => fetchQueue(criteria, pageIndex * criteria.pageSize));

  // The last answer that arrived stays on screen (counts, filter choices) while the next one loads, so the
  // tabs and the filters do not blink away at every click.
  const [lastPage, setLastPage] = useState<QueuePage | null>(null);
  if (state.status === 'ready' && state.data !== lastPage) setLastPage(state.data);
  const known = state.status === 'ready' ? state.data : lastPage;
  const rows = state.status === 'ready' ? state.data.rows : [];

  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<number> }>({ key: requestKey, ids: new Set() });
  if (selection.key !== requestKey) setSelection({ key: requestKey, ids: new Set() });
  const selected = pruneSelection(selection.key === requestKey ? selection.ids : new Set<number>(), rows);

  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });

  const go = (next: QueueCriteria) => navigate('/approvals', queryFromCriteria(next));
  const select = (id: TabId) => go(switchTab(criteria, id));

  const finishBulk = () => {
    setDialog({ kind: 'none' });
    setPageState({ key, index: 0 });
    setReload((n) => n + 1);
  };

  return (
    <div className="space-y-400">
      <header>
        <h1 className="text-600 font-semibold">Approvals</h1>
        <p className="mt-100 text-300 text-muted-foreground">
          The change requests waiting for you at each stage, and the ones you raised. Open a request to see its checks and history, or select
          several and approve them together.
        </p>
      </header>

      <section aria-label="Requests" className={card}>
        <TabStrip active={tab} counts={known?.counts ?? null} onSelect={select} />

        <div role="tabpanel" id={PANEL_ID} aria-labelledby={`tab-${tab.id}`}>
          <Filters criteria={criteria} facets={known?.facets ?? []} onChange={go} />

          <div className="flex flex-wrap items-center justify-between gap-300 border-b border-border px-400 py-300">
            <p className="text-300" aria-live="polite">
              {state.status === 'loading' ? 'Loading…' : null}
              {state.status === 'ready'
                ? `Showing ${rangeText(pageIndex * criteria.pageSize, state.data.rows.length, state.data.totalMatches)}`
                : null}
            </p>
            <div className="flex flex-wrap items-center gap-300">
              {tab.pending ? (
                <>
                  {selected.size > 0 ? <span className="text-200 text-muted-foreground">{selected.size} selected</span> : null}
                  <button
                    type="button"
                    className={button.primary}
                    disabled={selected.size === 0}
                    onClick={() => setDialog({ kind: 'confirm', ids: orderedSelection(selected, rows) })}
                  >
                    Bulk approve ({selected.size})
                  </button>
                </>
              ) : null}
              <label className="flex items-center gap-200 whitespace-nowrap text-200 text-muted-foreground">
                Rows per page
                <select
                  className={`${input} w-auto py-100`}
                  value={criteria.pageSize}
                  onChange={(event) => go({ ...criteria, pageSize: Number(event.target.value) })}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="p-400">
            {state.status === 'loading' ? <LoadingState rows={8} label="Loading requests" /> : null}
            {state.status === 'error' ? (
              <ErrorState title="The requests could not be loaded" message={state.message} onRetry={state.retry} />
            ) : null}
            {state.status === 'ready' && state.data.rows.length === 0 ? (
              <NothingHere tab={tab} filtered={hasFilters(criteria)} onClear={() => go(withoutFilters(criteria))} />
            ) : null}
            {state.status === 'ready' && state.data.rows.length > 0 ? (
              <>
                <RequestTable
                  rows={state.data.rows}
                  selectable={tab.pending}
                  selected={selected}
                  onToggle={(id) => setSelection({ key: requestKey, ids: toggleId(selected, id) })}
                  onToggleAll={() => setSelection({ key: requestKey, ids: toggleAll(selected, state.data.rows) })}
                />
                <Pager
                  page={pageIndex + 1}
                  hasPrevious={pageIndex > 0}
                  hasNext={state.data.hasMore}
                  onPrevious={() => setPageState({ key, index: Math.max(0, pageIndex - 1) })}
                  onNext={() => setPageState({ key, index: pageIndex + 1 })}
                />
              </>
            ) : null}
          </div>
        </div>
      </section>

      {dialog.kind === 'confirm' ? (
        <BulkConfirmDialog
          count={dialog.ids.length}
          onApprove={(comment) => bulkApproveRequests(dialog.ids, comment)}
          onCancel={() => setDialog({ kind: 'none' })}
          onResult={(answer) => setDialog({ kind: 'result', answer })}
        />
      ) : null}
      {dialog.kind === 'result' ? <BulkResultDialog answer={dialog.answer} onClose={finishBulk} /> : null}
    </div>
  );
}

// ---- tabs -------------------------------------------------------------------------------

function TabStrip({
  active,
  counts,
  onSelect,
}: {
  active: TabDef;
  counts: QueuePage['counts'] | null;
  onSelect: (id: TabId) => void;
}) {
  // Arrow keys move between tabs (the tablist pattern: only the active tab is in the tab order).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = QUEUE_TABS.findIndex((t) => t.id === active.id);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % QUEUE_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + QUEUE_TABS.length) % QUEUE_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = QUEUE_TABS.length - 1;
    else return;
    event.preventDefault();
    const target = QUEUE_TABS[next];
    if (!target) return;
    onSelect(target.id);
    event.currentTarget.querySelector<HTMLElement>(`#tab-${target.id}`)?.focus();
  };

  return (
    <div role="tablist" aria-label="Request queues" onKeyDown={onKeyDown} className="flex flex-wrap gap-100 border-b border-border px-300 pt-200">
      {QUEUE_TABS.map((t) => {
        const isActive = t.id === active.id;
        const count = counts ? counts[t.countKey] : null;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={isActive}
            aria-controls={PANEL_ID}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={
              isActive
                ? '-mb-px inline-flex items-center gap-200 border-b-2 border-primary px-300 py-200 text-300 font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                : 'inline-flex items-center gap-200 border-b-2 border-transparent px-300 py-200 text-300 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            }
          >
            {t.label}
            <span className={t.pending && count !== null && count > 0 ? badge.warning : badge.neutral}>{count === null ? '…' : count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---- filters ----------------------------------------------------------------------------

function Filters({
  criteria,
  facets,
  onChange,
}: {
  criteria: QueueCriteria;
  facets: QueuePage['facets'];
  onChange: (next: QueueCriteria) => void;
}) {
  const choose = (label: string, value: string, kind: string, apply: (v: string) => QueueCriteria, none: string) => (
    <label className="flex min-w-40 flex-col gap-100 text-200 font-medium text-muted-foreground">
      {label}
      <select className={input} value={value} onChange={(event) => onChange(apply(event.target.value))}>
        <option value="">{none}</option>
        {facetOptions(facets, kind, value).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-end gap-300 border-b border-border px-400 py-300">
      {choose('Profit centre', criteria.profitCenter, 'PROFIT_CENTER', (v) => ({ ...criteria, profitCenter: v }), 'All profit centres')}
      {choose('Field', criteria.fieldCode, 'FIELD', (v) => ({ ...criteria, fieldCode: v }), 'All fields')}
      {choose('Rule', criteria.ruleId, 'RULE', (v) => ({ ...criteria, ruleId: v }), 'All rules')}
      <label className="flex min-w-36 flex-col gap-100 text-200 font-medium text-muted-foreground">
        Age
        <select
          className={input}
          value={criteria.minAgeHours}
          disabled={!tabById(criteria.tab).ageApplies}
          title={tabById(criteria.tab).ageApplies ? undefined : AGE_NOT_APPLICABLE}
          onChange={(event) => onChange({ ...criteria, minAgeHours: Number(event.target.value) })}
        >
          {AGE_OPTIONS.map((o) => (
            <option key={o.hours} value={o.hours}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-200 pb-200 text-300">
        <input type="checkbox" checked={criteria.noteOnly} onChange={(event) => onChange({ ...criteria, noteOnly: event.target.checked })} />
        Has a note (TBD)
      </label>
      {hasFilters(criteria) ? (
        <button type="button" className={button.small} onClick={() => onChange(withoutFilters(criteria))}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

function NothingHere({ tab, filtered, onClear }: { tab: TabDef; filtered: boolean; onClear: () => void }) {
  if (filtered) {
    return (
      <EmptyState
        title="No requests match these filters"
        hint={`Nothing in "${tab.label}" matches the filters you chose. Clear them to see every request in this tab.`}
        action={
          <button type="button" className={button.secondary} onClick={onClear}>
            Clear filters
          </button>
        }
      />
    );
  }
  return <EmptyState title={tab.emptyTitle} hint={tab.emptyHint} />;
}

// ---- the table --------------------------------------------------------------------------

function RequestTable({
  rows,
  selectable,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: readonly QueueRow[];
  selectable: boolean;
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
}) {
  const approvable = selectableIds(rows).length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-300">
        <caption className="sr-only">Change requests in this tab</caption>
        <thead>
          <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
            {selectable ? (
              <th scope="col" className="w-0 px-300 py-200">
                <SelectAllBox
                  checked={allSelected(selected, rows)}
                  some={selected.size > 0}
                  disabled={approvable === 0}
                  onChange={onToggleAll}
                />
              </th>
            ) : null}
            <th scope="col" className="px-200 py-200 font-semibold">Request</th>
            <th scope="col" className="px-200 py-200 font-semibold">Equipment</th>
            <th scope="col" className="px-200 py-200 font-semibold">Field</th>
            <th scope="col" className="px-200 py-200 font-semibold">Current → proposed</th>
            <th scope="col" className="px-200 py-200 font-semibold">Reason</th>
            <th scope="col" className="px-200 py-200 font-semibold">Source</th>
            <th scope="col" className="px-200 py-200 font-semibold">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Line key={row.requestId} row={row} selectable={selectable} checked={selected.has(row.requestId)} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The header checkbox: a half-ticked state when only some rows are selected (not an attribute: set on the element). */
function SelectAllBox({ checked, some, disabled, onChange }: { checked: boolean; some: boolean; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !checked;
  }, [some, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all on this page"
      title={disabled ? 'You may not approve any request on this page.' : 'Select every request on this page that you may approve'}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}

function Line({
  row,
  selectable,
  checked,
  onToggle,
}: {
  row: QueueRow;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: number) => void;
}) {
  const status = statusView(row.requestStatus);
  const note = noteView(row.note);
  const source = sourceView(row);
  const time = timeView(row);
  const age = ageText(row.ageHours);
  const isFloc = row.entityType === 'FLOC';

  return (
    <tr className="border-t border-border align-top hover:bg-hover">
      {selectable ? (
        <td className="px-300 py-300">
          <input
            type="checkbox"
            aria-label={`Select ${row.requestRef}`}
            checked={checked}
            disabled={!row.canApprove}
            title={row.canApprove ? undefined : CANNOT_APPROVE}
            onChange={() => onToggle(row.requestId)}
          />
        </td>
      ) : null}

      <td className="whitespace-nowrap px-200 py-300">
        <a className="id-plate font-medium text-brand-foreground underline-offset-2 hover:underline" href={hrefFor(`/requests/${row.requestId}`)}>
          {row.requestRef}
        </a>
        <div className="mt-100">
          <span className={badge[status.tone]}>{status.label}</span>
        </div>
      </td>

      <td className="px-200 py-300">
        {isFloc ? <span className="text-200 text-muted-foreground">Location request</span> : <Plate value={row.equipmentNumber} />}
        {!isFloc && !isBlank(row.equipmentTagNumber) ? <div className="mt-100 text-200 text-muted-foreground">{row.equipmentTagNumber}</div> : null}
        <div className="mt-100">
          <Plate value={row.functionalLocation} />
        </div>
      </td>

      <td className="px-200 py-300">
        {orBlank(row.fieldLabel ?? row.fieldCode)}
        {!isBlank(row.sapField) ? <div className="mt-100 text-200 text-muted-foreground">SAP: {row.sapField}</div> : null}
      </td>

      <td className="px-200 py-300">
        <span className="flex flex-wrap items-center gap-200">
          <Plate value={row.oldValue} />
          <ArrowRight aria-label="changes to" role="img" className="icon-size-200 shrink-0 text-muted-foreground" />
          <Plate value={row.newValue} />
        </span>
      </td>

      <td className="max-w-xs px-200 py-300">
        <span className="break-words">{orBlank(row.reason)}</span>
        {note || row.photoCount > 0 ? (
          <span className="mt-100 flex flex-wrap items-center gap-200">
            {note ? (
              note.tbd ? (
                <span className={badge.warning} title="Marked to be decided (TBD)">
                  TBD
                </span>
              ) : (
                <span className="text-200 text-muted-foreground">Note: {note.text}</span>
              )
            ) : null}
            {row.photoCount > 0 ? (
              <span className="inline-flex items-center gap-100 text-200 text-muted-foreground" title={`${row.photoCount} photo(s) attached`}>
                <Camera aria-hidden="true" className="icon-size-200" />
                {row.photoCount}
                <span className="sr-only"> photo(s) attached</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </td>

      <td className="px-200 py-300">
        {source.label}
        {source.by ? <div className="mt-100 break-all text-200 text-muted-foreground">by {source.by}</div> : null}
      </td>

      <td className="whitespace-nowrap px-200 py-300 text-200">
        <div className="text-muted-foreground">{time.label}</div>
        <div>{formatUtc(time.iso)}</div>
        {age ? <div className="mt-100 text-muted-foreground">open {age}</div> : null}
      </td>
    </tr>
  );
}

/** An identifier or value in the monospace nameplate style; a blank is a dash, never an empty box. */
function Plate({ value }: { value: string | null | undefined }): ReactNode {
  return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <span className="id-plate">{String(value)}</span>;
}

function Pager({
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <nav aria-label="Pages" className="mt-400 flex items-center justify-between gap-300">
      <button type="button" className={button.secondary} onClick={onPrevious} disabled={!hasPrevious}>
        <ChevronLeft aria-hidden="true" className="icon-size-200" />
        Previous
      </button>
      <span className="text-300 text-muted-foreground">Page {page}</span>
      <button type="button" className={button.secondary} onClick={onNext} disabled={!hasNext}>
        Next
        <ChevronRight aria-hidden="true" className="icon-size-200" />
      </button>
    </nav>
  );
}
