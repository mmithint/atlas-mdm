import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search, X } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { hrefFor, navigate } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card, input } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';
import { BLANK, formatDecimal, formatPercent, formatUtc, isBlank, orBlank } from '@/lib/format';

import { COLUMNS, DEFAULT_COLUMNS, PAGE_SIZES, SEARCH_FIELDS, fieldById, type ColumnDef, type SearchColumn } from './columns';
import type { SearchRow } from './equipment-api';
import {
  criteriaFromQuery,
  criteriaKey,
  queryFromCriteria,
  type SearchCriteria,
} from './search-model';
import { useEquipmentSearch } from './use-equipment-search';

/**
 * S-4 Equipment search (POC-APP-05): pick a field, type a value, see the closest heaters
 * first; choose the columns and the rows per page; click a facility to list every heater
 * under that parent FLOC. The address holds the search, so a result can be shared.
 */
export function EquipmentSearch() {
  const route = useHashRoute();
  const criteria = useMemo(() => criteriaFromQuery(route.query), [route.query]);
  const view = useEquipmentSearch(criteria);
  const [visible, setVisible] = useState<readonly SearchColumn[]>(DEFAULT_COLUMNS);
  // The column being searched is always shown, so a match can be seen where it matched.
  const searched = fieldById(criteria.fieldId).column;
  const columns = COLUMNS.filter((c) => visible.includes(c.column) || c.column === searched);

  const go = (change: Partial<SearchCriteria>) =>
    navigate('/equipment', queryFromCriteria({ ...criteria, ...change }));

  const onSort = (column: SearchColumn) =>
    go({
      sort: column,
      direction: criteria.sort === column && criteria.direction === 'asc' ? 'desc' : 'asc',
    });

  return (
    <div className="space-y-400">
      <header>
        <h1 className="text-600 font-semibold">Equipment</h1>
        <p className="mt-100 text-300 text-muted-foreground">
          Find a heater by its engineering tag, serial number or equipment number, or list every heater at a facility.
        </p>
      </header>

      <SearchForm key={criteriaKey(criteria)} criteria={criteria} onSearch={(fieldId, query) => go({ fieldId, query, sort: null })} />

      {criteria.facility ? (
        <div className="flex flex-wrap items-center gap-300 rounded-md border border-border bg-info px-400 py-200 text-300 text-info-foreground">
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

      <section aria-label="Search results" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-300 border-b border-border px-400 py-300">
          <Summary view={view} />
          <div className="flex flex-wrap items-center gap-300">
            <ColumnChooser visible={visible} locked={searched} onChange={setVisible} />
            <label className="flex items-center gap-200 whitespace-nowrap text-200 text-muted-foreground">
              Rows per page
              <select
                className={`${input} w-auto py-100`}
                value={criteria.pageSize}
                onChange={(e) => go({ pageSize: Number(e.target.value) })}
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
          {view.status === 'loading' ? <LoadingState rows={8} label="Searching" /> : null}
          {view.status === 'error' ? (
            <ErrorState title="The search failed" message={view.message} onRetry={view.retry} />
          ) : null}
          {view.status === 'ready' && view.rows.length === 0 ? <NothingFound criteria={criteria} /> : null}
          {view.status === 'ready' && view.rows.length > 0 ? (
            <>
              <ResultTable rows={view.rows} columns={columns} criteria={criteria} onSort={onSort} />
              <Pager
                page={view.page}
                pageCount={view.pageCount}
                hasPrevious={view.hasPrevious}
                hasNext={view.hasNext}
                onPrevious={view.previous}
                onNext={view.next}
              />
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SearchForm({
  criteria,
  onSearch,
}: {
  criteria: SearchCriteria;
  onSearch: (fieldId: string, query: string) => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSearch(String(data.get('field') ?? ''), String(data.get('q') ?? '').trim());
  };

  return (
    <form role="search" aria-label="Find a heater" onSubmit={submit} className={`${card} flex flex-wrap items-end gap-300 p-400`}>
      <label className="flex min-w-48 flex-col gap-100 text-200 font-medium text-muted-foreground">
        Search in
        <select name="field" className={input} defaultValue={criteria.fieldId}>
          {SEARCH_FIELDS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-64 flex-1 flex-col gap-100 text-200 font-medium text-muted-foreground">
        Value
        <input
          name="q"
          type="search"
          className={input}
          defaultValue={criteria.query}
          placeholder="Type part or all of the value"
          autoComplete="off"
        />
      </label>
      <button type="submit" className={button.primary}>
        <Search aria-hidden="true" className="icon-size-200" />
        Search
      </button>
      <a className={button.secondary} href={hrefFor('/equipment', criteria.facility ? { facility: criteria.facility } : undefined)}>
        Clear
      </a>
    </form>
  );
}

function Summary({ view }: { view: ReturnType<typeof useEquipmentSearch> }) {
  if (view.status !== 'ready') return <p className="text-300 text-muted-foreground">{view.status === 'loading' ? 'Searching…' : ''}</p>;
  const timing = `Loaded in ${view.ms} ms`;
  if (view.mode === 'match') {
    return (
      <p className="text-300">
        <strong>{view.total}</strong> {view.total === 1 ? 'match' : 'matches'}, closest first
        {view.truncated ? ' (more exist: add letters to narrow the search)' : ''}
        <span className="ml-300 text-200 text-muted-foreground">{timing}</span>
      </p>
    );
  }
  return (
    <p className="text-300">
      Page <strong>{view.page}</strong>
      <span className="ml-300 text-200 text-muted-foreground">{timing}</span>
    </p>
  );
}

function NothingFound({ criteria }: { criteria: SearchCriteria }) {
  const field = fieldById(criteria.fieldId).label.toLowerCase();
  if (criteria.query) {
    return (
      <EmptyState
        title="No heater found"
        hint={`Nothing matches "${criteria.query}" in ${field}${criteria.facility ? ` under facility ${criteria.facility}` : ''}. Try fewer letters, or search in another field.`}
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

function ColumnChooser({
  visible,
  locked,
  onChange,
}: {
  visible: readonly SearchColumn[];
  /** The column being searched: always shown, so it cannot be switched off. */
  locked: SearchColumn;
  onChange: (next: readonly SearchColumn[]) => void;
}) {
  const toggle = (column: SearchColumn, on: boolean) => {
    const next = COLUMNS.map((c) => c.column).filter((c) => (c === column ? on : visible.includes(c)));
    if (next.length > 0) onChange(next);
  };
  return (
    <details className="relative">
      <summary className={`${button.small} cursor-pointer list-none`}>
        <Columns3 aria-hidden="true" className="icon-size-200" />
        Columns
      </summary>
      <fieldset className="absolute right-0 z-10 mt-100 max-h-96 w-64 overflow-auto rounded-md border border-border bg-popover p-300 text-popover-foreground shadow-lg">
        <legend className="sr-only">Columns to show</legend>
        {COLUMNS.map((c) => (
          <label key={c.column} className="flex items-center gap-200 py-100 text-300">
            <input
              type="checkbox"
              checked={visible.includes(c.column) || c.column === locked}
              disabled={c.column === locked || (visible.length === 1 && visible.includes(c.column))}
              onChange={(e) => toggle(c.column, e.target.checked)}
            />
            {c.label}
            {c.column === locked ? <span className="text-200 text-muted-foreground"> (searched)</span> : null}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function ResultTable({
  rows,
  columns,
  criteria,
  onSort,
}: {
  rows: readonly SearchRow[];
  columns: readonly ColumnDef[];
  criteria: SearchCriteria;
  onSort: (column: SearchColumn) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-300">
        <caption className="sr-only">Heaters that match the search</caption>
        <thead>
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
}: {
  page: number;
  pageCount: number | null;
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
      <span className="text-300 text-muted-foreground">
        Page {page}
        {pageCount !== null ? ` of ${pageCount}` : ''}
      </span>
      <button type="button" className={button.secondary} onClick={onNext} disabled={!hasNext}>
        Next
        <ChevronRight aria-hidden="true" className="icon-size-200" />
      </button>
    </nav>
  );
}
