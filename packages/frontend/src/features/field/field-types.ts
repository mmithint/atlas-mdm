/**
 * What the field view (S-6), the heater's evidence and verification sections (S-5) and the request's Evidence
 * tab (S-3) read and send. Columns follow `FINAL PLAN/09` §5 (`app.field_verification`, `app.file_index`,
 * `app.ai_extraction`). These are the shapes the APP-D preview uses (FINAL PLAN/11); APP-7 builds the functions
 * and may adjust them.
 */

/** The three TrueContext statuses (POC-APP-19), as stored. */
export type Mark = 'VERIFIED_CORRECT' | 'CORRECTION_REQUIRED' | 'DID_NOT_VERIFY';

export type PhotoType = 'NAMEPLATE' | 'OVERALL' | 'TAG' | 'OTHER';

/** One field of a heater with its latest mark (`app.vw_field_verification_latest`). */
export interface FieldMarkRow {
  fieldCode: string;
  label: string;
  isKey: boolean;
  currentValue: string | null;
  lastMark: Mark | null;
  markedBy: string | null;
  markedAtUtc: string | null;
  comment: string | null;
}

export interface HeaterVerification {
  equipmentId: number;
  verifiedKeyFields: number;
  keyFieldCount: number;
  /** Verified key fields ÷ key fields × 100 (working assumption WA-07). */
  pct: number;
  fields: FieldMarkRow[];
}

/** A photo in `app.file_index`. */
export interface PhotoRow {
  fileId: number;
  equipmentId: number;
  requestIds: number[];
  photoType: PhotoType;
  fileName: string;
  uploadedBy: string;
  uploadedAtUtc: string;
  /** Where the browser can show it. */
  url: string;
  /** True for the demo's generic sample images (Q-418: no client photos yet). */
  isSample: boolean;
}

/** A P&ID drawing linked to the heater's site (DE-6b index). */
export interface DrawingRow {
  documentNumber: string;
  sheet: string;
  revision: string;
  title: string;
  functionalLocation: string | null;
  tag: string | null;
}

export interface Evidence {
  photos: PhotoRow[];
  drawings: DrawingRow[];
}

/** One field as the field user submits it. */
export interface FieldEntry {
  fieldCode: string;
  mark: Mark;
  /** For CORRECTION_REQUIRED: the value seen on site (empty when unreadable). */
  newValue: string;
  /** Required for a correction (PTD-12). */
  comment: string;
  /** "Illegible" or "Not found": needs a photo, and no value is invented (Q-440). */
  unreadableReason: string;
}

export interface SubmitResult {
  marksWritten: number;
  requests: { fieldCode: string; requestId: number | null; requestRef: string | null; outcome: string }[];
  verificationPct: number;
}

export interface NameplateCandidate {
  equipmentId: number;
  equipmentNumber: string | null;
  tag: string | null;
  serialNumber: string | null;
  profitCenter: string | null;
  /** 0-100: how well the nameplate matches this heater. */
  score: number;
  reason: string;
}

/** What the AI read from a nameplate photo (`app.ai_extraction`). Nothing is applied without the person. */
export interface NameplateReading {
  manufacturer: string | null;
  modelNumber: string | null;
  serialNumber: string | null;
  /** 0-100. */
  confidence: number;
  candidates: NameplateCandidate[];
  /** Shown above the result when set (for example: a sample result in the demo). */
  notice: string | null;
}

// ---------------------------------------------------------------- the field form (S-6, TrueContext order)
// The page follows the client's TrueContext heater verification form (lakehouse table
// `dbo.Import_Truecontext_Heater_Verification`): location, equipment on site, existing equipment, then one
// block per field (current value, mark, corrected value), then photos. The form's own dependency and
// drop-down rules live in the mobile app and are not captured yet: the lists here are sample lists.

export type SiteKind = 'FACILITY' | 'WELL';

/** A facility or well where heaters stand (TrueContext SelectFacility / SelectWell). */
export interface FieldSite {
  /** TrueContext BusinessUnit; in ATLAS the profit centre (Q-490). */
  businessUnit: string;
  kind: SiteKind;
  name: string;
  /** TrueContext SelectSubAsset. */
  subAssets: string[];
  /** TrueContext FinalParentLocation: the FLOC the heaters sit under. */
  finalParentLocation: string;
}

export interface FieldLookups {
  sites: FieldSite[];
  /** Drop-down values by field code (sample lists). */
  lists: Record<string, string[]>;
  notice: string;
}

/** A heater at the chosen site (TrueContext EquipmentNumber pick list). */
export interface SiteHeater {
  equipmentId: number;
  equipmentNumber: string | null;
  tag: string | null;
  functionalLocation: string | null;
  description: string | null;
  manufacturer: string | null;
  verificationPct: number;
}

export type FormSection = 'EQUIPMENT' | 'ATTRIBUTES';

/** One block of the form: a catalogue field (can raise a request) or a TrueContext-only field (recorded only). */
export interface FormFieldRow extends FieldMarkRow {
  section: FormSection;
  /** CATALOG = field catalogue v1, a correction becomes a request; EXTRA = recorded with the form, no request. */
  source: 'CATALOG' | 'EXTRA';
  /** Only an admin or a rule may change it: a correction is recorded for the data owner, no request. */
  adminOnly: boolean;
  /** The TrueContext column this block fills (empty when the field is not on the TrueContext form). */
  trueContextColumn: string;
  input: 'TEXT' | 'NUMBER' | 'LIST';
  options: string[];
  unit: string | null;
  /** Manufacturer and model: "Does not exist in the list" lets the person type a value (ManufacturerDNE, ModelDNE). */
  allowDne: boolean;
  /** Set on S-13 (Mandatory fields): the field must be marked before Review. */
  mandatory: boolean;
  note: string | null;
}

export interface FieldForm {
  equipmentId: number;
  equipmentNumber: string | null;
  tag: string | null;
  functionalLocation: string | null;
  profitCenter: string | null;
  verifiedKeyFields: number;
  keyFieldCount: number;
  pct: number;
  fields: FormFieldRow[];
}

/** The top of the TrueContext form. */
export interface FormHeader {
  businessUnit: string;
  siteKind: SiteKind;
  site: string;
  subAsset: string;
  finalParentLocation: string;
  /** EquipOnsiteVerif. */
  onSite: boolean;
  /** ExistingEquipment. */
  existing: boolean;
}

export interface FieldFormEntry extends FieldEntry {
  /** The value was typed because it is not in the list (ManufacturerDNE, ModelDNE). */
  dne: boolean;
}

export interface FieldFormSubmit {
  /** 0 when the equipment was not found on site. */
  equipmentId: number;
  header: FormHeader;
  entries: FieldFormEntry[];
  photoIds: number[];
  /** Required when the equipment is not on site. */
  comment: string;
}

export interface FieldFormResult extends SubmitResult {
  referenceNumber: string;
  /** Corrections kept with the form that do not raise a request (TrueContext-only or admin-only fields). */
  recordedOnly: { fieldCode: string; label: string; newValue: string; why: string }[];
}
