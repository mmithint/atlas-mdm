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
