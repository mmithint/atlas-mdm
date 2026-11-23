/**
 * What a saved filter of screen S-4 holds, as plain functions (no React, no network).
 *
 * A saved filter is the whole view: the boxes under the headers, the facility, the order and the page
 * size (kept as the address query the screen already writes), the ticked values of the Filter panel and
 * the columns shown. Reading one back goes through the same checks as the address, so a saved filter
 * from an older version, or one edited by hand, can never put the screen in a state it does not know:
 * unknown columns, fields and values are dropped.
 */
import { COLUMNS, DEFAULT_COLUMNS, type SearchColumn } from './columns';
import { FACETS, type Selection } from './facets';
import { criteriaFromQuery, queryFromCriteria, type SearchCriteria } from './search-model';

/** The screen code the saved filters are kept under (app.saved_view.screen_code). */
export const SCREEN = 'S-4';

export interface ViewState {
  criteria: SearchCriteria;
  selection: Selection;
  columns: readonly SearchColumn[];
}

interface Stored {
  v: 1;
  query: Record<string, string>;
  selection: Selection;
  columns: string[];
}

/** The JSON kept for a view. Equal views give equal text, so it also tells whether a view was changed. */
export function definitionOf(view: ViewState): string {
  const query = Object.fromEntries(
    Object.entries(queryFromCriteria(view.criteria))
      .filter((e): e is [string, string] => e[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const selection = Object.fromEntries(
    FACETS.filter((f) => (view.selection[f.id] ?? []).length > 0).map((f) => [f.id, [...(view.selection[f.id] ?? [])].sort()])
  );
  const columns = COLUMNS.map((c) => c.column).filter((c) => view.columns.includes(c));
  const stored: Stored = { v: 1, query, selection, columns };
  return JSON.stringify(stored);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The view a saved definition describes, checked like the address; null when it cannot be read at all. */
export function viewOf(json: string): ViewState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const query = new URLSearchParams();
  if (isRecord(parsed['query'])) {
    for (const [key, value] of Object.entries(parsed['query'])) if (typeof value === 'string') query.set(key, value);
  }

  const selection: Record<string, string[]> = {};
  if (isRecord(parsed['selection'])) {
    for (const facet of FACETS) {
      const values = parsed['selection'][facet.id];
      if (Array.isArray(values)) {
        const kept = values.filter((v): v is string => typeof v === 'string');
        if (kept.length > 0) selection[facet.id] = kept;
      }
    }
  }

  const known = COLUMNS.map((c) => c.column);
  const listed = Array.isArray(parsed['columns']) ? parsed['columns'].filter((c): c is SearchColumn => typeof c === 'string' && (known as string[]).includes(c)) : [];

  return { criteria: criteriaFromQuery(query), selection, columns: listed.length > 0 ? listed : DEFAULT_COLUMNS };
}
