import clsx from 'clsx';
import { ArrowRight, Check, ChevronLeft, ChevronRight, ListFilter, Undo2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, isBlank, orBlank } from '@/lib/format';

import { ApprovalFilterPanel } from './approval-filter-panel.component';
import { ApprovalStats } from './approval-stats.component';
import { BulkConfirmDialog, BulkResultDialog } from './bulk-dialogs.component';
import { bulkApproveRequests, fetchQueue, type BulkAnswer, type QueuePage, type QueueRow } from './queue-api';
import {
  QUEUE_TABS,
  ageText,
  allSelected,
  criteriaFromQuery,
  criteriaKey,
  filterCount,
  hasFilters,
  noteView,
  orderedSelection,
  pruneSelection,
  queryFromCriteria,
  selectableIds,
  sourceView,
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

  // The Filters panel sits beside the table on a large screen and over the page on a smaller one, like Equipment's.
  const [panelOpen, setPanelOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)');
  const panelId = useId();
  const filterButton = useRef<HTMLButtonElement>(null);
  const closePanel = () => {
    setPanelOpen(false);
    filterButton.current?.focus();
  };

  const go = (next: QueueCriteria) => navigate('/approvals', queryFromCriteria(next));
  const select = (id: TabId) => go(switchTab(criteria, id));

  const finishBulk = () => {
    setDialog({ kind: 'none' });
    setPageState({ key, index: 0 });
    setReload((n) => n + 1);
  };

  // On a wide screen the page fills the area under the app header and only the table scrolls (the tabs and pager stay in view).
  return (
    <div className="space-y-300 md:flex md:min-h-0 md:flex-1 md:flex-col md:space-y-0 md:gap-300">
      <header className="shrink-0">
        <h1 className="text-600 font-semibold">Approvals</h1>
      </header>

      <ApprovalStats counts={known?.counts ?? null} criteria={criteria} onSelectTab={select} />

      {/* With the panel open on a large screen, the list gives up some width to sit beside it. */}
      <div className="md:flex md:min-h-0 md:flex-1 md:items-start md:gap-400">
        <section aria-label="Requests" className={`${card} md:flex md:max-h-full md:min-h-0 md:min-w-0 md:flex-1 md:flex-col`}>
          {/* The tabs and the actions share one row; the row owns the rule under them. */}
          {/* The tabs stretch to the row's height (text centred, underline on the rule); the actions get 12px above and below. */}
          <div className="flex shrink-0 flex-wrap items-stretch gap-x-300 border-b border-border pr-400">
            <TabStrip active={tab} counts={known?.counts ?? null} onSelect={select} />
            <div className="self-center py-300">
              <QueueActions
                criteria={criteria}
                filterButton={filterButton}
                filters={{ open: panelOpen, panelId, onToggle: () => (panelOpen ? closePanel() : setPanelOpen(true)) }}
                bulk={
                  tab.pending
                    ? { selectedCount: selected.size, onApprove: () => setDialog({ kind: 'confirm', ids: orderedSelection(selected, rows) }) }
                    : null
                }
              />
            </div>
          </div>

          <div role="tabpanel" id={PANEL_ID} aria-labelledby={`tab-${tab.id}`} className="md:flex md:min-h-0 md:flex-1 md:flex-col">
            {/* The table runs to the card's edges (no padding); the loading, error and empty messages keep their own. */}
              <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
              {state.status === 'loading' ? (
                <div className="p-400">
                  <LoadingState rows={8} label="Loading requests" />
                </div>
              ) : null}
              {state.status === 'error' ? (
                <div className="p-400">
                  <ErrorState title="The requests could not be loaded" message={state.message} onRetry={state.retry} />
                </div>
              ) : null}
              {state.status === 'ready' && state.data.rows.length === 0 ? (
                <div className="p-400">
                  <NothingHere tab={tab} filtered={hasFilters(criteria)} onClear={() => go(withoutFilters(criteria))} />
                </div>
              ) : null}
              {state.status === 'ready' && state.data.rows.length > 0 ? (
                <>
                  <RequestTable
                    rows={state.data.rows}
                    selectable={tab.pending}
                    selected={selected}
                    onToggle={(id) => setSelection({ key: requestKey, ids: toggleId(selected, id) })}
                    onToggleAll={() => setSelection({ key: requestKey, ids: toggleAll(selected, state.data.rows) })}
                  onApprove={(id) => setDialog({ kind: 'confirm', ids: [id] })}
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
        {panelOpen && wide ? <ApprovalFilterPanel id={panelId} overlay={false} criteria={criteria} facets={known?.facets ?? []} onChange={go} onClose={closePanel} /> : null}
      </div>
      {panelOpen && !wide ? <ApprovalFilterPanel id={panelId} overlay criteria={criteria} facets={known?.facets ?? []} onChange={go} onClose={closePanel} /> : null}

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
    <div role="tablist" aria-label="Request queues" onKeyDown={onKeyDown} className="flex flex-1 flex-wrap gap-100 px-300">
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
                ? '-mb-px inline-flex items-center gap-200 border-b-2 border-ring px-300 py-200 text-300 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                : 'inline-flex items-center gap-200 border-b-2 border-transparent px-300 py-200 text-300 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            }
          >
            {t.label}
            <span
              className={clsx(
                'inline-flex min-w-500 items-center justify-center rounded-lg border px-100 text-100 font-medium leading-200 tabular-nums',
                t.pending && count !== null && count > 0 ? 'border-warning-border bg-warning text-warning-foreground' : 'border-border bg-muted text-muted-foreground'
              )}
            >
              {count === null ? '…' : count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- actions and filters ----------------------------------------------------------------

/** The Filters button (it opens the panel) and, on the tabs where a person acts, the bulk approval, side by side in one row. */
function QueueActions({
  criteria,
  filterButton,
  filters,
  bulk,
}: {
  criteria: QueueCriteria;
  /** The Filters button, so focus can return to it when the panel closes. */
  filterButton: RefObject<HTMLButtonElement | null>;
  filters: { open: boolean; panelId: string; onToggle: () => void };
  /** Null on a tab with nothing to approve. */
  bulk: { selectedCount: number; onApprove: () => void } | null;
}) {
  return (
    <div className="flex flex-row flex-wrap items-center gap-300">
      <button
        ref={filterButton}
        type="button"
        className={button.small}
        aria-expanded={filters.open}
        aria-controls={filters.open ? filters.panelId : undefined}
        aria-label={filterCount(criteria) > 0 ? `Filters, ${filterCount(criteria)} applied` : undefined}
        onClick={filters.onToggle}
      >
        <ListFilter aria-hidden="true" className="icon-size-200" />
        Filters
        {filterCount(criteria) > 0 ? (
          <span aria-hidden="true" className={badge.info}>
            {filterCount(criteria)}
          </span>
        ) : null}
      </button>
      {bulk ? (
        <>
          {bulk.selectedCount > 0 ? <span className="text-200 text-muted-foreground">{bulk.selectedCount} selected</span> : null}
          <button type="button" className={button.primary} disabled={bulk.selectedCount === 0} onClick={bulk.onApprove}>
            Bulk approve ({bulk.selectedCount})
          </button>
        </>
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
  onApprove,
}: {
  rows: readonly QueueRow[];
  selectable: boolean;
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  /** Approve this one request (asks for confirmation first). */
  onApprove: (id: number) => void;
}) {
  const approvable = selectableIds(rows).length;
  return (
    <div className="overflow-x-auto md:min-h-0 md:overflow-y-auto">
      <table className="w-full min-w-max border-collapse text-250 leading-250">
        <caption className="sr-only">Change requests in this tab</caption>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
            {selectable ? (
              <th scope="col" className="w-0 px-300 py-200 text-center align-middle">
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
            {selectable ? (
              <th scope="col" className="sticky right-0 border-l border-divider bg-muted px-300 py-200 text-center font-semibold">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Line key={row.requestId} row={row} selectable={selectable} checked={selected.has(row.requestId)} onToggle={onToggle} onApprove={onApprove} />
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
      className="icon-size-200 cursor-pointer accent-primary disabled:cursor-not-allowed"
    />
  );
}

const ACTION =
  'inline-flex h-700 w-700 items-center justify-center rounded-md transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-disabled-foreground aria-disabled:cursor-not-allowed aria-disabled:text-disabled-foreground';

/**
 * Approve, Reject and Return for correction, as 16px icons in a row. Approve asks for confirmation here. Reject and
 * Return need a written reason (and Return a person to send it back to), so they open the request with that decision
 * already chosen. All three are off when this person may not decide the request.
 */
function RowActions({ row, onApprove }: { row: QueueRow; onApprove: () => void }) {
  const can = row.canApprove;
  const why = can ? undefined : CANNOT_APPROVE;
  const open = (decision: string) => hrefFor(`/requests/${row.requestId}`, { decide: decision });
  return (
    <div role="group" aria-label={`Actions for ${row.requestRef}`} className="flex items-center justify-center gap-100">
      <button type="button" disabled={!can} title={why ?? 'Approve'} aria-label={`Approve ${row.requestRef}`} onClick={onApprove} className={`${ACTION} text-success-foreground hover:bg-success`}>
        <Check aria-hidden="true" className="icon-size-200" />
      </button>
      {can ? (
        <a href={open('REJECT')} title="Reject" aria-label={`Reject ${row.requestRef}`} className={`${ACTION} text-destructive hover:bg-danger-bg`}>
          <X aria-hidden="true" className="icon-size-200" />
        </a>
      ) : (
        <span aria-disabled="true" role="img" title={why} aria-label={`Reject ${row.requestRef} (not allowed)`} className={ACTION}>
          <X aria-hidden="true" className="icon-size-200" />
        </span>
      )}
      {can ? (
        <a href={open('RETURN')} title="Return for correction" aria-label={`Return ${row.requestRef} for correction`} className={`${ACTION} text-info-foreground hover:bg-info`}>
          <Undo2 aria-hidden="true" className="icon-size-200" />
        </a>
      ) : (
        <span aria-disabled="true" role="img" title={why} aria-label={`Return ${row.requestRef} for correction (not allowed)`} className={ACTION}>
          <Undo2 aria-hidden="true" className="icon-size-200" />
        </span>
      )}
    </div>
  );
}

function Line({
  row,
  selectable,
  checked,
  onToggle,
  onApprove,
}: {
  row: QueueRow;
  selectable: boolean;
  checked: boolean;
  onToggle: (id: number) => void;
  onApprove: (id: number) => void;
}) {
  const note = noteView(row.note);
  const source = sourceView(row);
  const time = timeView(row);
  const age = ageText(row.ageHours);
  const isFloc = row.entityType === 'FLOC';

  return (
    <tr className="group border-t border-divider align-top hover:bg-row-hover">
      {selectable ? (
        <td className="px-300 py-300 text-center align-middle">
          <input
            type="checkbox"
            aria-label={`Select ${row.requestRef}`}
            checked={checked}
            disabled={!row.canApprove}
            title={row.canApprove ? undefined : CANNOT_APPROVE}
            onChange={() => onToggle(row.requestId)}
            className="icon-size-200 cursor-pointer accent-primary disabled:cursor-not-allowed"
          />
        </td>
      ) : null}

      <td className="whitespace-nowrap px-200 py-300">
        <a className="id-plate font-medium underline-offset-2 hover:underline" href={hrefFor(`/requests/${row.requestId}`)}>
          {row.requestRef}
        </a>
        {/* <div className="mt-100">
          <span className={badge[status.tone]}>{status.label}</span>
        </div> */}
      </td>

      <td className="px-200 py-300">
        {isFloc ? <span className="text-200 text-muted-foreground">Location request</span> : <Plate value={row.equipmentNumber} />}
        {/* {!isFloc && !isBlank(row.equipmentTagNumber) ? <div className="mt-100 text-200 text-muted-foreground">{row.equipmentTagNumber}</div> : null}
        <div className="mt-100">
          <Plate value={row.functionalLocation} />
        </div> */}
      </td>

      <td className="px-200 py-300">
        {orBlank(row.fieldLabel ?? row.fieldCode)}
        {/* {!isBlank(row.sapField) ? <div className="mt-100 text-200 text-muted-foreground">SAP: {row.sapField}</div> : null} */}
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
                <span title="Marked to be decided (TBD)">
                  TBD
                </span>
              ) : (
                <span className="text-200 text-muted-foreground">Note: {note.text}</span>
              )
            ) : null}
            {/* {row.photoCount > 0 ? (
              <span className="inline-flex items-center gap-100 text-200 text-muted-foreground" title={`${row.photoCount} photo(s) attached`}>
                <Camera aria-hidden="true" className="icon-size-200" />
                {row.photoCount}
                <span className="sr-only"> photo(s) attached</span>
              </span>
            ) : null} */}
          </span>
        ) : null}
      </td>

      <td className="px-200 py-300">
        {source.label}
        {/* {source.by ? <div className="mt-100 break-all text-200 text-muted-foreground">by {source.by}</div> : null} */}
      </td>

      <td className="whitespace-nowrap px-200 py-300 text-200">
        {/* <div className="text-muted-foreground">{time.label}</div> */}
        <div>{formatUtc(time.iso)}</div>
        {age ? <div className="mt-100 text-muted-foreground">open {age}</div> : null}
      </td>

      {selectable ? (
        <td className="sticky right-0 whitespace-nowrap border-l border-divider bg-card px-300 py-300 align-middle group-hover:bg-[linear-gradient(var(--color-row-hover),var(--color-row-hover))]">
          <RowActions row={row} onApprove={() => onApprove(row.requestId)} />
        </td>
      ) : null}
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
    <nav aria-label="Pages" className="flex shrink-0 items-center justify-between gap-300 border-t border-border px-400 py-300">
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
