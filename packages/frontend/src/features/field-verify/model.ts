/**
 * The Field view draft and its rules, as plain functions (no React): where the person is, which heater, what they
 * said about each field, and what blocks each step. The components only draw this and call these.
 */
import { FIELDS, HEATERS, LEVELS, LOCATIONS, REQUIRED_PHOTOS, SITE_KINDS, type FieldDef, type LocationLevel, type LocationNode, type SampleHeater, type SiteKind } from './config';

export type Step = 1 | 2 | 3 | 4;

/** The steps, with a few words on what each is for (shown under its name). */
export const STEPS: readonly { step: Step; label: string; hint: string }[] = [
  { step: 1, label: 'Location', hint: 'Where you are' },
  { step: 2, label: 'Equipment', hint: 'Find the heater' },
  { step: 3, label: 'Verify', hint: 'Check each field' },
  { step: 4, label: 'Review', hint: 'Check and submit' },
];
export type Status = 'CORRECT' | 'CORRECTION' | 'SKIP';

export interface Answer {
  status: Status | null;
  /** The corrected value; dimensions are "diameter x length". */
  value: string;
}

export interface Photo {
  id: string;
  /** Which required photo it is ("Nameplate"), or "Other". */
  label: string;
  name: string;
  url: string;
}

export interface Draft {
  step: Step;
  mode: SiteKind;
  path: Record<LocationLevel, string | null>;
  /** A note about a location missing from the list, sent with the submission. */
  missingLocation: string;
  onSite: boolean | null;
  inList: boolean | null;
  equipmentNo: string | null;
  missingNote: string;
  newEquipment: { equipClass: string; tag: string; manufacturer: string; notes: string };
  answers: Record<string, Answer>;
  comment: string;
}

export const EMPTY_DRAFT: Draft = {
  step: 1,
  mode: 'FACILITY',
  path: { BU: null, SUB_ASSET: null, SITE: null },
  missingLocation: '',
  onSite: null,
  inList: null,
  equipmentNo: null,
  missingNote: '',
  newEquipment: { equipClass: '', tag: '', manufacturer: '', notes: '' },
  answers: {},
  comment: '',
};

// ---- location -------------------------------------------------------------------------

const ORDER: readonly LocationLevel[] = ['BU', 'SUB_ASSET', 'SITE'];

export const nodeById = (id: string | null): LocationNode | undefined => LOCATIONS.find((n) => n.id === id);

/** The options of one level, under the chosen parent; sites only of the chosen kind. */
export function optionsAt(level: LocationLevel, path: Draft['path'], mode: SiteKind): LocationNode[] {
  const i = ORDER.indexOf(level);
  const parent = i === 0 ? null : path[ORDER[i - 1]!];
  if (i > 0 && parent === null) return [];
  return LOCATIONS.filter((n) => n.level === level && n.parentId === parent && (level !== 'SITE' || n.kind === mode));
}

/**
 * The path after choosing `id` at `level`: deeper levels are cleared, then any level with a single option is
 * chosen for the person. Returns the levels that were cleared (for the "cleared, Undo" toast).
 */
export function choose(path: Draft['path'], mode: SiteKind, level: LocationLevel, id: string | null): { path: Draft['path']; cleared: LocationLevel[] } {
  const i = ORDER.indexOf(level);
  const next = { ...path, [level]: id };
  const cleared: LocationLevel[] = [];
  for (const deeper of ORDER.slice(i + 1)) {
    if (next[deeper] !== null && path[level] !== id) cleared.push(deeper);
    if (path[level] !== id) next[deeper] = null;
  }
  return { path: autoPick(next, mode), cleared };
}

/** Chooses every level that has exactly one option, top down. */
export function autoPick(path: Draft['path'], mode: SiteKind): Draft['path'] {
  const next = { ...path };
  for (const level of ORDER) {
    if (next[level] !== null) continue;
    const options = optionsAt(level, next, mode);
    if (options.length !== 1) break;
    next[level] = options[0]!.id;
  }
  return next;
}

/** The path of a site found by search: its sub-asset and business unit above it. */
export function pathOf(siteId: string): Draft['path'] {
  const site = nodeById(siteId);
  const sub = nodeById(site?.parentId ?? null);
  return { BU: sub?.parentId ?? null, SUB_ASSET: sub?.id ?? null, SITE: site?.id ?? null };
}

export const fullPath = (siteId: string): string =>
  ORDER.map((l) => nodeById(pathOf(siteId)[l])?.label)
    .filter(Boolean)
    .join(' › ');

/** Every site of the chosen kind whose path contains the text. */
export function searchSites(query: string, mode: SiteKind): LocationNode[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  return LOCATIONS.filter((n) => n.level === 'SITE' && n.kind === mode && fullPath(n.id).toLowerCase().includes(q));
}

export const levelLabel = (level: LocationLevel, mode: SiteKind): string =>
  level === 'SITE' ? (SITE_KINDS.find((k) => k.kind === mode)?.label ?? 'Site') : (LEVELS.find((l) => l.level === level)?.label ?? level);

