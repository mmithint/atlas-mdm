/**
 * Field catalogue version 1 for the client demo (`npm run dev:mock` only), the same 13 fields, labels, types,
 * lengths and order as seed `db/seed/0106_field_catalog_v1.sql` (`FINAL PLAN/01` §6.2). The SAP column names
 * shown on queue rows are illustrative until the data engineer fills `sap_column` (DE-3).
 */
import type { AppFunctionsSchema as S } from '@rayfin-app/functions/types';

type HeaterRow = S['searchEquipment']['output']['rows'][number];

export interface CatalogField {
  fieldCode: string;
  label: string;
  entityType: 'EQUIPMENT' | 'FLOC';
  dataType: 'TEXT' | 'CODE' | 'DECIMAL';
  maxLength: number | null;
  unit: string | null;
  allowedValuesSource: 'NONE' | 'LIST';
  isKey: boolean;
  displayGroup: 'KEY' | 'ADDITIONAL';
  /** Only an admin or a rule may change it (setting ADMIN_ONLY_FIELDS, seed 0109). */
  adminOnly: boolean;
  sapField: string;
}

const f = (
  fieldCode: string,
  label: string,
  entityType: CatalogField['entityType'],
  dataType: CatalogField['dataType'],
  maxLength: number | null,
  unit: string | null,
  allowedValuesSource: CatalogField['allowedValuesSource'],
  isKey: boolean,
  adminOnly: boolean,
  sapField: string
): CatalogField => ({ fieldCode, label, entityType, dataType, maxLength, unit, allowedValuesSource, isKey, displayGroup: isKey ? 'KEY' : 'ADDITIONAL', adminOnly, sapField });

export const CATALOG: readonly CatalogField[] = [
  f('MANUFACTURER', 'Manufacturer', 'EQUIPMENT', 'TEXT', 30, null, 'NONE', true, false, 'HERST'),
  f('MODEL_NUMBER', 'Model number', 'EQUIPMENT', 'TEXT', 20, null, 'NONE', true, false, 'TYPBZ'),
  f('SERIAL_NUMBER', 'Serial number', 'EQUIPMENT', 'TEXT', 30, null, 'NONE', true, false, 'SERGE'),
  f('FIRED_UNFIRED', 'Fired / unfired (fuel type)', 'EQUIPMENT', 'CODE', 30, null, 'LIST', true, false, 'HB_TYPE'),
  f('HEAT_DUTY', 'Heat duty (MMBTU/hr)', 'EQUIPMENT', 'DECIMAL', null, 'MMBTU/hr', 'NONE', true, false, 'HB_DUTY'),
  f('EQUIPMENT_TAG_NUMBER', 'Engineering tag', 'EQUIPMENT', 'TEXT', 30, null, 'NONE', false, false, 'TIDNR'),
  f('EQUIPMENT_DESCRIPTION', 'Description', 'EQUIPMENT', 'TEXT', 40, null, 'NONE', false, false, 'EQKTX'),
  f('EQUIP_CLASS', 'Equipment class', 'EQUIPMENT', 'CODE', 30, null, 'NONE', false, true, 'CLASS'),
  f('CLASS_TYPE', 'Class type', 'EQUIPMENT', 'CODE', 30, null, 'NONE', false, true, 'KLART'),
  f('OBJECT_TYPE', 'Object type', 'EQUIPMENT', 'CODE', 30, null, 'NONE', false, true, 'EQART'),
  f('EQUIPMENT_USER_STATUS', 'User status', 'EQUIPMENT', 'CODE', 30, null, 'LIST', false, false, 'USER_STATUS'),
  f('FUNCTIONAL_LOCATION', 'Installed at FLOC', 'EQUIPMENT', 'TEXT', 40, null, 'NONE', false, false, 'TPLNR'),
  f('FLOC_CLASS', 'FLOC class', 'FLOC', 'CODE', 30, null, 'NONE', false, true, 'CLASS'),
];

/** Drop-down values: seed 0106 (fired / unfired) and seed 0108 (user status, D-18). */
export const ALLOWED_VALUES: readonly { fieldCode: string; value: string; order: number }[] = [
  { fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 },
  { fieldCode: 'FIRED_UNFIRED', value: 'UNFIRED', order: 2 },
  { fieldCode: 'EQUIPMENT_USER_STATUS', value: 'AVFS', order: 1 },
  { fieldCode: 'EQUIPMENT_USER_STATUS', value: 'NOPE', order: 2 },
  { fieldCode: 'EQUIPMENT_USER_STATUS', value: 'OPER', order: 3 },
  { fieldCode: 'EQUIPMENT_USER_STATUS', value: 'DECM', order: 4 },
];

export function fieldOf(code: string): CatalogField | undefined {
  return CATALOG.find((c) => c.fieldCode === code);
}

export const labelOf = (code: string): string => fieldOf(code)?.label ?? code;

/** Which heater column holds each field. */
const COLUMN: Record<string, keyof HeaterRow> = {
  MANUFACTURER: 'manufacturer',
  MODEL_NUMBER: 'modelNumber',
  SERIAL_NUMBER: 'manufacturerSerialNumber',
  FIRED_UNFIRED: 'firedUnfired',
  HEAT_DUTY: 'heatDutyMmbtuHr',
  EQUIPMENT_TAG_NUMBER: 'equipmentTagNumber',
  EQUIPMENT_DESCRIPTION: 'equipmentDescription',
  EQUIP_CLASS: 'equipClass',
  CLASS_TYPE: 'classType',
  OBJECT_TYPE: 'objectType',
  EQUIPMENT_USER_STATUS: 'equipmentUserStatus',
  FUNCTIONAL_LOCATION: 'functionalLocation',
  FLOC_CLASS: 'flocClass',
};

/** A field's current value on a heater, as text (heat duty with four decimals, like the database). */
export function fieldValueOf(h: HeaterRow, code: string): string | null {
  const column = COLUMN[code];
  if (!column) return null;
  const v = h[column];
  if (v === null || v === undefined) return null;
  if (code === 'HEAT_DUTY' && typeof v === 'number') return v.toFixed(4);
  return String(v);
}

/** Writes an approved value into the heater (the merge, in the demo). */
export function setFieldValue(h: HeaterRow, code: string, value: string | null): void {
  const column = COLUMN[code];
  if (!column) return;
  const row = h as unknown as Record<string, unknown>;
  row[column] = code === 'HEAT_DUTY' ? (value === null || value === '' ? null : Number(value)) : value;
}
