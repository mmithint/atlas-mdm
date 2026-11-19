/**
 * The rules of the S-5 request form that the browser can know, as plain functions so they can be tested alone.
 *
 * These are HINTS to save a round trip: which fields offer a "request change" button, whether the typed value
 * differs from the current one, whether it obviously breaks the field's format. The server decides: the stored
 * procedure `app.usp_request_create` checks everything again (who may ask, the field, the value, duplicates), and
 * its refusal text is shown in the dialog. Where a hint copies a server rule it copies it exactly (see
 * `app.fn_value_check`), so the form is never stricter than the server.
 */
import { isBlank } from '@/lib/format';

import type { CreateArguments } from './change-request-api';
import type { FieldRow, FieldValueInput } from './detail-model';

/** The longest reason the request procedure accepts (`app.change_request.reason` is nvarchar(400)). */
export const REASON_MAX = 400;

/** The catalogue columns the form needs beyond what the field rows carry. */
export interface CatalogInfo {
  fieldCode: string;
  dataType?: string | null;
  maxLength?: number | null;
  allowedValuesSource?: string | null;
}

export interface BlockedField {
  fieldCode: string;
  reason: string;
}

export interface AllowedValue {
  fieldCode: string;
  value: string;
  order: number;
}

/** One catalogue field as the dialog and the row buttons need it. */
export interface FieldChoice {
  fieldCode: string;
  label: string;
  unit: string | null;
  /** EQUIPMENT (a heater field) or FLOC (a field of the heater's functional location). */
  entityType: 'EQUIPMENT' | 'FLOC';
  dataType: string;
  /** The SAP field length; null when the catalogue gives none. */
  maxLength: number | null;
  /** True for a drop-down field: the value must be one of the active allowed values. */
  valuesFromList: boolean;
  /** The value as shown (a number without trailing zeros). */
  current: string | null;
  /** The value as gold holds it, sent to the server as "the value I saw". */
  rawCurrent: string | null;
  responsibleRole: string | null;
  accountableRole: string | null;
  /** Why this person cannot request a change to the field, or null when they can. */
  unavailableReason: string | null;
}

const NOT_EDITABLE = 'This field cannot be changed by hand.';
const ADMIN_ONLY = 'Only an admin may change this field.';

/**
 * One choice per field row. A field is available when the catalogue marks it editable and the server did not list
 * it as blocked for this person (the admin-only classification fields). `values` supplies the raw gold value.
 */
export function buildFieldChoices(
  fields: readonly FieldRow[],
  catalog: readonly CatalogInfo[],
  values: readonly FieldValueInput[],
  blocked: readonly BlockedField[]
): FieldChoice[] {
  const infoByCode = new Map(catalog.map((c) => [c.fieldCode, c]));
  const rawByCode = new Map<string, string>();
  for (const v of values) if (v.fieldCode && !isBlank(v.currentValue)) rawByCode.set(v.fieldCode, String(v.currentValue));
  const blockedByCode = new Map(blocked.map((b) => [b.fieldCode, b.reason]));

  return fields.map((f): FieldChoice => {
    const info = infoByCode.get(f.fieldCode);
    const blockedReason = blockedByCode.get(f.fieldCode);
    return {
      fieldCode: f.fieldCode,
      label: f.label,
      unit: f.unit,
      entityType: f.entityType === 'FLOC' ? 'FLOC' : 'EQUIPMENT',
      dataType: info?.dataType ?? 'TEXT',
      maxLength: typeof info?.maxLength === 'number' ? info.maxLength : null,
      valuesFromList: info?.allowedValuesSource === 'LIST',
      current: f.current,
      rawCurrent: rawByCode.get(f.fieldCode) ?? f.current,
      responsibleRole: f.responsibleRole,
      accountableRole: f.accountableRole,
      unavailableReason: !f.isEditable ? NOT_EDITABLE : blockedReason !== undefined ? blockedReason.trim() || ADMIN_ONLY : null,
    };
  });
}

/** What is known about the person and the form options when a "request change" button is drawn. */
export interface AccessInput {
  person: 'loading' | 'unavailable' | 'not-registered' | 'registered';
  options: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; canSubmit: boolean };
}

