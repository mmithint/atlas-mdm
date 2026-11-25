import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, ListFilter, Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card, identifierBadge, input, inputCompact } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';
import { useMediaQuery } from '@/hooks/use-media-query';
import { BLANK, formatDecimal, formatPercent, formatUtc, isBlank, orBlank } from '@/lib/format';

import { ClassBadge } from './class-badge.component';
import { FiredBadge, StatusBadge, VerifiedBadge } from './value-badges.component';
import { COLUMNS, DEFAULT_COLUMNS, MAX_FILTER_TEXT, PAGE_SIZES, isFilterColumn, labelOf, type ColumnDef, type SearchColumn } from './columns';
import type { SearchRow } from './equipment-api';
import { FilterPanel } from './filter-panel.component';
import { NO_SELECTION, selectedCount, type Selection } from './facets';
import { definitionOf, type ViewState } from './saved-view-model';
import { SavedViews } from './saved-views.component';
import { StatCards } from './stat-cards.component';
import {
  criteriaFromQuery,
  filtersFromValues,
  queryFromCriteria,
  valuesFromFilters,
  type FilterValues,
  type SearchCriteria,
} from './search-model';
import { useEquipmentSearch } from './use-equipment-search';
import { MAX_FILTERED_ROWS, useFilteredSearch } from './use-filtered-search';

/**
 * S-4 Equipment search (POC-APP-05, changed by CR-1 on 19 Nov): type in the boxes under the column
 * headers and press the search icon; every box with text must match (AND). The column chooser
 * holds a box for every text column, shown or not, and shares the same typed values with the header
 * boxes. Choose the columns and the rows per page; click a facility to list every heater under that
 * parent FLOC. The address holds the search, so a result can be shared.
 *
 * The Filter panel adds checkbox lists, as on a shop's filter. While values are ticked the list comes
 * from useFilteredSearch, which matches them in the browser over every row the boxes, the facility and
 * the order choose; the sort, the page size and the boxes keep working.
 */
