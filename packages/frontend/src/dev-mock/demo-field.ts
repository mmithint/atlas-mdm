/**
 * Field work and verification in the client demo (`npm run dev:mock` only; FINAL PLAN/11 §6 S-6, S-5, S-3,
 * S-10 and §5 L3). In outline it follows what APP-7 and APP-9 build: marks per field, photos linked to the
 * heater and its requests, corrections through the one request door, and the verification % (WA-07).
 */
import type { DrawingRow, Evidence, FieldEntry, HeaterVerification, NameplateReading, PhotoRow, PhotoType, SubmitResult } from '@/features/field/field-types';
import type { Scorecard, ScoreTotals } from '@/features/measures/measures-types';

import { CATALOG, fieldOf, fieldValueOf } from './catalog';
import { activeValues, createRequest, demo, me, nowIso, PROFIT_CENTRES, refreshHeater, verificationOf } from './demo-store';
import { Refusal } from './refusal';

/** The goal of the client's programme: 75% of heaters fully verified by 2027 (not a POC pass mark). */
const GOAL_PCT = 75;
/** 10 MiB, the photo limit; a data URL is about 4/3 of the file. */
const MAX_DATA_URL = Math.ceil((10 * 1024 * 1024 * 4) / 3) + 200;

function heaterOrRefuse(equipmentId: number) {
  const h = demo().heaters.find((x) => x.equipmentId === equipmentId);
  if (!h) throw new Refusal('There is no such heater (sample data).', 50501);
  return h;
}

export function verification(equipmentId: number): HeaterVerification {
  const h = heaterOrRefuse(equipmentId);
  const marks = demo().marks.get(equipmentId);
  const v = verificationOf(equipmentId);
  return {
    equipmentId,
    verifiedKeyFields: v.verified,
    keyFieldCount: v.keys,
    pct: v.pct,
    fields: CATALOG.map((c) => {
      const m = marks?.get(c.fieldCode);
      return {
        fieldCode: c.fieldCode,
        label: c.label,
        isKey: c.isKey,
        currentValue: fieldValueOf(h, c.fieldCode),
        lastMark: m?.mark ?? null,
        markedBy: m?.by ?? null,
        markedAtUtc: m?.atUtc ?? null,
        comment: m?.comment ?? null,
      };
    }),
  };
}

/** Two drawings of the heater's site (DE-6b index), invented: document numbers start with SYN-PID. */
function drawingsFor(equipmentId: number): DrawingRow[] {
  const h = heaterOrRefuse(equipmentId);
  const n = String((equipmentId % 7) + 1).padStart(3, '0');
  return [
    { documentNumber: `SYN-PID-${n}`, sheet: String((equipmentId % 3) + 1), revision: 'C', title: 'Heater treater and fuel gas piping (sample)', functionalLocation: h.superiorFunctionalLocation, tag: h.equipmentTagNumber },
    { documentNumber: `SYN-PID-${n}-R`, sheet: '1', revision: 'B', title: 'Relief and flare header (sample)', functionalLocation: h.superiorFunctionalLocation, tag: null },
  ];
}

export function evidence(equipmentId: number, requestId: number): Evidence {
  heaterOrRefuse(equipmentId);
  const photos = demo()
    .photos.filter((p) => p.equipmentId === equipmentId && (requestId === 0 || p.requestIds.includes(requestId)))
    .sort((a, b) => b.uploadedAtUtc.localeCompare(a.uploadedAtUtc));
  return { photos, drawings: drawingsFor(equipmentId) };
}

