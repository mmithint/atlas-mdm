/**
 * The search rules of screen S-4, as plain functions (no React, no network), so they can
 * be tested on their own.
 *
 * Since CR-1 (19 Nov) the person searches with the boxes under the column headers: every box with
 * text is one "contains" condition, and all of them must hold (AND). The ordering, the paging and
 * the AND live in the procedure `app.usp_equipment_search` (read path C, D-17): the screen makes
 * one call per page and receives the rows already in order. The closest-match mode of the
 * procedure is no longer used by the screen.
 */
import { DEFAULT_PAGE_SIZE, DEFAULT_SORT, FILTER_COLUMNS, MAX_FILTER_TEXT, PAGE_SIZES, SEARCH_SELECT, isFilterColumn, type SearchColumn } from './columns';

export type SortDirection = 'asc' | 'desc';

/** One box under a column header that holds text: the heater's value in `column` must contain `text`. */
export interface ColumnFilter {
  column: SearchColumn;
  text: string;
}

/** What the person asked for; this is what the address bar holds. */
export interface SearchCriteria {
  /** One entry per box that holds text, in the order of `FILTER_COLUMNS`; empty = no filter. */
  filters: readonly ColumnFilter[];
  /** Only heaters under this parent FLOC (the facility drill-down); empty = all. */
  facility: string;
  /** A column the person chose to sort by; null = the default order (equipment number). */
  sort: SearchColumn | null;
  direction: SortDirection;
  pageSize: number;
}

const isSearchColumn = (value: string | null): value is SearchColumn =>
  value !== null && (SEARCH_SELECT as readonly string[]).includes(value);

/** The address names a filter `f.<column>` (for example `f.manufacturer=heat`). */
const FILTER_PREFIX = 'f.';

/** What is typed in the boxes, by column; a missing column is an empty box. */
export type FilterValues = Partial<Record<SearchColumn, string>>;

/** The filters for the boxes' text: trimmed, blank boxes dropped, in the order of `FILTER_COLUMNS`. */
export function filtersFromValues(values: FilterValues): ColumnFilter[] {
  return FILTER_COLUMNS.flatMap((column) => {
    const text = (values[column] ?? '').trim().slice(0, MAX_FILTER_TEXT);
    return text === '' ? [] : [{ column, text }];
  });
}

/** The text of every box that holds a filter. */
export function valuesFromFilters(filters: readonly ColumnFilter[]): FilterValues {
  return Object.fromEntries(filters.map((f) => [f.column, f.text]));
}

/** Reads the criteria from the address query; anything unreadable falls back to a default. */
export function criteriaFromQuery(query: URLSearchParams): SearchCriteria {
  const size = Number(query.get('size'));
  const sort = query.get('sort');
  const values: FilterValues = {};
  for (const [key, value] of query.entries()) {
    const column = key.startsWith(FILTER_PREFIX) ? key.slice(FILTER_PREFIX.length) : '';
    if (isFilterColumn(column)) values[column] = value;
  }
  return {
    filters: filtersFromValues(values),
    facility: (query.get('facility') ?? '').trim(),
    sort: isSearchColumn(sort) ? sort : null,
    direction: query.get('dir') === 'desc' ? 'desc' : 'asc',
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** The address query for the criteria; values that equal the default are left out. */
export function queryFromCriteria(c: SearchCriteria): Record<string, string | undefined> {
  return {
    ...Object.fromEntries(c.filters.map((f) => [FILTER_PREFIX + f.column, f.text])),
    facility: c.facility || undefined,
    sort: c.sort ?? undefined,
    dir: c.sort && c.direction === 'desc' ? 'desc' : undefined,
    size: c.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(c.pageSize),
  };
}

/** The column and direction the list is ordered by. */
export const sortOf = (c: SearchCriteria): { column: SearchColumn; direction: SortDirection } =>
  c.sort === null ? { column: DEFAULT_SORT, direction: 'asc' } : { column: c.sort, direction: c.direction };

/** One key for everything that changes the list; page position is kept apart from it. */
export const criteriaKey = (c: SearchCriteria): string => JSON.stringify(queryFromCriteria(c)) + `|${c.pageSize}`;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