export function EquipmentSearch() {
  const route = useHashRoute();
  const criteria = useMemo(() => criteriaFromQuery(route.query), [route.query]);
  const paged = useEquipmentSearch(criteria);
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const ticked = selectedCount(selection);

  // The panel sits beside the table on a large screen and over the page on a smaller one.
  const [panelOpen, setPanelOpen] = useState(false);
  // Every row of the search is read even with the panel closed: the metric cards are worked out from it.
  const { all, list: ruled } = useFilteredSearch(criteria, selection, true);
  const view = ruled ?? paged;
  const wide = useMediaQuery('(min-width: 1024px)');
  const panelId = useId();
  const filterButton = useRef<HTMLButtonElement>(null);
  const closePanel = () => {
    setPanelOpen(false);
    filterButton.current?.focus();
  };
  const clearSelection = () => setSelection(NO_SELECTION);

  const [visible, setVisible] = useState<readonly SearchColumn[]>(DEFAULT_COLUMNS);
  // Any text column can be filtered from the column chooser, shown or not; a hidden column's filter still cuts the list.
  const filtered = useMemo(() => new Set<SearchColumn>(criteria.filters.map((f) => f.column)), [criteria.filters]);
  const columns = COLUMNS.filter((c) => visible.includes(c.column));

  // A saved filter is the whole view: the address (boxes, facility, order, page size), the ticked values and the columns.
  const currentView = definitionOf({ criteria, selection, columns: visible });
  const applyView = (view: ViewState) => {
    setSelection(view.selection);
    setVisible(view.columns);
    navigate('/equipment', queryFromCriteria(view.criteria));
  };
  const savedViews = <SavedViews current={currentView} onApply={applyView} />;

  // What is typed in the boxes counts only when the search icon is pressed. When the applied filters
  // change (a search, Clear, the Back button) the boxes show what is applied again.
  const appliedKey = JSON.stringify(criteria.filters);
  const [typed, setTyped] = useState<{ key: string; values: FilterValues }>({ key: appliedKey, values: valuesFromFilters(criteria.filters) });
  const values = typed.key === appliedKey ? typed.values : valuesFromFilters(criteria.filters);
  const setValue = (column: SearchColumn, text: string) => setTyped({ key: appliedKey, values: { ...values, [column]: text } });

  const [searchOpen, setSearchOpen] = useState(criteria.searchText !== '');
  const [quickSearch, setQuickSearch] = useState({ key: criteria.searchText, text: criteria.searchText });
  const quickSearchText = quickSearch.key === criteria.searchText ? quickSearch.text : criteria.searchText;
  const setQuickSearchText = (text: string) => setQuickSearch({ key: criteria.searchText, text });

  const go = (change: Partial<SearchCriteria>) =>
    navigate('/equipment', queryFromCriteria({ ...criteria, ...change }));

  const search = () => go({ filters: filtersFromValues(values) });
  const submitQuickSearch = (event: FormEvent) => {
    event.preventDefault();
    go({ searchText: quickSearchText.trim(), filters: filtersFromValues(values) });
  };
  const closeQuickSearch = () => {
    setQuickSearch({ key: '', text: '' });
    setSearchOpen(false);
    if (criteria.searchText !== '') go({ searchText: '' });
  };
  const onSort = (column: SearchColumn) =>
    go({
      sort: column,
      direction: criteria.sort === column && criteria.direction === 'asc' ? 'desc' : 'asc',
    });

  // On a wide screen the page fills the area under the app header and only the table scrolls (the toolbar and pager stay in view).
  return (
    <div className="space-y-400 md:flex md:min-h-0 md:flex-1 md:flex-col md:space-y-0 md:gap-400">
      {/*<header>
        <h1 className="text-600 font-semibold">Equipment</h1>
         <p className="mt-100 text-300 text-muted-foreground">
          Type in the boxes under the column headers, then press the search icon: a heater is listed only when every filled box matches. Or click a facility to list every heater there.
        </p> 
      </header>*/}

      <StatCards all={all} serverTotal={paged.status === 'ready' ? paged.total : null} selection={selection} onChange={setSelection} />

      {criteria.facility ? (
        <div className="flex shrink-0 flex-wrap items-center gap-300 rounded-md border border-border bg-info px-400 py-200 text-300 text-info-foreground">
          <span>
            Facility <span className="id-plate">{criteria.facility}</span>: every heater under this parent FLOC.
          </span>
          <a
            className="inline-flex items-center gap-100 font-medium underline underline-offset-2"
            href={hrefFor('/equipment', queryFromCriteria({ ...criteria, facility: '' }))}
          >
            <X aria-hidden="true" className="icon-size-200" />
            Show all facilities
          </a>
        </div>
      ) : null}

      {/* The title and the toolbar sit above the table card, like the other pages' headers. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-300">
        <h1 className="text-600 font-semibold">Equipment</h1>
        {/* <Summary view={view} filtered={criteria.filters.length > 0} /> */}
        <div className="flex flex-wrap items-center gap-300">
          {searchOpen || criteria.searchText !== '' ? (
            <form className="relative w-64" role="search" onSubmit={submitQuickSearch}>
              <button
                type="submit"
                aria-label="Run equipment search"
                title="Run equipment search"
                className="absolute inset-y-0 left-100 flex cursor-pointer items-center rounded-md px-100 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Search aria-hidden="true" className="icon-size-200" />
              </button>
              <input
                autoFocus
                type="text"
                role="searchbox"
                aria-label="Search equipment tags"
                className={`${inputCompact} pl-800 pr-800`}
                value={quickSearchText}
                maxLength={MAX_FILTER_TEXT}
                placeholder="Search equipment tags"
                autoComplete="off"
                onChange={(event) => setQuickSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  closeQuickSearch();
                }}
              />
              <button
                type="button"
                aria-label="Clear and close equipment search"
                title="Clear and close"
                className="absolute inset-y-0 right-100 flex cursor-pointer items-center rounded-md px-100 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onClick={closeQuickSearch}
              >
                <X aria-hidden="true" className="icon-size-200" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={button.small}
              onClick={() => {
                setSearchOpen(true);
                search();
              }}
              aria-label="Open equipment search"
              title="Search equipment tags"
            >
              <Search aria-hidden="true" className="icon-size-200" />
            </button>
          )}
          <ColumnChooser visible={visible} onChange={setVisible} values={values} onValue={setValue} applied={filtered} onApply={search} />
          <button
            ref={filterButton}
            type="button"
            className={button.small}
            aria-expanded={panelOpen}
            aria-controls={panelOpen ? panelId : undefined}
            aria-label={ticked > 0 ? `Filter, ${ticked} selected` : undefined}
            onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
          >
            <ListFilter aria-hidden="true" className="icon-size-200" />
            Filter
            {ticked > 0 ? (
              <span aria-hidden="true" className={badge.info}>
                {ticked}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* The table runs to the card's edges. The card is only as tall as its rows and pager; with more
          rows than fit, it stops at the bottom of the page and the table scrolls inside it. */}
      {/* With the panel open on a large screen, the table gives up some width to sit beside it. */}
      <div className="md:flex md:min-h-0 md:flex-1 md:items-start md:gap-400">
        <section aria-label="Search results" className={`${card} overflow-hidden md:flex md:max-h-full md:min-h-0 md:min-w-0 md:flex-1 md:flex-col`}>
          <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
            {/* The header and the filter boxes stay on screen while loading, on an error and when nothing matches, so a filter can always be changed. */}
            <ResultTable
              rows={view.status === 'ready' ? view.rows : []}
              columns={columns}
              criteria={criteria}
              onSort={onSort}
              values={values}
              onValue={setValue}
            />
            {view.status === 'loading' ? (
              <div className="shrink-0 border-t border-border p-400">
                <LoadingState rows={6} label="Searching" />
              </div>
            ) : null}
            {view.status === 'error' ? (
              <div className="shrink-0 border-t border-border p-400">
                <ErrorState title="The search failed" message={view.message} onRetry={view.retry} />
              </div>
            ) : null}
            {view.status === 'too-many' ? (
              <div className="shrink-0 border-t border-border p-400">
                <EmptyState
                  title="Too many heaters to filter"
                  hint={`The filters work on up to ${MAX_FILTERED_ROWS.toLocaleString()} heaters at a time, and this search matches ${view.total.toLocaleString()}. Narrow it first with a box under a column header or a facility; your ticked values then apply on their own.`}
                  action={
                    <button type="button" className={button.secondary} onClick={clearSelection}>
                      Clear filters
                    </button>
                  }
                />
              </div>
            ) : null}
            {view.status === 'ready' && view.rows.length === 0 ? (
              <div className="shrink-0 border-t border-border p-400">
                {ticked > 0 ? (
                  <EmptyState
                    title="No heater matches the ticked values"
                    hint="Untick a value in the Filter panel, or clear the filters to see every heater again."
                    action={
                      <button type="button" className={button.secondary} onClick={clearSelection}>
                        Clear filters
                      </button>
                    }
                  />
                ) : (
                  <NothingFound criteria={criteria} />
                )}
              </div>
            ) : null}
            {view.status === 'ready' && view.rows.length > 0 ? (
              <Pager
                page={view.page}
                pageCount={view.pageCount}
                hasPrevious={view.hasPrevious}
                hasNext={view.hasNext}
                onPrevious={view.previous}
                onNext={view.next}
                pageSize={criteria.pageSize}
                onPageSize={(pageSize) => go({ pageSize })}
              />
            ) : null}
          </div>
        </section>
        {panelOpen && wide ? (
          <FilterPanel
            id={panelId}
            overlay={false}
            all={all}
            selection={selection}
            matchCount={ruled?.status === 'ready' ? ruled.total : null}
            onChange={setSelection}
            top={savedViews}
            onClose={closePanel}
          />
        ) : null}
      </div>
      {panelOpen && !wide ? (
        <FilterPanel
          id={panelId}
          overlay
          all={all}
          selection={selection}
          matchCount={ruled?.status === 'ready' ? ruled.total : null}
          onChange={setSelection}
          top={savedViews}
          onClose={closePanel}
        />
      ) : null}
    </div>
  );
}

