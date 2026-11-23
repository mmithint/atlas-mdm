import clsx from 'clsx';
import { Camera, Check, ChevronLeft, ChevronRight, MapPin, Send, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import { hrefFor } from '@/app/router';
import { PageHeader, Panel, Pill } from '@/components/layout';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { button, input } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';
import { formatPercent } from '@/lib/format';

import { fetchFieldForm, fetchFieldLookups, fetchSiteHeaters, readNameplate, registerPhoto, submitFieldForm } from './field-api';
import { FieldBlock } from './field-block.component';
import { EMPTY_ENTRY, MARK_LABEL, type BlockEntry } from './field-model';
import type { FieldForm, FieldFormResult, FieldLookups, FormHeader, NameplateReading, PhotoRow, PhotoType, SiteKind } from './field-types';

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: 'Location' },
  { n: 2, label: 'Equipment' },
  { n: 3, label: 'Verify' },
  { n: 4, label: 'Review' },
];

const PHOTO_TYPES: { value: PhotoType; label: string }[] = [
  { value: 'NAMEPLATE', label: 'Nameplate' },
  { value: 'OVERALL', label: 'Whole heater' },
  { value: 'TAG', label: 'Tag plate' },
  { value: 'OTHER', label: 'Other' },
];

/** The demo's generic sample images; loaded only under `npm run dev:mock`, so a production build has none. */
async function sampleImages(): Promise<{ id: string; label: string; photoType: PhotoType; fileName: string; url: string }[]> {
  if (!(import.meta.env.DEV && import.meta.env.MODE === 'mock')) return [];
  return [...(await import('@/dev-mock/sample-images')).SAMPLE_IMAGES];
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
    reader.readAsDataURL(file);
  });

const EMPTY_HEADER: FormHeader = { businessUnit: '', siteKind: 'FACILITY', site: '', subAsset: '', finalParentLocation: '', onSite: true, existing: true };

/**
 * S-6 Field view (APP-7; `guide/app/S-06` §2), in the order of the client's TrueContext heater verification
 * form: location → equipment on site / existing → one block per field → photos → review and submit.
 * Phone-friendly: one column, large touch targets. Catalogue corrections become approval requests; the
 * TrueContext-only fields are recorded with the form.
 */
