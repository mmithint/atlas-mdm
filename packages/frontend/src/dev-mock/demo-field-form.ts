/**
 * The field form of S-6 in the client demo (`npm run dev:mock` only; FINAL PLAN/11 §6 S-6, §5 L3).
 *
 * The form follows the client's TrueContext heater verification form (lakehouse table
 * `dbo.Import_Truecontext_Heater_Verification`, columns in `10_build_inputs/lakehouse_columns.csv`): location,
 * equipment on site, existing equipment, one block per field, photos. The mobile form's dependency and
 * drop-down rules are not captured yet, so every list here is a SAMPLE list and the sites are invented (`SYN-`).
 *
 * Catalogue fields go through `demo-field.ts` `submit` (marks, and one request per correction). Fields that are
 * on the TrueContext form but not in field catalogue v1, and admin-only fields, are recorded with the form and
 * raise no request (user decision of 20 Nov).
 */
import type { FieldForm, FieldFormEntry, FieldFormResult, FieldFormSubmit, FieldLookups, FieldSite, FormFieldRow, SiteHeater, SiteKind } from '@/features/field/field-types';

import type { SearchRow } from '../features/equipment/equipment-api';

import { fieldOf } from './catalog';
import * as field from './demo-field';
import { activeValues, demo, me, nowIso, PROFIT_CENTRES, verificationOf } from './demo-store';
import { Refusal } from './refusal';

// ---------------------------------------------------------------- sites (invented)

const shortOf = (pc: string): string =>
  pc
    .replace(/^OP (RES )?/, '')
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface HeaterSite {
  businessUnit: string;
  kind: SiteKind;
  name: string;
  subAsset: string;
  finalParentLocation: string;
}

/** Where a sample heater stands: one of three facilities (batteries) or three wells of its profit centre. */
function siteOf(h: SearchRow): HeaterSite {
  const pc = h.profitCenterName ?? PROFIT_CENTRES[0];
  const n = h.equipmentId;
  const kind: SiteKind = n % 4 === 0 ? 'WELL' : 'FACILITY';
  const idx = (n % 3) + 1;
  const short = shortOf(pc);
  return {
    businessUnit: pc,
    kind,
    name: kind === 'FACILITY' ? `SYN-${short}-BATTERY-${idx}` : `SYN-${short}-WELL-${String(idx).padStart(3, '0')}H`,
    subAsset: n % 2 === 0 ? 'Sub-asset A (sample)' : 'Sub-asset B (sample)',
    finalParentLocation: `SYN-FL-${short}-${kind === 'WELL' ? 'W' : 'F'}${idx}`,
  };
}

// ---------------------------------------------------------------- the blocks, in TrueContext order

const SERVICES = ['Oil treating', 'Gas line heater', 'Water bath', 'Glycol reboiler'];
const MATERIALS = ['Carbon steel', 'Stainless steel'];
const CLASSES = ['HEATER', 'HEATER_TREATER', 'LINE_HEATER'];

interface BlockDef {
  code: string;
  section: FormFieldRow['section'];
  trueContextColumn: string;
  /** For a field that is not in the catalogue. */
  extra?: { label: string; input: FormFieldRow['input']; unit: string | null; value: (h: SearchRow) => string | null };
  allowDne?: boolean;
  note?: string;
}