/** Why no change request can be started at all right now (shown as the buttons' title), or null when one can. */
export function submitBlockReason({ person, options }: AccessInput): string | null {
  if (person === 'loading') return 'Checking who you are…';
  if (person === 'unavailable') return 'Your roles could not be loaded, so change requests are switched off.';
  if (person === 'not-registered') return 'Your sign-in is not linked to a person yet. Ask an admin to link it.';
  if (options.status === 'loading') return 'Checking what you may request…';
  if (options.status === 'error') return `What you may request could not be loaded: ${options.message}`;
  if (!options.canSubmit) return 'You are not allowed to submit change requests.';
  return null;
}

/** The active allowed values of one field in the catalogue's order. */
export function allowedFor(all: readonly AllowedValue[], fieldCode: string): string[] {
  return all
    .filter((a) => a.fieldCode === fieldCode)
    .sort((a, b) => a.order - b.order || a.value.localeCompare(b.value))
    .map((a) => a.value);
}

const trimmed = (v: string | null | undefined): string => (v ?? '').trim();

/**
 * True when the proposed value is the one already there. Text is compared exactly (the codes go to SAP as typed,
 * letter case included); a number field compares as numbers, so `2.5` equals `2.5000`. A blank current value
 * differs from any non-blank proposal.
 */
export function sameValue(current: string | null | undefined, proposed: string, dataType: string): boolean {
  const a = trimmed(current);
  const b = trimmed(proposed);
  if (dataType === 'DECIMAL' && a !== '' && b !== '' && isPlainNumber(a) && isPlainNumber(b)) return Number(a) === Number(b);
  return a === b;
}

/** Digits with at most one decimal point, at least one digit (what the server accepts for a number field). */
function isPlainNumber(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value) && /[0-9]/.test(value);
}

/**
 * Why the typed value obviously cannot be accepted, or null. Blank is not a problem here (the form just stays
 * unsubmittable). Mirrors `app.fn_value_check`: length, number format, the allowed list.
 */
export function valueProblem(field: FieldChoice, value: string, allowed: readonly string[]): string | null {
  const v = trimmed(value);
  if (v === '') return null;
  if (field.maxLength !== null && v.length > field.maxLength) {
    return `Too long: ${v.length} of ${field.maxLength} characters (the length of the SAP field).`;
  }
  if (field.dataType === 'DECIMAL') {
    const decimals = v.includes('.') ? v.slice(v.indexOf('.') + 1).length : 0;
    if (!isPlainNumber(v) || (v.match(/\./g) ?? []).length > 1 || decimals > 4) {
      return 'Enter a number: digits and one decimal point, at most 4 decimals.';
    }
  }
  if (field.valuesFromList && !allowed.includes(v)) return 'Choose one of the allowed values.';
  return null;
}

/** A short line under the value box saying what is expected. */
export function valueHint(field: FieldChoice): string {
  if (field.valuesFromList) return 'Choose one of the allowed values.';
  if (field.dataType === 'DECIMAL') return `A number${field.unit ? ` in ${field.unit}` : ''}: digits and one decimal point, at most 4 decimals.`;
  if (field.maxLength !== null) return `Up to ${field.maxLength} characters (the length of the SAP field).`;
  return 'Type the new value.';
}

/** True when the form may be submitted. */
export function canSubmit(field: FieldChoice | null, value: string, reason: string, allowed: readonly string[]): boolean {
  if (field === null || field.unavailableReason !== null) return false;
  if (trimmed(value) === '' || valueProblem(field, value, allowed) !== null) return false;
  if (sameValue(field.rawCurrent, value, field.dataType)) return false;
  const why = trimmed(reason);
  return why !== '' && why.length <= REASON_MAX;
}

/** The heater facts the request needs. */
export interface HeaterTarget {
  equipmentId: number;
  functionalLocation: string | null;
}

/**
 * The arguments of `createChangeRequest` for a request raised by hand on the desktop (source MANUAL). A field of the
 * heater is requested by heater id; a field of its functional location by the location (the function wants -1 as
 * the heater id then). The browser never names a table or a column: the field code is looked up in the catalogue.
 */
export function buildCreateArguments(heater: HeaterTarget, field: FieldChoice, value: string, reason: string): CreateArguments {
  const isFloc = field.entityType === 'FLOC';
  return {
    source: 'MANUAL',
    entityType: field.entityType,
    equipmentId: isFloc ? -1 : heater.equipmentId,
    functionalLocation: isFloc ? (heater.functionalLocation ?? '') : '',
    fieldCode: field.fieldCode,
    oldValue: field.rawCurrent ?? '',
    newValue: trimmed(value),
    reason: trimmed(reason),
    comment: '',
    evidenceJson: '',
  };
}