// Not shown at the moment (the summary line is commented out in the toolbar); exported so the code is kept and the build stays clean.
export function Summary({ view, filtered }: { view: ReturnType<typeof useEquipmentSearch>; filtered: boolean }) {
  if (view.status !== 'ready') return <p className="text-300 text-muted-foreground">{view.status === 'loading' ? 'Searching…' : ''}</p>;
  return (
    <p className="text-300">
      <strong>{view.total}</strong> {view.total === 1 ? 'heater' : 'heaters'}
      {filtered ? ' match' : ''}
      <span className="text-muted-foreground">
        , page {view.page} of {view.pageCount}
      </span>
      <span className="ml-300 text-200 text-muted-foreground">Loaded in {view.ms} ms</span>
    </p>
  );
}

function NothingFound({ criteria }: { criteria: SearchCriteria }) {
  if (criteria.searchText !== '') {
    return (
      <EmptyState
        title="No heater found"
        hint={`No equipment tag matches "${criteria.searchText}"${criteria.facility ? ` under facility ${criteria.facility}` : ''}. Try fewer characters, or clear the search.`}
      />
    );
  }
  if (criteria.filters.length > 0) {
    const said = criteria.filters.map((f) => `${labelOf(f.column)} contains "${f.text}"`).join(' and ');
    return (
      <EmptyState
        title="No heater found"
        hint={`Nothing matches ${said}${criteria.facility ? ` under facility ${criteria.facility}` : ''}. Try fewer letters, or clear a filter.`}
      />
    );
  }
  return (
    <EmptyState
      title="No heaters to show"
      hint={criteria.facility ? `No heater has the parent FLOC ${criteria.facility}.` : 'The equipment list is empty. If this is not expected, the data load may not have run yet.'}
    />
  );
}