const BLOCKS: readonly BlockDef[] = [
  { code: 'EQUIPMENT_USER_STATUS', section: 'EQUIPMENT', trueContextColumn: 'EquipmentUserStatusD' },
  { code: 'FLOC_CLASS', section: 'EQUIPMENT', trueContextColumn: 'FLOCClassDesc' },
  { code: 'EQUIP_CLASS', section: 'EQUIPMENT', trueContextColumn: 'EquipmentClassDescri' },
  { code: 'EQUIPMENT_TAG_NUMBER', section: 'EQUIPMENT', trueContextColumn: 'EquipmentTagNumber' },
  { code: 'MANUFACTURER', section: 'EQUIPMENT', trueContextColumn: 'EquipManufacturer', allowDne: true },
  { code: 'MODEL_NUMBER', section: 'EQUIPMENT', trueContextColumn: 'EquipmentModelNumber', allowDne: true },
  { code: 'SERIAL_NUMBER', section: 'EQUIPMENT', trueContextColumn: 'EquipSerialNumber' },
  {
    code: 'SIZE_DIM',
    section: 'EQUIPMENT',
    trueContextColumn: 'EquipSizeDim',
    extra: { label: 'Size / dimensions', input: 'TEXT', unit: null, value: (h) => `${4 + (h.equipmentId % 4)} ft x ${10 + (h.equipmentId % 10)} ft` },
  },
  { code: 'CLASS_TYPE', section: 'EQUIPMENT', trueContextColumn: 'ClassType' },
  { code: 'FIRED_UNFIRED', section: 'ATTRIBUTES', trueContextColumn: '', note: 'ATLAS key field; not on the TrueContext form today.' },
  { code: 'HEAT_DUTY', section: 'ATTRIBUTES', trueContextColumn: 'HeatDutyMMBTUhr' },
  { code: 'BURNER_COUNT', section: 'ATTRIBUTES', trueContextColumn: 'BurnerCount', extra: { label: 'Burner count', input: 'NUMBER', unit: null, value: (h) => String(1 + (h.equipmentId % 3)) } },
  { code: 'SERVICE', section: 'ATTRIBUTES', trueContextColumn: 'Service', extra: { label: 'Service', input: 'LIST', unit: null, value: (h) => SERVICES[h.equipmentId % SERVICES.length] } },
  { code: 'LENGTH_FT', section: 'ATTRIBUTES', trueContextColumn: 'Length _FEET_', extra: { label: 'Length', input: 'NUMBER', unit: 'ft', value: (h) => (10 + (h.equipmentId % 10)).toFixed(1) } },
  { code: 'DESIGN_PRESSURE', section: 'ATTRIBUTES', trueContextColumn: 'DesignPressure', extra: { label: 'Design pressure', input: 'NUMBER', unit: 'psig', value: (h) => String(100 + (h.equipmentId % 6) * 25) } },
  { code: 'DESIGN_TEMPERATURE', section: 'ATTRIBUTES', trueContextColumn: 'DesignTemperature', extra: { label: 'Design temperature', input: 'NUMBER', unit: '°F', value: (h) => String(200 + (h.equipmentId % 5) * 50) } },
  { code: 'MATERIAL', section: 'ATTRIBUTES', trueContextColumn: 'MaterialConstruction', extra: { label: 'Material of construction', input: 'LIST', unit: null, value: (h) => MATERIALS[h.equipmentId % MATERIALS.length] } },
  { code: 'NATIONAL_BOARD', section: 'ATTRIBUTES', trueContextColumn: 'NationalBoardNumber', extra: { label: 'National Board number', input: 'TEXT', unit: null, value: (h) => (h.equipmentId % 6 === 0 ? null : `SYN-NB-${10000 + h.equipmentId}`) } },
];

function lists(): Record<string, string[]> {
  const fromCatalog = (code: string) => activeValues(code);
  const distinct = (pick: (h: SearchRow) => string | null) => [...new Set(demo().heaters.map(pick).filter((v): v is string => !!v))].sort();
  return {
    EQUIPMENT_USER_STATUS: fromCatalog('EQUIPMENT_USER_STATUS'),
    FIRED_UNFIRED: fromCatalog('FIRED_UNFIRED'),
    MANUFACTURER: distinct((h) => h.manufacturer),
    MODEL_NUMBER: distinct((h) => h.modelNumber),
    FLOC_CLASS: CLASSES,
    EQUIP_CLASS: CLASSES,
    CLASS_TYPE: CLASSES,
    SERVICE: SERVICES,
    MATERIAL: MATERIALS,
  };
}

const blockOf = (code: string) => BLOCKS.find((b) => b.code === code);

// ---------------------------------------------------------------- reads

