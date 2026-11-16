/**
 * Turns the four reads of the detail screen (S-5) into the rows it draws, as plain
 * functions so they can be tested on their own.
 *
 * The field list is driven by the catalogue (`app.field_catalog`): which fields exist,
 * their label, unit and order, and whether they are key fields. The golden values come
 * from `gold.vw_equipment_field_current`; the owners (responsible and accountable role)
 * come from `app.vw_field_ownership`.
 */
import { formatDecimal, isBlank } from '@/lib/format';

export interface CatalogFieldInput {
  fieldCode: string;
  label?: string | null;
  entityType?: string | null;
  dataType?: string | null;
  unit?: string | null;
  displayGroup?: string | null;
  displayOrder?: number | null;
  isEditable?: boolean | null;
  isKeyVerificationField?: boolean | null;
}

export interface FieldValueInput {
  fieldCode?: string | null;
  currentValue?: string | null;
  baselineValue?: string | null;
  unit?: string | null;
  valueSource?: string | null;
}

export interface OwnershipInput {
  fieldCode?: string | null;
  responsibleRole?: string | null;
  accountableRole?: string | null;
}

/**
 * Catalogue fields that belong to the functional location, not to the heater, so the
 * long-form view may not carry them. Their current value is read from a column of the
 * heater row instead. [INFERRED: the contract (01 section 6.1) does not say whether
 * `gold.vw_equipment_field_current` has a row for FLOC_CLASS; the stub does not.]
 */
export const FIELD_FROM_HEATER_COLUMN: Readonly<Record<string, string>> = {
  FLOC_CLASS: 'flocClass',
};

export interface FieldRow {
  fieldCode: string;
  label: string;
  unit: string | null;
  group: 'KEY' | 'ADDITIONAL';
  entityType: string;
  isEditable: boolean;
  isKeyVerificationField: boolean;
  /** Blank when the value is missing; never a made-up zero. */
  current: string | null;
  /** The value in the SAP baseline; null when the view does not give one. */
  baseline: string | null;
  /** STATED, ASSUMED, FIELD_VERIFIED, CORRECTED or MISSING (the gold view's word). */
  valueSource: string | null;
  /** True when an approved change moved the value away from the SAP baseline. */
  changedFromBaseline: boolean;
  responsibleRole: string | null;
  accountableRole: string | null;
}

const clean = (value: string | null | undefined): string | null => (isBlank(value) ? null : String(value));

/** A value as shown: numbers without trailing zeros, text as it is, blanks stay null. */
export function displayValue(value: string | null | undefined, dataType: string | null | undefined): string | null {
  const text = clean(value);
  if (text === null) return null;
  return dataType === 'DECIMAL' ? formatDecimal(text) : text;
}

/**
 * One row per active catalogue field: key fields first, then the additional ones, each in
 * the catalogue's order. `heater` is the heater's row, used for fields that live on the FLOC.
 */
export function buildFieldRows(
  catalog: readonly CatalogFieldInput[],
  values: readonly FieldValueInput[],
  ownership: readonly OwnershipInput[],
  heater: object
): FieldRow[] {
  const heaterColumns = heater as Record<string, unknown>;
  const valueByCode = new Map<string, FieldValueInput>();
  for (const v of values) if (v.fieldCode) valueByCode.set(v.fieldCode, v);
  const ownerByCode = new Map<string, OwnershipInput>();
  for (const o of ownership) if (o.fieldCode) ownerByCode.set(o.fieldCode, o);

  const rows = catalog.map((field): FieldRow => {
    const dataType = field.dataType ?? null;
    const value = valueByCode.get(field.fieldCode);
    const heaterColumn = FIELD_FROM_HEATER_COLUMN[field.fieldCode];
    const fallback = heaterColumn ? heaterColumns[heaterColumn] : undefined;

    const current = displayValue(value ? value.currentValue : typeof fallback === 'string' ? fallback : null, dataType);
    const baseline = displayValue(value?.baselineValue ?? null, dataType);
    const owner = ownerByCode.get(field.fieldCode);

    return {
      fieldCode: field.fieldCode,
      label: field.label || field.fieldCode,
      unit: clean(value?.unit) ?? clean(field.unit),
      group: field.displayGroup === 'KEY' ? 'KEY' : 'ADDITIONAL',
      entityType: field.entityType ?? 'EQUIPMENT',
      isEditable: field.isEditable === true,
      isKeyVerificationField: field.isKeyVerificationField === true,
      current,
      baseline,
      valueSource: clean(value?.valueSource),
      changedFromBaseline: baseline !== null && current !== baseline,
      responsibleRole: clean(owner?.responsibleRole),
      accountableRole: clean(owner?.accountableRole),
    };
  });

  const order = new Map(catalog.map((f) => [f.fieldCode, f.displayOrder ?? 0]));
  return rows.sort(
    (a, b) =>
      (a.group === b.group ? 0 : a.group === 'KEY' ? -1 : 1) ||
      (order.get(a.fieldCode) ?? 0) - (order.get(b.fieldCode) ?? 0) ||
      a.label.localeCompare(b.label)
  );
}

/** The parts of the FLOC hierarchy that are filled, top level first. */
export function flocLevels(floc: object | null): string[] {
  if (!floc) return [];
  const columns = floc as Record<string, unknown>;
  return [1, 2, 3, 4, 5, 6]
    .map((n) => columns[`level${n}Id`])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}