/**
 * Chooses which columns the table shows, and holds a filter box next to every text column, shown or
 * not. The boxes edit the same typed values as the ones under the column headers; Apply (or Enter)
 * runs the search and closes the list.
 */
function ColumnChooser({
  visible,
  onChange,
  values,
  onValue,
  applied,
  onApply,
}: {
  visible: readonly SearchColumn[];
  onChange: (next: readonly SearchColumn[]) => void;
  /** What is typed in the filter boxes, by column. */
  values: FilterValues;
  onValue: (column: SearchColumn, text: string) => void;
  /** The columns that hold an applied filter: marked, because a hidden column's filter is not visible in the table. */
  applied: ReadonlySet<SearchColumn>;
  onApply: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const allSelected = visible.length === COLUMNS.length;

  const toggle = (column: SearchColumn, on: boolean) => {
    const next = COLUMNS.map((c) => c.column).filter((c) => (c === column ? on : visible.includes(c)));
    if (next.length > 0) onChange(next);
  };

  const selectAll = () => onChange(COLUMNS.map((c) => c.column));

  const apply = (event: FormEvent) => {
    event.preventDefault();
    onApply();
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details ref={detailsRef} className="relative">
      <summary className={`${button.small} cursor-pointer list-none`}>
        <Columns3 aria-hidden="true" className="icon-size-200" />
        Columns
      </summary>
      <form
        onSubmit={apply}
        className="absolute right-0 z-10 mt-100 w-96 rounded-md border border-border bg-popover text-popover-foreground shadow-elevated"
      >
        <div className="flex items-center justify-between gap-300 border-b border-border px-300 py-200">
          <div>
            <p className="text-300 font-semibold">Choose columns</p>
            <p className="text-200 text-muted-foreground">
              {visible.length} of {COLUMNS.length} shown
            </p>
          </div>
          <button type="button" className={button.small} onClick={selectAll} disabled={allSelected}>
            Select all
          </button>
        </div>
        <fieldset className="max-h-96 space-y-100 overflow-auto p-200">
          <legend className="sr-only">Columns to show and filter</legend>
          {COLUMNS.map((c) => (
            <div key={c.column} className="flex min-h-1000 items-center gap-200 rounded-lg hover:bg-hover focus-within:bg-hover">
              <label className="flex min-h-1000 min-w-0 flex-1 cursor-pointer items-center gap-200 rounded-lg px-200 py-100 text-300">
                <input
                  type="checkbox"
                  className="icon-size-200 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  checked={visible.includes(c.column)}
                  disabled={visible.length === 1 && visible.includes(c.column)}
                  onChange={(e) => toggle(c.column, e.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {c.label}
                  {applied.has(c.column) ? <span className="text-200 text-muted-foreground"> (filtered)</span> : null}
                </span>
              </label>
              {isFilterColumn(c.column) ? (
                <div className="w-40 shrink-0 pr-100">
                  <input
                    type="text"
                    aria-label={`${c.label} filter value`}
                    className={inputCompact}
                    value={values[c.column] ?? ''}
                    maxLength={MAX_FILTER_TEXT}
                    placeholder="Filter"
                    autoComplete="off"
                    onChange={(e) => onValue(c.column, e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ))}
        </fieldset>
        <div className="flex justify-end border-t border-border bg-muted/50 px-300 py-200">
          <button type="submit" className={button.primary}>
            Apply filters
          </button>
        </div>
      </form>
    </details>
  );
}

function ResultTable({
  rows,
  columns,
  criteria,
  onSort,
  values,
  onValue,
}: {
  rows: readonly SearchRow[];
  columns: readonly ColumnDef[];
  criteria: SearchCriteria;
  onSort: (column: SearchColumn) => void;
  /** What is typed in the filter boxes, by column. */
  values: FilterValues;
  onValue: (column: SearchColumn, text: string) => void;
}) {
  return (
    <div className="overflow-x-auto md:min-h-0 md:overflow-y-auto">
      <table className="w-full min-w-max border-collapse text-250 leading-250">
        <caption className="sr-only">Heaters that match the search</caption>
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => {
              const active = criteria.sort === c.column;
              const Icon = active ? (criteria.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={c.column}
                  scope="col"
                  aria-sort={active ? (criteria.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="whitespace-nowrap px-200 py-200 font-semibold"
                >
                  <button type="button" onClick={() => onSort(c.column)} className="inline-flex items-center gap-100 uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {c.label}
                    <Icon aria-hidden="true" className={active ? 'icon-size-100 text-foreground' : 'icon-size-100 opacity-50'} />
                  </button>
                </th>
              );
            })}
          </tr>
          <tr className="bg-muted">
            {columns.map((c) => (
              <td key={c.column} className="px-200 pb-200 align-middle">
                {isFilterColumn(c.column) ? (
                  <input
                    type="text"
                    aria-label={`Filter ${c.label}`}
                    className={inputCompact}
                    value={values[c.column] ?? ''}
                    maxLength={MAX_FILTER_TEXT}
                    placeholder="Filter"
                    autoComplete="off"
                    onChange={(e) => onValue(c.column, e.target.value)}
                  />
                ) : null}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.equipmentId} className="border-t border-divider hover:bg-row-hover">
              {columns.map((c) => (
                <td key={c.column} className="whitespace-nowrap px-200 py-200 align-middle">
                  <Cell column={c} row={row} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ column, row }: { column: ColumnDef; row: SearchRow }): ReactNode {
  const value = row[column.column];
  switch (column.kind) {
    case 'tag':
      return isBlank(value) ? (
        <span className="text-muted-foreground">{BLANK}</span>
      ) : (
        <a
          className={`${identifierBadge} underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
          href={hrefFor(`/equipment/${row.equipmentId}`)}
        >
          {String(value)}
        </a>
      );
    case 'plate':
      return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <span className="id-plate">{String(value)}</span>;
    case 'facility':
      return isBlank(value) ? (
        <span className="text-muted-foreground">{BLANK}</span>
      ) : (
        <a className="id-plate underline-offset-2 hover:underline" href={hrefFor('/equipment', { facility: String(value) })} title="List every heater at this facility">
          {String(value)}
        </a>
      );
    case 'class':
      return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <ClassBadge value={String(value)} />;
    case 'fired':
      return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <FiredBadge value={String(value)} />;
    case 'status':
      return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <StatusBadge value={String(value)} />;
    case 'verified':
      return typeof value === 'number' ? <VerifiedBadge pct={value} /> : <span className="text-muted-foreground">{BLANK}</span>;
    case 'decimal':
      return <span className="tabular-nums">{formatDecimal(typeof value === 'number' ? value : null)}</span>;
    case 'percent':
      return <span className="tabular-nums">{formatPercent(typeof value === 'number' ? value : null)}</span>;
    case 'count':
      if (typeof value !== 'number') return <span className="text-muted-foreground" title="Not available yet">{BLANK}</span>;
      return value > 0 ? <span className={badge.warning}>{value}</span> : <span className="tabular-nums text-muted-foreground">0</span>;
    case 'date':
      return <span>{formatUtc(typeof value === 'string' ? value : null)}</span>;
    default:
      return <span>{orBlank(typeof value === 'string' ? value : null)}</span>;
  }
}

function Pager({
  page,
  pageCount,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageSize,
  onPageSize,
}: {
  page: number;
  pageCount: number | null;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSize: (pageSize: number) => void;
}) {
  // Rows per page on the left, the page controls on the right.
  return (
    <nav aria-label="Pages" className="flex shrink-0 flex-wrap items-center justify-between gap-300 border-t border-border px-400 py-300">
      <label className="flex items-center gap-200 whitespace-nowrap text-200 text-muted-foreground">
        Rows per page
        <select className={`${input} w-auto py-100`} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-300">
        <button type="button" className={button.secondary} onClick={onPrevious} disabled={!hasPrevious}>
          <ChevronLeft aria-hidden="true" className="icon-size-200" />
          Previous
        </button>
        <span className="text-300 text-muted-foreground">
          Page {page}
          {pageCount !== null ? ` of ${pageCount}` : ''}
        </span>
        <button type="button" className={button.secondary} onClick={onNext} disabled={!hasNext}>
          Next
          <ChevronRight aria-hidden="true" className="icon-size-200" />
        </button>
      </div>
    </nav>
  );
}