export function lookups(): FieldLookups {
  const sites = new Map<string, FieldSite>();
  for (const h of demo().heaters) {
    const s = siteOf(h);
    const site = sites.get(s.name) ?? { businessUnit: s.businessUnit, kind: s.kind, name: s.name, subAssets: [], finalParentLocation: s.finalParentLocation };
    if (!site.subAssets.includes(s.subAsset)) site.subAssets.push(s.subAsset);
    sites.set(s.name, site);
  }
  for (const s of sites.values()) s.subAssets.sort();
  return {
    sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    lists: lists(),
    notice: '',
  };
}

export function siteHeaters(site: string, subAsset: string): { heaters: SiteHeater[] } {
  const heaters = demo()
    .heaters.filter((h) => {
      const s = siteOf(h);
      return s.name === site && (subAsset === '' || s.subAsset === subAsset);
    })
    .map((h) => ({
      equipmentId: h.equipmentId,
      equipmentNumber: h.equipmentNumber,
      tag: h.equipmentTagNumber,
      functionalLocation: h.functionalLocation,
      description: h.equipmentDescription,
      manufacturer: h.manufacturer,
      verificationPct: verificationOf(h.equipmentId).pct,
    }));
  return { heaters };
}

/** The last recorded mark of a TrueContext-only field (they are kept on the forms, not in the marks). */
function lastExtraMark(equipmentId: number, code: string) {
  const forms = demo().fieldForms.filter((f) => f.equipmentId === equipmentId);
  for (let i = forms.length - 1; i >= 0; i -= 1) {
    const e = forms[i].entries.find((x) => x.fieldCode === code);
    if (e) return { mark: e.mark, by: forms[i].by, atUtc: forms[i].atUtc, comment: e.comment || e.unreadableReason || null };
  }
  return null;
}

export function form(equipmentId: number): FieldForm {
  const h = demo().heaters.find((x) => x.equipmentId === equipmentId);
  if (!h) throw new Refusal('There is no such heater (sample data).', 50501);
  const v = field.verification(equipmentId);
  const all = lists();
  const fields: FormFieldRow[] = BLOCKS.map((b) => {
    const common = { mandatory: !b.extra && demo().admin.mandatory.includes(b.code), section: b.section, trueContextColumn: b.trueContextColumn, allowDne: b.allowDne ?? false, note: b.note ?? null, options: all[b.code] ?? [] };
    if (b.extra) {
      const m = lastExtraMark(equipmentId, b.code);
      return {
        ...common,
        fieldCode: b.code,
        label: b.extra.label,
        isKey: false,
        currentValue: b.extra.value(h),
        lastMark: m?.mark ?? null,
        markedBy: m?.by ?? null,
        markedAtUtc: m?.atUtc ?? null,
        comment: m?.comment ?? null,
        source: 'EXTRA',
        adminOnly: false,
        input: b.extra.input,
        unit: b.extra.unit,
      };
    }
    const c = fieldOf(b.code);
    const row = v.fields.find((x) => x.fieldCode === b.code);
    if (!c || !row) throw new Error(`${b.code} is not in the catalogue`);
    return {
      ...common,
      ...row,
      source: 'CATALOG',
      adminOnly: c.adminOnly,
      input: (all[b.code]?.length ?? 0) > 0 ? 'LIST' : c.dataType === 'DECIMAL' ? 'NUMBER' : 'TEXT',
      unit: c.unit,
    };
  });
  return {
    equipmentId,
    equipmentNumber: h.equipmentNumber,
    tag: h.equipmentTagNumber,
    functionalLocation: h.functionalLocation,
    profitCenter: h.profitCenterName,
    verifiedKeyFields: v.verifiedKeyFields,
    keyFieldCount: v.keyFieldCount,
    pct: v.pct,
    fields,
  };
}

// ---------------------------------------------------------------- submit

function extraProblem(e: FieldFormEntry, label: string, input: FormFieldRow['input'], current: string | null, photoCount: number): string | null {
  if (e.mark !== 'CORRECTION_REQUIRED') return null;
  if (!e.comment.trim()) return `${label}: say why it needs correcting.`;
  if (e.unreadableReason) return photoCount === 0 ? `${label}: "${e.unreadableReason}" needs a photo.` : null;
  const value = e.newValue.trim();
  if (!value) return `${label}: type the value you see, or mark it illegible / not found.`;
  if (value === (current ?? '').trim()) return `${label}: the new value is the same as the current one.`;
  if (input === 'NUMBER' && !Number.isFinite(Number(value))) return `${label}: must be a number.`;
  return null;
}

