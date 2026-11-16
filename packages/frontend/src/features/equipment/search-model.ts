/**
 * The search rules of screen S-4, as plain functions (no React, no network), so they can
 * be tested on their own.
 *
 * Closest-match ordering (POC-APP-05, "show closest matches"): rows whose value equals the
 * search text come first, then rows that start with it, then rows that merely contain it.
 * That rule, and the row caps per group, live in the procedure `app.usp_equipment_search`
 * (read path C, D-17): the screen makes one call and receives the list already in order.
 */
import { DEFAULT_FIELD_ID, DEFAULT_PAGE_SIZE, DEFAULT_SORT, PAGE_SIZES, SEARCH_SELECT, fieldById, type SearchColumn } from './columns';

export type SortDirection = 'asc' | 'desc';

/** What the person asked for; this is what the address bar holds. */
export interface SearchCriteria {
  /** One of `SEARCH_FIELDS[].id`. */
  fieldId: string;
  /** The text to look for; empty means "list everything". */
  query: string;
  /** Only heaters under this parent FLOC (the facility drill-down); empty = all. */
  facility: string;
  /** A column the person chose to sort by; null = best match (or the default order). */
  sort: SearchColumn | null;
  direction: SortDirection;
  pageSize: number;
}

const isSearchColumn = (value: string | null): value is SearchColumn =>
  value !== null && (SEARCH_SELECT as readonly string[]).includes(value);

/** Reads the criteria from the address query; anything unreadable falls back to a default. */
export function criteriaFromQuery(query: URLSearchParams): SearchCriteria {
  const size = Number(query.get('size'));
  const sort = query.get('sort');
  return {
    fieldId: fieldById(query.get('field')).id,
    query: (query.get('q') ?? '').trim(),
    facility: (query.get('facility') ?? '').trim(),
    sort: isSearchColumn(sort) ? sort : null,
    direction: query.get('dir') === 'desc' ? 'desc' : 'asc',
    pageSize: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/** The address query for the criteria; values that equal the default are left out. */
export function queryFromCriteria(c: SearchCriteria): Record<string, string | undefined> {
  return {
    field: c.fieldId === DEFAULT_FIELD_ID ? undefined : c.fieldId,
    q: c.query || undefined,
    facility: c.facility || undefined,
    sort: c.sort ?? undefined,
    dir: c.sort && c.direction === 'desc' ? 'desc' : undefined,
    size: c.pageSize === DEFAULT_PAGE_SIZE ? undefined : String(c.pageSize),
  };
}

/**
 * How the list is filled:
 *  - `match`: a text was entered and no sort chosen: one call, closest first (capped list).
 *  - `sorted`: one call per page, ordered by a column (a text, if any, is a "contains").
 */
export type SearchMode = 'match' | 'sorted';

export const modeOf = (c: SearchCriteria): SearchMode =>
  c.query !== '' && c.sort === null ? 'match' : 'sorted';

/** The column and direction a `sorted` list is ordered by. */
export const sortOf = (c: SearchCriteria): { column: SearchColumn; direction: SortDirection } =>
  c.sort === null ? { column: DEFAULT_SORT, direction: 'asc' } : { column: c.sort, direction: c.direction };

/** One key for everything that changes the list; page position is kept apart from it. */
export const criteriaKey = (c: SearchCriteria): string => JSON.stringify(queryFromCriteria(c)) + `|${c.fieldId}|${c.pageSize}`;

/** Rows of page `index` (0-based) from a list that is already in memory. */
export function sliceRows<T>(rows: readonly T[], index: number, pageSize: number): T[] {
  return rows.slice(index * pageSize, (index + 1) * pageSize);
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
