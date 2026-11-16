/**
 * What the equipment search can look for and show (screen S-4).
 * The names are the properties of one search row: the camelCase names of the columns of the
 * view app.vw_equipment_search, as the function `searchEquipment` returns them
 * (packages/functions/src/equipment.ts, `EquipmentSearchRow`).
 */

/** Every column the search list reads, in the view's order. */
export const SEARCH_SELECT = [
  'equipmentId',
  'equipmentNumber',
  'equipmentDescription',
  'functionalLocation',
  'flocDescription',
  'superiorFunctionalLocation',
  'equipmentTagNumber',
  'equipClass',
  'classType',
  'objectType',
  'flocClass',
  'techObjectType',
  'manufacturer',
  'modelNumber',
  'manufacturerSerialNumber',
  'firedUnfired',
  'heatDutyMmbtuHr',
  'heatDutySource',
  'equipmentUserStatus',
  'flocUserStatus',
  'profitCenterName',
  'plannerGroup',
  'heaterPopulationMethod',
  'goldenVersionId',
  'lastChangedAtUtc',
  'baselineAsOfUtc',
  'openRequestCount',
  'invalidRuleCount',
  'verificationPct',
] as const;

export type SearchColumn = (typeof SEARCH_SELECT)[number];

/** The text columns a person can search in (POC-APP-05). */
export interface SearchField {
  /** The value in the address (`?field=tag`). */
  id: string;
  label: string;
  column: SearchColumn;
}

export const SEARCH_FIELDS: readonly SearchField[] = [
  { id: 'tag', label: 'Engineering tag', column: 'equipmentTagNumber' },
  { id: 'serial', label: 'Serial number', column: 'manufacturerSerialNumber' },
  { id: 'equipment', label: 'Equipment number', column: 'equipmentNumber' },
  { id: 'floc', label: 'Functional location (FLOC)', column: 'functionalLocation' },
  { id: 'manufacturer', label: 'Manufacturer', column: 'manufacturer' },
  { id: 'class', label: 'Equipment class', column: 'equipClass' },
  { id: 'floc-class', label: 'FLOC class', column: 'flocClass' },
  { id: 'profit-center', label: 'Profit centre', column: 'profitCenterName' },
];

export const DEFAULT_FIELD_ID = 'tag';

export function fieldById(id: string | null | undefined): SearchField {
  return SEARCH_FIELDS.find((f) => f.id === id) ?? SEARCH_FIELDS[0]!;
}

/** How a cell is drawn. */
export type CellKind =
  | 'tag' // identifier plate that links to the heater (the tag, and the equipment number for heaters without a tag)
  | 'plate' // identifier plate
  | 'facility' // identifier plate that links to the facility drill-down
  | 'text'
  | 'decimal'
  | 'percent'
  | 'count'
  | 'date';

export interface ColumnDef {
  column: SearchColumn;
  label: string;
  kind: CellKind;
  defaultVisible: boolean;
}

export const COLUMNS: readonly ColumnDef[] = [
  // shown by default (nine fit a 1440 px screen; the column being searched is always added)
  { column: 'equipmentTagNumber', label: 'Tag', kind: 'tag', defaultVisible: true },
  { column: 'manufacturerSerialNumber', label: 'Serial number', kind: 'plate', defaultVisible: true },
  { column: 'equipmentNumber', label: 'Equipment no.', kind: 'tag', defaultVisible: true },
  { column: 'functionalLocation', label: 'FLOC', kind: 'plate', defaultVisible: false },
  { column: 'superiorFunctionalLocation', label: 'Facility', kind: 'facility', defaultVisible: true },
  { column: 'manufacturer', label: 'Manufacturer', kind: 'text', defaultVisible: true },
  { column: 'equipClass', label: 'Class', kind: 'text', defaultVisible: true },
  { column: 'profitCenterName', label: 'Profit centre', kind: 'text', defaultVisible: true },
  { column: 'openRequestCount', label: 'Open requests', kind: 'count', defaultVisible: true },
  { column: 'verificationPct', label: 'Verified', kind: 'percent', defaultVisible: true },
  // available from the column chooser
  { column: 'equipmentDescription', label: 'Description', kind: 'text', defaultVisible: false },
  { column: 'flocDescription', label: 'FLOC description', kind: 'text', defaultVisible: false },
  { column: 'modelNumber', label: 'Model', kind: 'text', defaultVisible: false },
  { column: 'firedUnfired', label: 'Fired / unfired', kind: 'text', defaultVisible: false },
  { column: 'heatDutyMmbtuHr', label: 'Heat duty (MMBTU/hr)', kind: 'decimal', defaultVisible: false },
  { column: 'classType', label: 'Class type', kind: 'text', defaultVisible: false },
  { column: 'objectType', label: 'Object type', kind: 'text', defaultVisible: false },
  { column: 'flocClass', label: 'FLOC class', kind: 'text', defaultVisible: false },
  { column: 'techObjectType', label: 'Tech. object type', kind: 'text', defaultVisible: false },
  { column: 'equipmentUserStatus', label: 'User status', kind: 'text', defaultVisible: false },
  { column: 'flocUserStatus', label: 'FLOC status', kind: 'text', defaultVisible: false },
  { column: 'plannerGroup', label: 'Planner group', kind: 'text', defaultVisible: false },
  { column: 'heaterPopulationMethod', label: 'Population method', kind: 'text', defaultVisible: false },
  { column: 'invalidRuleCount', label: 'Invalid rules', kind: 'count', defaultVisible: false },
  { column: 'lastChangedAtUtc', label: 'Last changed', kind: 'date', defaultVisible: false },
];

export const DEFAULT_COLUMNS: readonly SearchColumn[] = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.column);

/** Rows per page offered on the screen. */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 50;

/** The column a list is ordered by when nothing else is chosen: unique and never blank. */
export const DEFAULT_SORT: SearchColumn = 'equipmentNumber';