export function submitForm(input: FieldFormSubmit): FieldFormResult {
  const s = demo();
  const referenceNumber = `SYN-FV-${String(s.fieldForms.length + 1).padStart(5, '0')}`;
  const record = { ...input, referenceNumber, by: me(), atUtc: nowIso() };

  // Equipment not on site, or not in the list: the form is kept, nothing else happens.
  if (input.equipmentId === 0 || !input.header.onSite) {
    if (!input.comment.trim()) throw new Refusal('Say what you found on site.', 50507);
    s.fieldForms.push({ ...record, entries: [] });
    return { referenceNumber, marksWritten: 0, requests: [], recordedOnly: [], verificationPct: input.equipmentId ? verificationOf(input.equipmentId).pct : 0 };
  }

  const h = s.heaters.find((x) => x.equipmentId === input.equipmentId);
  if (!h) throw new Refusal('There is no such heater (sample data).', 50501);
  if (input.entries.length === 0) throw new Refusal('Mark at least one field.', 50505);
  const missing = s.admin.mandatory.filter((code) => blockOf(code) && !input.entries.some((e) => e.fieldCode === code));
  if (missing.length > 0) throw new Refusal(`Mandatory, please mark: ${missing.map((c) => fieldOf(c)?.label ?? c).join(', ')}.`, 50508);
  const photoCount = s.photos.filter((p) => input.photoIds.includes(p.fileId) && p.equipmentId === h.equipmentId).length;

  // Check every TrueContext-only field before anything is written.
  const recordedOnly: FieldFormResult['recordedOnly'] = [];
  for (const e of input.entries) {
    const b = blockOf(e.fieldCode);
    if (!b) throw new Refusal(`${e.fieldCode} is not on the form.`, 50506);
    if (b.extra) {
      const problem = extraProblem(e, b.extra.label, b.extra.input, b.extra.value(h), photoCount);
      if (problem) throw new Refusal(problem, 50506);
      if (e.mark === 'CORRECTION_REQUIRED' && !e.unreadableReason) recordedOnly.push({ fieldCode: e.fieldCode, label: b.extra.label, newValue: e.newValue.trim(), why: 'Not in field catalogue v1: kept with the form.' });
    }
  }

  // Admin-only catalogue fields: the mark is written, a correction is kept for the data owner (no request).
  const catalog = input.entries.filter((e) => !blockOf(e.fieldCode)?.extra);
  const adminCorrections = catalog.filter((e) => fieldOf(e.fieldCode)?.adminOnly && e.mark === 'CORRECTION_REQUIRED');
  for (const e of adminCorrections) {
    if (!e.comment.trim()) throw new Refusal(`${fieldOf(e.fieldCode)?.label ?? e.fieldCode}: say why it needs correcting.`, 50506);
  }
  const throughWorkflow = catalog.filter((e) => !adminCorrections.includes(e));

  const result = throughWorkflow.length > 0 ? field.submit(h.equipmentId, throughWorkflow, input.photoIds) : null;

  const marks = s.marks.get(h.equipmentId) ?? new Map();
  for (const e of adminCorrections) {
    marks.set(e.fieldCode, { mark: e.mark, by: me(), atUtc: record.atUtc, comment: e.comment.trim() });
    if (!e.unreadableReason) recordedOnly.push({ fieldCode: e.fieldCode, label: fieldOf(e.fieldCode)?.label ?? e.fieldCode, newValue: e.newValue.trim(), why: 'Only an admin or a rule changes this field: kept for the data owner.' });
  }
  s.marks.set(h.equipmentId, marks);
  s.fieldForms.push(record);

  return {
    referenceNumber,
    marksWritten: input.entries.length,
    requests: result?.requests ?? [],
    recordedOnly,
    verificationPct: verificationOf(h.equipmentId).pct,
  };
}

