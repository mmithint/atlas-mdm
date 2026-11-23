import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card, input, inputCompact } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';
import { BLANK, formatDecimal, formatPercent, formatUtc, isBlank, orBlank } from '@/lib/format';

import { ClassBadge } from './class-badge.component';
import { FiredBadge, StatusBadge, VerifiedBadge } from './value-badges.component';
import { COLUMNS, DEFAULT_COLUMNS, MAX_FILTER_TEXT, PAGE_SIZES, isFilterColumn, labelOf, type ColumnDef, type SearchColumn } from './columns';
import type { SearchRow } from './equipment-api';
import {
  criteriaFromQuery,
  filtersFromValues,
  queryFromCriteria,
  valuesFromFilters,
  type FilterValues,
  type SearchCriteria,
} from './search-model';
import { useEquipmentSearch } from './use-equipment-search';

/**
 * S-4 Equipment search (POC-APP-05, changed by CR-1 on 19 Nov): type in the boxes under the column
 * headers and press the search icon; every box with text must match (AND). The column chooser
 * holds a box for every text column, shown or not, and shares the same typed values with the header
 * boxes. Choose the columns and the rows per page; click a facility to list every heater under that
 * parent FLOC. The address holds the search, so a result can be shared.
 */
export function EquipmentSearch() {
  const route = useHashRoute();
  const criteria = useMemo(() => criteriaFromQuery(route.query), [route.query]);
  const view = useEquipmentSearch(criteria);
  const [visible, setVisible] = useState<readonly SearchColumn[]>(DEFAULT_COLUMNS);
  // Any text column can be filtered from the column chooser, shown or not; a hidden column's filter still cuts the list.
  const filtered = useMemo(() => new Set<SearchColumn>(criteria.filters.map((f) => f.column)), [criteria.filters]);
  const columns = COLUMNS.filter((c) => visible.includes(c.column));

  // What is typed in the boxes counts only when the search icon is pressed. When the applied filters
  // change (a search, Clear, the Back button) the boxes show what is applied again.
  const appliedKey = JSON.stringify(criteria.filters);
  const [typed, setTyped] = useState<{ key: string; values: FilterValues }>({ key: appliedKey, values: valuesFromFilters(criteria.filters) });
  const values = typed.key === appliedKey ? typed.values : valuesFromFilters(criteria.filters);
  const setValue = (column: SearchColumn, text: string) => setTyped({ key: appliedKey, values: { ...values, [column]: text } });
  const anyFilter = criteria.filters.length > 0 || Object.values(values).some((text) => (text ?? '').trim() !== '');

  const go = (change: Partial<SearchCriteria>) =>
    navigate('/equipment', queryFromCriteria({ ...criteria, ...change }));

  const search = () => go({ filters: filtersFromValues(values) });
  const clear = () => {
    setTyped({ key: appliedKey, values: {} });
    go({ filters: [] });
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
          {anyFilter ? (
            <button type="button" className={button.small} onClick={clear}>
              <X aria-hidden="true" className="icon-size-200" />
              Clear filters
            </button>
          ) : null}
          <button type="button" className={button.small} onClick={search} aria-label="Search with the column filters" title="Search with the column filters">
            <Search aria-hidden="true" className="icon-size-200" />
          </button>
          <ColumnChooser visible={visible} onChange={setVisible} values={values} onValue={setValue} applied={filtered} onApply={search} />
        </div>
      </div>

      {/* The table runs to the card's edges. The card is only as tall as its rows and pager; with more
          rows than fit, it stops at the bottom of the page and the table scrolls inside it. */}
      <section aria-label="Search results" className={`${card} overflow-hidden md:flex md:min-h-0 md:flex-col`}>
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
          {view.status === 'ready' && view.rows.length === 0 ? (
            <div className="shrink-0 border-t border-border p-400">
              <NothingFound criteria={criteria} />
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

  const toggle = (column: SearchColumn, on: boolean) => {
    const next = COLUMNS.map((c) => c.column).filter((c) => (c === column ? on : visible.includes(c)));
    if (next.length > 0) onChange(next);
  };

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
        className="absolute right-0 z-10 mt-100 w-96 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <fieldset className="max-h-96 overflow-auto p-300">
          <legend className="sr-only">Columns to show and filter</legend>
          {COLUMNS.map((c) => (
            <div key={c.column} className="flex items-center justify-between gap-200 py-100">
              <label className="flex min-w-0 items-center gap-200 text-300">
                <input
                  type="checkbox"
                  checked={visible.includes(c.column)}
                  disabled={visible.length === 1 && visible.includes(c.column)}
                  onChange={(e) => toggle(c.column, e.target.checked)}
                />
                {c.label}
                {applied.has(c.column) ? <span className="text-200 text-muted-foreground"> (filtered)</span> : null}
              </label>
              {isFilterColumn(c.column) ? (
                <div className="w-40 shrink-0">
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
        <div className="flex justify-end border-t border-border px-300 py-200">
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
          <tr className="bg-muted/50">
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
            <tr key={row.equipmentId} className="border-t border-border hover:bg-hover">
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
        <a className="id-plate font-medium text-brand-foreground underline-offset-2 hover:underline" href={hrefFor(`/equipment/${row.equipmentId}`)}>
          {String(value)}
        </a>
      );
    case 'plate':
      return isBlank(value) ? <span className="text-muted-foreground">{BLANK}</span> : <span className="id-plate">{String(value)}</span>;
    case 'facility':
      return isBlank(value) ? (
        <span className="text-muted-foreground">{BLANK}</span>
      ) : (
        <a className="id-plate text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/equipment', { facility: String(value) })} title="List every heater at this facility">
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
