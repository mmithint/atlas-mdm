/**
 * The equipment screens' reads (S-4 search, S-5 detail). Nothing here can change data.
 *
 * Read path C (decided 15 Nov, D-17; FINAL PLAN/01 section 2.1): the connector cannot read
 * views (spike S7), so
 *   - the search and the heater's gold data come through the functions `searchEquipment` and
 *     `getEquipmentDetail`, which run the procedures `app.usp_equipment_search` /
 *     `app.usp_equipment_detail` (the search rules live there, in T-SQL);
 *   - the field catalogue, a plain table, still comes through the read-only connector
 *     `atlas_sql_db` (decision D-02).
 *
 * The row types are the functions' own output types, so a change to a function's answer
 * shows up here as a compile error. Dates arrive as ISO text.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { getRayfinClient } from '@/lib/rayfin-client';

import type { FieldCatalog } from '../../../../../rayfin/connectors/atlas_sql_db/schema';

import { QUICK_SEARCH_COLUMN } from './columns';
import { sortOf, type ColumnFilter, type SearchCriteria } from './search-model';

type Detail = AppFunctionsSchema['getEquipmentDetail']['output'];

export type SearchRow = AppFunctionsSchema['searchEquipment']['output']['rows'][number];
export type HeaterRow = NonNullable<Detail['heater']>;
export type FlocRow = NonNullable<Detail['floc']>;
export type FieldValueRow = Detail['fieldValues'][number];
export type OwnershipRow = Detail['ownership'][number];
export type CatalogRow = InstanceType<typeof FieldCatalog>;

/** The most rows one function call returns; the screen's largest page. */
const PAGE_LIMIT = 100;

type SearchArguments = Parameters<
  Awaited<ReturnType<typeof getRayfinClient>>['functions']['searchEquipment']['invoke']
>[0];

/**
 * The read functions report a failure inside their answer (`error`) instead of throwing, because
 * the platform shows the browser only "InternalError: An internal execution error occured" for a
 * thrown error and hides the message (found 15 Nov, APP-2 B6). This turns `error` back into an
 * exception, with the function's own words.
 */
export function unwrapRead<T extends { error: string | null }>(answer: T): T {
  if (answer.error !== null) throw new Error(answer.error);
  return answer;
}

async function search(args: SearchArguments) {
  return unwrapRead(await (await getRayfinClient()).functions.searchEquipment.invoke(args));
}

export interface SortedPage {
  rows: SearchRow[];
  hasNext: boolean;
  /**
   * Hand this to the next call to read the page after this one; null on the last page.
   * It is the row offset as text (the procedure pages by offset, which is stable because
   * every order ends with the heater id).
   */
  endCursor: string | null;
  /** Every heater that matches the filters and the facility (all pages), as counted by the procedure. */
  total: number;
}

/** The boxes as the function wants them: one JSON text, empty when no box holds text. */
export const filtersJsonOf = (filters: readonly ColumnFilter[]): string =>
  filters.length === 0 ? '' : JSON.stringify(filters.map((f) => ({ column: f.column, text: f.text })));

/**
 * One page of the list, ordered by a column; `cursor` is the previous page's `endCursor`.
 * A quick-search value uses the procedure's closest-match mode over the engineering tag. Every
 * column box is also sent as a "contains" condition, and all of those filters must hold (CR-1).
 */
export async function fetchSortedPage(c: SearchCriteria, cursor: string | null): Promise<SortedPage> {
  const { column, direction } = sortOf(c);
  const parsed = cursor === null ? 0 : Number(cursor);
  const offset = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  const answer = await search({
    mode: c.searchText === '' ? 'SORTED' : 'MATCH',
    searchColumn: QUICK_SEARCH_COLUMN,
    searchText: c.searchText,
    facility: c.facility,
    sortColumn: column,
    sortDirection: direction,
    offset,
    pageSize: Math.min(c.pageSize, PAGE_LIMIT),
    filtersJson: filtersJsonOf(c.filters),
  });
  return {
    rows: answer.rows,
    hasNext: answer.hasMore,
    endCursor: answer.hasMore ? String(offset + answer.rows.length) : null,
    total: answer.totalMatches,
  };
}

// ---- one heater (screen S-5) -------------------------------------------------

const CATALOG_SELECT = [
  'fieldCode',
  'label',
  'entityType',
  'dataType',
  'maxLength',
  'unit',
  'allowedValuesSource',
  'isKeyVerificationField',
  'isEditable',
  'displayGroup',
  'displayOrder',
  'isActive',
] as const;

export interface HeaterDetail {
  heater: HeaterRow;
  /** The heater's own functional location, when the gold view has it. */
  floc: FlocRow | null;
  fieldValues: FieldValueRow[];
  catalog: CatalogRow[];
  ownership: OwnershipRow[];
}

/**
 * Everything the detail screen needs for one heater; null when there is no such heater.
 * Two reads run side by side: the function (the heater, its location, its field values and
 * the field owners, on one database connection) and the catalogue (a table, via the connector).
 */
/** The active catalogue fields in display order: the connector's one table (D-17). */
export async function fetchCatalog(): Promise<CatalogRow[]> {
  const client = await getRayfinClient();
  return client.connectors.atlas_sql_db.FieldCatalog.select(CATALOG_SELECT)
    .where({ isActive: { eq: true } })
    .orderBy({ displayOrder: 'asc' })
    .execute();
}

export async function fetchHeater(equipmentId: number): Promise<HeaterDetail | null> {
  const client = await getRayfinClient();

  const [detail, catalog] = await Promise.all([client.functions.getEquipmentDetail.invoke({ equipmentId }).then(unwrapRead), fetchCatalog()]);

  if (!detail.found || detail.heater === null) return null;
  return {
    heater: detail.heater,
    floc: detail.floc,
    fieldValues: detail.fieldValues,
    catalog,
    ownership: detail.ownership,
  };
}