export function FieldView() {
  const lookups = useLoad('field-lookups', fetchFieldLookups);
  return (
    <div className="mx-auto max-w-7xl space-y-400">
      <PageHeader
        title="Field view" />
      {lookups.status === 'loading' ? <LoadingState rows={4} label="Loading the sites" /> : null}
      {lookups.status === 'error' ? <ErrorState message={lookups.message} onRetry={lookups.retry} /> : null}
      {lookups.status === 'ready' ? <FieldWizard lookups={lookups.data} /> : null}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap gap-200 text-200" aria-label="Steps">
      {STEPS.map((s) => (
        <li
          key={s.n}
          aria-current={step === s.n ? 'step' : undefined}
          className={clsx('flex items-center gap-100 rounded-full border px-300 py-100', step === s.n ? 'border-primary bg-primary text-primary-foreground' : step > s.n ? 'border-success-border text-foreground' : 'border-border text-muted-foreground')}
        >
          {step > s.n ? <Check aria-hidden="true" className="icon-size-100" /> : <span>{s.n}</span>}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

function FieldWizard({ lookups }: { lookups: FieldLookups }) {
  const [step, setStep] = useState<Step>(1);
  const [header, setHeader] = useState<FormHeader>(EMPTY_HEADER);
  const [equipmentId, setEquipmentId] = useState(0);
  const [entries, setEntries] = useState<Record<string, BlockEntry>>({});
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<FieldFormResult | null>(null);

  const startOver = (keepLocation: boolean) => {
    setStep(keepLocation ? 2 : 1);
    if (!keepLocation) setHeader(EMPTY_HEADER);
    else setHeader((h) => ({ ...h, onSite: true, existing: true }));
    setEquipmentId(0);
    setEntries({});
    setPhotos([]);
    setComment('');
    setResult(null);
  };

  return (
    <div className="space-y-400">
      {step <= 4 ? <StepBar step={step} /> : null}
      <p className="rounded-md border border-dashed border-border px-300 py-200 text-200 text-muted-foreground">{lookups.notice}</p>

      {step === 1 ? <LocationStep lookups={lookups} header={header} onChange={setHeader} onNext={() => setStep(2)} /> : null}
      {step === 2 ? (
        <EquipmentStep
          header={header}
          onChange={setHeader}
          equipmentId={equipmentId}
          onPick={setEquipmentId}
          comment={comment}
          onComment={setComment}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
          onSaved={(r) => {
            setResult(r);
            setStep(5);
          }}
        />
      ) : null}
      {step === 3 || step === 4 ? (
        <HeaterForm
          step={step}
          header={header}
          equipmentId={equipmentId}
          entries={entries}
          onEntries={setEntries}
          photos={photos}
          onPhotos={setPhotos}
          onStep={setStep}
          onDone={(r) => {
            setResult(r);
            setStep(5);
          }}
        />
      ) : null}
      {step === 5 && result ? <Done result={result} equipmentId={equipmentId} onAnother={() => startOver(true)} onNewSite={() => startOver(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- step 1: location

function LocationStep({ lookups, header, onChange, onNext }: { lookups: FieldLookups; header: FormHeader; onChange: (h: FormHeader) => void; onNext: () => void }) {
  const units = useMemo(() => [...new Set(lookups.sites.map((s) => s.businessUnit))].sort(), [lookups.sites]);
  const sites = lookups.sites.filter((s) => s.businessUnit === header.businessUnit && s.kind === header.siteKind);
  const site = lookups.sites.find((s) => s.name === header.site);
  const set = (patch: Partial<FormHeader>) => onChange({ ...header, ...patch });
  const pickSite = (name: string) => {
    const s = lookups.sites.find((x) => x.name === name);
    set({ site: name, subAsset: s?.subAssets.length === 1 ? s.subAssets[0] : '', finalParentLocation: s?.finalParentLocation ?? '' });
  };
  const useMyLocation = () => {
    const s = lookups.sites.find((x) => x.kind === 'FACILITY' && x.businessUnit === (header.businessUnit || x.businessUnit));
    if (s) onChange({ ...header, businessUnit: s.businessUnit, siteKind: s.kind, site: s.name, subAsset: s.subAssets[0] ?? '', finalParentLocation: s.finalParentLocation });
  };

  return (
    <Panel
      title="Where are you?"
      hint="Business unit, then facility or well, then the sub-asset."
    // actions={
    //   <button type="button" className={button.small} onClick={useMyLocation} title="Sample: picks the first sample facility. On a phone this uses the device location.">
    //     <MapPin aria-hidden="true" className="icon-size-100" />
    //     Use my location
    //   </button>
    // }
    >
      <div className="space-y-300">
        <label className="block text-200">
          <span className="text-muted-foreground">Business unit</span>
          <select className={input} value={header.businessUnit} onChange={(e) => onChange({ ...EMPTY_HEADER, businessUnit: e.target.value, siteKind: header.siteKind })}>
            <option value="">Pick a business unit</option>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <div role="radiogroup" aria-label="Facility or well" className="grid grid-cols-2 gap-200">
          {(['FACILITY', 'WELL'] as SiteKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={header.siteKind === k}
              onClick={() => set({ siteKind: k, site: '', subAsset: '', finalParentLocation: '' })}
              className={clsx('rounded-md border px-300 py-200 text-300 font-medium', header.siteKind === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent')}
            >
              {k === 'FACILITY' ? 'Facility' : 'Well'}
            </button>
          ))}
        </div>

        <label className="block text-200">
          <span className="text-muted-foreground">{header.siteKind === 'FACILITY' ? 'Facility' : 'Well'}</span>
          <select className={input} value={header.site} disabled={!header.businessUnit} onChange={(e) => pickSite(e.target.value)}>
            <option value="">{sites.length === 0 && header.businessUnit ? 'None in this business unit' : 'Pick one'}</option>
            {sites.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-200">
          <span className="text-muted-foreground">Sub-asset</span>
          <select className={input} value={header.subAsset} disabled={!site} onChange={(e) => set({ subAsset: e.target.value })}>
            <option value="">Pick a sub-asset</option>
            {(site?.subAssets ?? []).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <p className="text-300">
          <span className="text-muted-foreground">Final parent location: </span>
          <span className="font-mono">{header.finalParentLocation || '—'}</span>
        </p>

        <div className="flex justify-end">
          <button type="button" className={button.primary} disabled={!header.site || !header.subAsset} onClick={onNext}>
            Next
            <ChevronRight aria-hidden="true" className="icon-size-200" />
          </button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- step 2: equipment

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <p className="text-300 font-medium">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-100 grid grid-cols-2 gap-200">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={clsx('rounded-md border px-300 py-200 text-300 font-medium', value === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent')}
          >
            {v ? 'Yes' : 'No'}
          </button>
        ))}
      </div>
    </div>
  );
}

function EquipmentStep(props: {
  header: FormHeader;
  onChange: (h: FormHeader) => void;
  equipmentId: number;
  onPick: (id: number) => void;
  comment: string;
  onComment: (c: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSaved: (r: FieldFormResult) => void;
}) {
  const { header, onChange, equipmentId, onPick, comment, onComment } = props;
  const heaters = useLoad(`site-heaters|${header.site}|${header.subAsset}`, () => fetchSiteHeaters(header.site, header.subAsset));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formOnly = !header.onSite || !header.existing;

  const saveFormOnly = async () => {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(await submitFieldForm({ equipmentId: header.onSite ? 0 : equipmentId, header, entries: [], photoIds: [], comment }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Equipment" hint={`${header.site} · ${header.subAsset}`}>
      <div className="space-y-400">
        <YesNo label="Is the equipment on site?" value={header.onSite} onChange={(v) => onChange({ ...header, onSite: v })} />
        {header.onSite ? <YesNo label="Is it existing equipment (in the list)?" value={header.existing} onChange={(v) => onChange({ ...header, existing: v })} /> : null}

        {header.onSite && header.existing ? (
          <div>
            <p className="text-300 font-medium">Pick the heater</p>
            {heaters.status === 'loading' ? <LoadingState rows={3} label="Loading the heaters" /> : null}
            {heaters.status === 'error' ? <ErrorState message={heaters.message} onRetry={heaters.retry} /> : null}
            {heaters.status === 'ready' && heaters.data.length === 0 ? <EmptyState title="No heaters at this site" hint="Pick another sub-asset, or answer No above." /> : null}
            {heaters.status === 'ready' ? (
              <ul role="radiogroup" aria-label="Heaters at this site" className="mt-100 space-y-200">
                {heaters.data.map((h) => (
                  <li key={h.equipmentId}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={equipmentId === h.equipmentId}
                      onClick={() => onPick(h.equipmentId)}
                      className={clsx('w-full rounded-md border p-300 text-left', equipmentId === h.equipmentId ? 'border-ring ring-2 ring-ring' : 'border-border bg-card hover:bg-accent')}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-200">
                        <span className="font-mono text-300 font-semibold">{h.equipmentNumber}</span>
                        <Pill tone={h.verificationPct >= 100 ? 'success' : 'neutral'}>{formatPercent(h.verificationPct)} verified</Pill>
                      </span>
                      <span className="block text-200 text-muted-foreground">
                        Tag {h.tag ?? '—'} · FLOC {h.functionalLocation ?? '—'} · {h.manufacturer ?? '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {header.onSite && !header.existing ? (
          <div className="space-y-200 rounded-md border border-dashed border-border p-300">
            <Pill tone="warning">Proposed, only if you confirm it (Q-452)</Pill>
            <p className="text-300">Adding a new heater from the field is not confirmed yet. For now, describe what you found and save the form; the data team follows up.</p>
          </div>
        ) : null}
        {!header.onSite ? <p className="text-300 text-muted-foreground">The form is saved as "equipment not on site". No field is marked and no request is created.</p> : null}

        {formOnly ? (
          <label className="block text-200">
            <span className="text-muted-foreground">What did you find? (required)</span>
            <textarea className={input} rows={3} value={comment} onChange={(e) => onComment(e.target.value)} />
          </label>
        ) : null}
        {error ? <p role="alert" className="text-300 text-destructive">{error}</p> : null}

        <div className="flex justify-between gap-200">
          <button type="button" className={button.secondary} onClick={props.onBack}>
            <ChevronLeft aria-hidden="true" className="icon-size-200" />
            Back
          </button>
          {formOnly ? (
            <button type="button" className={button.primary} disabled={busy || !comment.trim()} onClick={() => void saveFormOnly()}>
              <Send aria-hidden="true" className="icon-size-200" />
              Save form
            </button>
          ) : (
            <button type="button" className={button.primary} disabled={equipmentId === 0} onClick={props.onNext}>
              Next
              <ChevronRight aria-hidden="true" className="icon-size-200" />
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- steps 3 and 4: the heater's form

function HeaterForm(props: {
  step: 3 | 4;
  header: FormHeader;
  equipmentId: number;
  entries: Record<string, BlockEntry>;
  onEntries: (e: Record<string, BlockEntry>) => void;
  photos: PhotoRow[];
  onPhotos: (p: PhotoRow[]) => void;
  onStep: (s: Step) => void;
  onDone: (r: FieldFormResult) => void;
}) {
  const load = useLoad(`field-form|${props.equipmentId}`, () => fetchFieldForm(props.equipmentId));
  if (load.status === 'loading') return <LoadingState rows={6} label="Loading the heater's form" />;
  if (load.status === 'error') return <ErrorState message={load.message} onRetry={load.retry} />;
  return props.step === 3 ? <VerifyStep {...props} form={load.data} /> : <ReviewStep {...props} form={load.data} />;
}

function HeaterCard({ form }: { form: FieldForm }) {
  return (
    <div className="rounded-md border border-border bg-muted p-300">
      <p className="font-mono text-400 font-semibold">{form.equipmentNumber}</p>
      <p className="text-200 text-muted-foreground">
        Tag {form.tag ?? '—'} · FLOC {form.functionalLocation ?? '—'} · {form.profitCenter ?? '—'}
      </p>
      <div className="mt-200 flex items-center gap-200">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-card" aria-hidden="true">
          <div className="h-full bg-success" style={{ width: `${Math.min(100, form.pct)}%` }} />
        </div>
        <span className="text-200">
          {form.verifiedKeyFields} of {form.keyFieldCount} key fields verified ({formatPercent(form.pct)})
        </span>
      </div>
    </div>
  );
}

type FormProps = Parameters<typeof HeaterForm>[0] & { form: FieldForm };

function VerifyStep({ form, entries, onEntries, photos, onPhotos, onStep }: FormProps) {
  const entryOf = (code: string) => entries[code] ?? EMPTY_ENTRY;
  const setEntry = (code: string, e: BlockEntry) => onEntries({ ...entries, [code]: e });
  const marked = Object.values(entries).filter((e) => e.mark).length;
  const missing = form.fields.filter((f) => f.mandatory && !entries[f.fieldCode]?.mark);
  const blockedWhy = marked === 0 ? 'Mark at least one field first' : missing.length > 0 ? `Mark the required fields first: ${missing.map((f) => f.label).join(', ')}` : undefined;

  const applyReading = (r: NameplateReading) => {
    const next = { ...entries };
    const pairs: [string, string | null][] = [
      ['MANUFACTURER', r.manufacturer],
      ['MODEL_NUMBER', r.modelNumber],
      ['SERIAL_NUMBER', r.serialNumber],
    ];
    for (const [code, value] of pairs) {
      const f = form.fields.find((x) => x.fieldCode === code);
      if (!f || !value) continue;
      next[code] =
        value === f.currentValue
          ? { ...EMPTY_ENTRY, mark: 'VERIFIED_CORRECT' }
          : { ...EMPTY_ENTRY, mark: 'CORRECTION_REQUIRED', newValue: value, dne: f.allowDne && !f.options.includes(value), comment: 'Read from the nameplate photo (AI suggestion, checked by me).' };
    }
    onEntries(next);
  };

  return (
    <div className="space-y-400">
      <HeaterCard form={form} />
      <NameplatePanel equipmentId={form.equipmentId} photos={photos} onPhotos={onPhotos} onApply={applyReading} />
      {(['EQUIPMENT', 'ATTRIBUTES'] as const).map((section) => (
        <Panel key={section} title={section === 'EQUIPMENT' ? 'Equipment' : 'Heater attributes'} hint={section === 'EQUIPMENT' ? 'In the order of the TrueContext form.' : 'Fields marked "Recorded only" are kept with the form and raise no request.'}>
          <div className="space-y-300">
            {form.fields
              .filter((f) => f.section === section)
              .map((f) => (
                <FieldBlock key={f.fieldCode} field={f} entry={entryOf(f.fieldCode)} onChange={(e) => setEntry(f.fieldCode, e)} />
              ))}
          </div>
        </Panel>
      ))}
      <PhotosPanel equipmentId={form.equipmentId} photos={photos} onPhotos={onPhotos} />
      {missing.length > 0 ? <p className="text-200 text-muted-foreground">Required before Review: {missing.map((f) => f.label).join(', ')}.</p> : null}
      <div className="flex justify-between gap-200">
        <button type="button" className={button.secondary} onClick={() => onStep(2)}>
          <ChevronLeft aria-hidden="true" className="icon-size-200" />
          Back
        </button>
        <button type="button" className={button.primary} disabled={blockedWhy !== undefined} onClick={() => onStep(4)} title={blockedWhy}>
          Review ({marked} marked)
          <ChevronRight aria-hidden="true" className="icon-size-200" />
        </button>
      </div>
    </div>
  );
}

function NameplatePanel({ equipmentId, photos, onPhotos, onApply }: { equipmentId: number; photos: PhotoRow[]; onPhotos: (p: PhotoRow[]) => void; onApply: (r: NameplateReading) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<NameplateReading | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      let plate = photos.find((p) => p.photoType === 'NAMEPLATE');
      if (!plate) {
        const sample = (await sampleImages()).find((s) => s.photoType === 'NAMEPLATE');
        if (!sample) throw new Error('Add a nameplate photo first.');
        plate = await registerPhoto({ equipmentId, fileName: sample.fileName, contentType: 'image/svg+xml', photoType: 'NAMEPLATE', dataUrl: sample.url });
        onPhotos([...photos, plate]);
      }
      setReading(await readNameplate(equipmentId, plate.fileId));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Read the nameplate with AI"
      hint="Suggests manufacturer, model and serial from a nameplate photo. You still check every value."
      actions={
        <button type="button" className={button.secondary} disabled={busy} onClick={() => void read()}>
          <Sparkles aria-hidden="true" className="icon-size-200" />
          {busy ? 'Reading…' : 'Read nameplate'}
        </button>
      }
    >
      {error ? <p role="alert" className="text-300 text-destructive">{error}</p> : null}
      {reading ? (
        <div className="space-y-300">
          {reading.notice ? <p className="rounded-md bg-warning px-300 py-200 text-200 text-warning-foreground">{reading.notice}</p> : null}
          <dl className="grid grid-cols-1 gap-200 text-300 sm:grid-cols-3">
            {[
              ['Manufacturer', reading.manufacturer],
              ['Model', reading.modelNumber],
              ['Serial', reading.serialNumber],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-200 text-muted-foreground">{k}</dt>
                <dd className="font-mono">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="text-200 text-muted-foreground">Confidence {reading.confidence}%. Matching heaters:</p>
          <ul className="space-y-100 text-200">
            {reading.candidates.map((c) => (
              <li key={c.equipmentId} className="flex flex-wrap justify-between gap-200 rounded-md border border-border px-300 py-100">
                <span className="font-mono">{c.equipmentNumber}</span>
                <span className="text-muted-foreground">{c.reason}</span>
                <Pill tone={c.score >= 80 ? 'success' : 'neutral'}>{c.score}</Pill>
              </li>
            ))}
          </ul>
          <button type="button" className={button.primary} onClick={() => onApply(reading)}>
            Use these values
          </button>
        </div>
      ) : (
        <p className="text-200 text-muted-foreground">No reading yet. Without a nameplate photo, the demo uses a sample nameplate image.</p>
      )}
    </Panel>
  );
}

function PhotosPanel({ equipmentId, photos, onPhotos }: { equipmentId: number; photos: PhotoRow[]; onPhotos: (p: PhotoRow[]) => void }) {
  const [photoType, setPhotoType] = useState<PhotoType>('NAMEPLATE');
  const [error, setError] = useState<string | null>(null);
  const samples = useLoad('sample-images', sampleImages);

  const add = async (fileName: string, contentType: string, dataUrl: string, type: PhotoType) => {
    setError(null);
    try {
      onPhotos([...photos, await registerPhoto({ equipmentId, fileName, contentType, photoType: type, dataUrl })]);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Panel title="Photos" hint="Vessel nameplate, burner nameplates, facility signage and wide images of the equipment. A photo is needed for an illegible or missing value.">
      <div className="space-y-300">
        <div className="flex flex-wrap items-end gap-200">
          <label className="text-200">
            <span className="text-muted-foreground">Photo of</span>
            <select className={`${input} w-auto`} value={photoType} onChange={(e) => setPhotoType(e.target.value as PhotoType)}>
              {PHOTO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className={clsx(button.secondary, 'cursor-pointer')}>
            <Camera aria-hidden="true" className="icon-size-200" />
            Add photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void readFile(file).then((url) => add(file.name, file.type, url, photoType), (err: unknown) => setError(errorText(err)));
              }}
            />
          </label>
        </div>
        {samples.status === 'ready' && samples.data.length > 0 ? (
          <div className="flex flex-wrap gap-200">
            {samples.data.map((s) => (
              <button key={s.id} type="button" className={button.small} onClick={() => void add(s.fileName, 'image/svg+xml', s.url, s.photoType)}>
                Add {s.label}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p role="alert" className="text-300 text-destructive">{error}</p> : null}
        {photos.length === 0 ? (
          <p className="text-200 text-muted-foreground">No photo yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-200 sm:grid-cols-3">
            {photos.map((p) => (
              <li key={p.fileId} className="overflow-hidden rounded-md border border-border">
                <img src={p.url} alt={`${p.photoType.toLowerCase()} photo`} className="aspect-video w-full object-cover" />
                <p className="px-200 py-100 text-200">{PHOTO_TYPES.find((t) => t.value === p.photoType)?.label}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function ReviewGroup({ title, lines }: { title: string; lines: { key: string; text: string }[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="text-300 font-semibold">
        {title} ({lines.length})
      </p>
      <ul className="mt-100 space-y-100 text-300">
        {lines.map((l) => (
          <li key={l.key} className="rounded-md border border-border px-300 py-100">
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReviewStep({ form, header, entries, photos, onStep, onDone }: FormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = form.fields.filter((f) => entries[f.fieldCode]?.mark).map((f) => ({ f, e: entries[f.fieldCode] }));
  const request = rows.filter(({ f, e }) => e.mark === 'CORRECTION_REQUIRED' && !e.unreadableReason && f.source === 'CATALOG' && !f.adminOnly);
  const recorded = rows.filter(({ f, e }) => e.mark === 'CORRECTION_REQUIRED' && !e.unreadableReason && (f.source === 'EXTRA' || f.adminOnly));
  const verified = rows.filter(({ e }) => e.mark === 'VERIFIED_CORRECT');
  const unreadable = rows.filter(({ e }) => e.mark === 'CORRECTION_REQUIRED' && e.unreadableReason);
  const notVerified = rows.filter(({ e }) => e.mark === 'DID_NOT_VERIFY');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(
        await submitFieldForm({
          equipmentId: form.equipmentId,
          header,
          entries: rows.map(({ f, e }) => ({ fieldCode: f.fieldCode, mark: e.mark ?? 'DID_NOT_VERIFY', newValue: e.newValue, comment: e.comment, unreadableReason: e.unreadableReason, dne: e.dne })),
          photoIds: photos.map((p) => p.fileId),
          comment: '',
        })
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-400">
      <HeaterCard form={form} />
      <Panel title="Review and submit" hint={`${verified.length} verified, ${request.length} correction${request.length === 1 ? '' : 's'} → ${request.length} request${request.length === 1 ? '' : 's'}, ${recorded.length} recorded only, ${photos.length} photo${photos.length === 1 ? '' : 's'}.`}>
        <div className="space-y-300">
          <ReviewGroup title="Corrections that become approval requests" lines={request.map(({ f, e }) => ({ key: f.fieldCode, text: `${f.label}: ${f.currentValue ?? '—'} → ${e.newValue}${e.dne ? ' (not in the list)' : ''}` }))} />
          <ReviewGroup title="Corrections recorded with the form (no request)" lines={recorded.map(({ f, e }) => ({ key: f.fieldCode, text: `${f.label}: ${f.currentValue ?? '—'} → ${e.newValue}` }))} />
          <ReviewGroup title="Illegible or not found" lines={unreadable.map(({ f, e }) => ({ key: f.fieldCode, text: `${f.label}: ${e.unreadableReason}` }))} />
          <ReviewGroup title={MARK_LABEL.VERIFIED_CORRECT} lines={verified.map(({ f }) => ({ key: f.fieldCode, text: `${f.label}: ${f.currentValue ?? '—'}` }))} />
          <ReviewGroup title={MARK_LABEL.DID_NOT_VERIFY} lines={notVerified.map(({ f }) => ({ key: f.fieldCode, text: f.label }))} />
          <p className="text-200 text-muted-foreground">{form.fields.length - rows.length} field(s) left unmarked are not sent.</p>
          {error ? <p role="alert" className="text-300 text-destructive">{error}</p> : null}
        </div>
      </Panel>
      <div className="flex justify-between gap-200">
        <button type="button" className={button.secondary} onClick={() => onStep(3)}>
          <ChevronLeft aria-hidden="true" className="icon-size-200" />
          Back to the form
        </button>
        <button type="button" className={button.primary} disabled={busy} onClick={() => void submit()}>
          <Send aria-hidden="true" className="icon-size-200" />
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- done

function Done({ result, equipmentId, onAnother, onNewSite }: { result: FieldFormResult; equipmentId: number; onAnother: () => void; onNewSite: () => void }) {
  const created = result.requests.filter((r) => r.requestId !== null);
  return (
    <Panel title="Form submitted" hint={`Reference ${result.referenceNumber}`}>
      <div className="space-y-300 text-300">
        <p>
          {result.marksWritten} field(s) marked.{equipmentId ? ` Verification is now ${formatPercent(result.verificationPct)}.` : ''}
        </p>
        {created.length > 0 ? (
          <div>
            <p className="font-semibold">Approval requests</p>
            <ul className="mt-100 space-y-100">
              {created.map((r) => (
                <li key={r.fieldCode}>
                  <a className="text-link underline" href={hrefFor(`/requests/${r.requestId}`)}>
                    {r.requestRef}
                  </a>{' '}
                  · {r.fieldCode} · {r.outcome === 'CREATED' ? 'created' : r.outcome === 'DUPLICATE_SUPPRESSED' ? 'already open with the same value' : 'another open request on this field'}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {result.recordedOnly.length > 0 ? (
          <div>
            <p className="font-semibold">Recorded with the form</p>
            <ul className="mt-100 space-y-100">
              {result.recordedOnly.map((r) => (
                <li key={r.fieldCode}>
                  {r.label}: {r.newValue} <span className="text-muted-foreground">({r.why})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-200">
          <button type="button" className={button.primary} onClick={onAnother}>
            Verify another heater here
          </button>
          <button type="button" className={button.secondary} onClick={onNewSite}>
            New location
          </button>
          {equipmentId ? (
            <a className={button.secondary} href={hrefFor(`/equipment/${equipmentId}`)}>
              Open the heater
            </a>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