export const kindNoun = (mode: SiteKind): string => (SITE_KINDS.find((k) => k.kind === mode)?.label ?? 'site').toLowerCase();

// ---- equipment --------------------------------------------------------------------------

export const heatersAt = (siteId: string | null): SampleHeater[] => HEATERS.filter((h) => h.siteId === siteId);
export const heaterOf = (d: Draft): SampleHeater | undefined => HEATERS.find((h) => h.equipmentNo === d.equipmentNo);

/** What the visit produces: a verification of a listed heater, a missing equipment report, or a new equipment request. */
export type Outcome = 'VERIFY' | 'MISSING' | 'NEW';
export function outcomeOf(d: Draft): Outcome | null {
  if (d.onSite === false) return 'MISSING';
  if (d.onSite === true && d.inList === false) return 'NEW';
  if (d.onSite === true && d.inList === true) return 'VERIFY';
  return null;
}

// ---- verify -----------------------------------------------------------------------------

export const isReadOnly = (f: FieldDef, isAdmin: boolean): boolean => f.locked === true || (f.adminOnly === true && !isAdmin);

/** Why a corrected value is not acceptable; null when it is. */
export function valueProblem(f: FieldDef, value: string): string | null {
  const v = value.trim();
  if (v === '') return 'Enter the corrected value.';
  if (f.control === 'number' && !(Number.isFinite(Number(v)) && Number(v) >= 0)) return 'Enter a number of 0 or more.';
  if (f.control === 'dimensions') {
    const [d, l] = v.split('x').map((p) => Number(p.trim()));
    if (!(d! > 0 && l! > 0)) return 'Enter both the diameter and the length, in feet.';
  }
  if (f.control === 'list' && f.options && !f.options.includes(v)) return 'Choose one of the listed values.';
  return null;
}

const done = (a: Answer | undefined, f: FieldDef) => a?.status === 'CORRECT' || (a?.status === 'CORRECTION' && valueProblem(f, a.value) === null);

export function keyProgress(d: Draft, isAdmin: boolean): { done: number; total: number } {
  const keys = FIELDS.filter((f) => f.keyField && !isReadOnly(f, isAdmin));
  return { done: keys.filter((f) => done(d.answers[f.key], f)).length, total: keys.length };
}

export const requiredPhotos = (equipClass: string | null | undefined): readonly string[] =>
  REQUIRED_PHOTOS[equipClass ?? ''] ?? REQUIRED_PHOTOS['DEFAULT'] ?? [];

export interface Problem {
  /** The field row to jump to, or "photos". */
  target: string;
  message: string;
}

/** What blocks Submit: key fields not confirmed or corrected, invalid corrections, missing required photos. */
export function problemsOf(d: Draft, isAdmin: boolean, photos: readonly Photo[]): Problem[] {
  if (outcomeOf(d) !== 'VERIFY') return [];
  const out: Problem[] = [];
  for (const f of FIELDS) {
    if (isReadOnly(f, isAdmin)) continue;
    const a = d.answers[f.key];
    if (a?.status === 'CORRECTION' && valueProblem(f, a.value)) out.push({ target: f.key, message: `${f.label}: ${valueProblem(f, a.value)}` });
    else if (f.keyField && !done(a, f)) out.push({ target: f.key, message: `${f.label} is a key field: mark it Correct or enter a correction.` });
  }
  const sapClass = heaterOf(d)?.sap['equipClass'];
  for (const label of requiredPhotos(sapClass)) {
    if (!photos.some((p) => p.label === label)) out.push({ target: 'photos', message: `Add the required photo: ${label}.` });
  }
  return out;
}

// ---- steps ------------------------------------------------------------------------------

/** Why the person cannot go on from `step`; null when they can. */
export function blockedReason(d: Draft): string | null {
  if (d.step === 1) return d.path.SITE ? null : `Select a ${kindNoun(d.mode)} to continue`;
  if (d.step === 2) {
    const o = outcomeOf(d);
    if (d.onSite === null) return 'Answer whether the equipment is on site';
    if (d.onSite && d.inList === null) return 'Answer whether it is in the equipment list';
    if (o === 'VERIFY' && !d.equipmentNo) return 'Select a heater to continue';
    if (o === 'NEW' && (!d.newEquipment.equipClass || !d.newEquipment.tag.trim())) return 'Enter the class and tag of the new equipment';
  }
  return null;
}

/** Verify is only for a listed heater; missing and new equipment go straight to Review. */
export const nextStep = (d: Draft): Step => (d.step === 2 && outcomeOf(d) !== 'VERIFY' ? 4 : (Math.min(4, d.step + 1) as Step));
export const previousStep = (d: Draft): Step => (d.step === 4 && outcomeOf(d) !== 'VERIFY' ? 2 : (Math.max(1, d.step - 1) as Step));