export function registerPhoto(input: { equipmentId: number; fileName: string; contentType: string; photoType: PhotoType; dataUrl: string }): PhotoRow {
  heaterOrRefuse(input.equipmentId);
  if (!/^image\//.test(input.contentType)) throw new Refusal('Only images can be attached here.', 50502);
  if (input.dataUrl.length > MAX_DATA_URL) throw new Refusal('The photo is larger than 10 MB.', 50503);
  const photo: PhotoRow = {
    fileId: demo().nextPhotoId++,
    equipmentId: input.equipmentId,
    requestIds: [],
    photoType: input.photoType,
    fileName: input.fileName || 'photo',
    uploadedBy: me(),
    uploadedAtUtc: nowIso(),
    url: input.dataUrl,
    isSample: input.fileName.startsWith('sample-'),
  };
  demo().photos.push(photo);
  return photo;
}

/**
 * A FIXED sample answer standing in for the OxyGPT Equipment IQ Agent (D-10, D-21; S5 not passed). It reads
 * back the heater's own maker and model and a serial one character different, so the demo can show a correction.
 */
export function extractNameplate(equipmentId: number, fileId: number): NameplateReading {
  const h = heaterOrRefuse(equipmentId);
  const photo = demo().photos.find((p) => p.fileId === fileId && p.equipmentId === equipmentId);
  if (!photo) throw new Refusal('Attach the nameplate photo first.', 50504);
  const serial = `${h.manufacturerSerialNumber ?? 'SYN-SN'}-B`;
  const others = demo()
    .heaters.filter((x) => x.equipmentId !== equipmentId && x.profitCenterName === h.profitCenterName && x.manufacturer === h.manufacturer)
    .slice(0, 2);
  return {
    manufacturer: h.manufacturer,
    modelNumber: h.modelNumber,
    serialNumber: serial,
    confidence: 87,
    candidates: [
      { equipmentId: h.equipmentId, equipmentNumber: h.equipmentNumber, tag: h.equipmentTagNumber, serialNumber: h.manufacturerSerialNumber, profitCenter: h.profitCenterName, score: 92, reason: 'This site; manufacturer and model match; serial differs by one character' },
      ...others.map((x, i) => ({
        equipmentId: x.equipmentId,
        equipmentNumber: x.equipmentNumber,
        tag: x.equipmentTagNumber,
        serialNumber: x.manufacturerSerialNumber,
        profitCenter: x.profitCenterName,
        score: 61 - i * 13,
        reason: 'Same manufacturer at this site; serial does not match',
      })),
    ],
    notice: 'Sample result: OxyGPT is not connected yet (spike S5). In the real app the Equipment IQ Agent reads the photo; nothing is applied without you.',
  };
}

/** Input rules at entry (PTD-12), checked again here as the procedure will. Returns the problem, or null. */
function entryProblem(e: FieldEntry, current: string | null, photoCount: number): string | null {
  const field = fieldOf(e.fieldCode);
  if (!field) return `${e.fieldCode} is not a catalogue field.`;
  if (e.mark !== 'CORRECTION_REQUIRED') return null;
  if (!e.comment.trim()) return `${field.label}: say why it needs correcting.`;
  if (e.unreadableReason) return photoCount === 0 ? `${field.label}: "${e.unreadableReason}" needs a photo.` : null;
  const value = e.newValue.trim();
  if (!value) return `${field.label}: type the value you see, or mark it illegible / not found.`;
  if (value === (current ?? '').trim()) return `${field.label}: the new value is the same as the current one.`;
  if (field.dataType === 'DECIMAL' && !Number.isFinite(Number(value))) return `${field.label}: must be a number (${field.unit ?? ''}).`;
  if (field.maxLength !== null && value.length > field.maxLength) return `${field.label}: at most ${field.maxLength} characters.`;
  if (field.allowedValuesSource === 'LIST' && !activeValues(field.fieldCode).includes(value)) {
    return `${field.label}: pick one of the allowed values.`;
  }
  return null;
}

/** `app.usp_field_verification_submit`: one mark per field; each correction becomes its own request with the photos. */
export function submit(equipmentId: number, entries: readonly FieldEntry[], photoIds: readonly number[]): SubmitResult {
  const h = heaterOrRefuse(equipmentId);
  if (entries.length === 0) throw new Refusal('Mark at least one field.', 50505);
  const photos = demo().photos.filter((p) => photoIds.includes(p.fileId) && p.equipmentId === equipmentId);
  for (const e of entries) {
    const problem = entryProblem(e, fieldValueOf(h, e.fieldCode), photos.length);
    if (problem) throw new Refusal(problem, 50506);
  }

  const now = nowIso();
  const marks = demo().marks.get(equipmentId) ?? new Map();
  const requests: SubmitResult['requests'] = [];
  for (const e of entries) {
    marks.set(e.fieldCode, { mark: e.mark, by: me(), atUtc: now, comment: e.comment.trim() || e.unreadableReason || null });
    if (e.mark !== 'CORRECTION_REQUIRED' || e.unreadableReason) continue;
    const { outcome, row } = createRequest({
      heater: h,
      fieldCode: e.fieldCode,
      oldValue: fieldValueOf(h, e.fieldCode),
      newValue: e.newValue.trim(),
      reason: e.comment.trim(),
      sourceType: 'FIELD',
      requestedBy: me(),
      photoCount: photos.length,
    });
    if (outcome === 'CREATED') for (const p of photos) p.requestIds.push(row.requestId);
    requests.push({ fieldCode: e.fieldCode, requestId: row.requestId, requestRef: row.requestRef, outcome });
  }
  demo().marks.set(equipmentId, marks);
  refreshHeater(demo(), h);
  return { marksWritten: entries.length, requests, verificationPct: verificationOf(equipmentId).pct };
}

function totalsOf(pcts: readonly number[]): ScoreTotals {
  const heaters = pcts.length;
  const fully = pcts.filter((p) => p >= 100).length;
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    heaters,
    avgPct: heaters === 0 ? 0 : round(pcts.reduce((a, b) => a + b, 0) / heaters),
    fullyVerified: fully,
    shareFullyVerified: heaters === 0 ? 0 : round((fully / heaters) * 100),
  };
}

export function scorecard(profitCenter: string): Scorecard {
  const keys = CATALOG.filter((c) => c.isKey);
  const pctOf = (id: number) => verificationOf(id).pct;
  const units = PROFIT_CENTRES.map((pc) => ({ profitCenter: pc, ...totalsOf(demo().heaters.filter((h) => h.profitCenterName === pc).map((h) => pctOf(h.equipmentId))) }))
    .filter((u) => u.heaters > 0)
    .sort((a, b) => b.avgPct - a.avgPct);
  const heaters = profitCenter
    ? demo()
        .heaters.filter((h) => h.profitCenterName === profitCenter)
        .map((h) => {
          const marks = demo().marks.get(h.equipmentId);
          return {
            equipmentId: h.equipmentId,
            equipmentNumber: h.equipmentNumber,
            tag: h.equipmentTagNumber,
            pct: pctOf(h.equipmentId),
            keyMarks: keys.map((k) => ({ fieldCode: k.fieldCode, label: k.label, verified: marks?.get(k.fieldCode)?.mark === 'VERIFIED_CORRECT' })),
          };
        })
        .sort((a, b) => a.pct - b.pct)
    : [];
  return {
    goalPct: GOAL_PCT,
    formula: `A heater's % = key fields marked Verified Correct ÷ ${keys.length} key fields (${keys.map((k) => k.label.toLowerCase()).join(', ')}). "Did not verify" never counts. Working assumption WA-07 until Q-454 is answered; business unit = profit centre (Q-490).`,
    totals: totalsOf(demo().heaters.map((h) => pctOf(h.equipmentId))),
    units,
    heaters,
  };
}
