import clsx from 'clsx';
import { Camera, Check, ChevronDown, LayoutGrid, List, Lock, PencilLine, ScanText, ShieldCheck, SkipForward, Star, X } from 'lucide-react';
import { useId, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';

import { Pill } from '@/components/layout';
import { button, card, input, inputCompact } from '@/components/ui';

import { FIELDS, GROUPS, type FieldDef, type SampleHeater } from './config';
import { isReadOnly, keyProgress, requiredPhotos, valueProblem, type Answer, type Draft, type Photo, type Status } from './model';
import { ChoiceChips } from './choice-controls.component';

const STATUS_OPTIONS = [
  { value: 'CORRECT', label: 'Correct', icon: <Check aria-hidden="true" className="icon-size-200" />, chosen: 'border-success-border bg-success text-success-foreground' },
  { value: 'CORRECTION', label: 'Correction', icon: <PencilLine aria-hidden="true" className="icon-size-200" />, chosen: 'border-info-border bg-info text-info-foreground' },
  { value: 'SKIP', label: 'Skip', icon: <SkipForward aria-hidden="true" className="icon-size-200" />, chosen: 'border-border bg-muted text-muted-foreground' },
] as const;
const SHORTCUT: Record<string, Status> = { '1': 'CORRECT', '2': 'CORRECTION', '3': 'SKIP' };

/** Table on a wide screen, stacked rows on a narrow one (each cell then shows its column name). Rows get 12px
 * above and below, so the chips of one row sit well apart from the next and are easy to hit. */
const T = {
  table: 'block w-full border-collapse text-300 md:table',
  thead: 'hidden md:table-header-group',
  tbody: 'block md:table-row-group',
  tr: 'block border-t border-divider px-300 py-300 md:table-row md:p-0',
  td: 'block py-100 align-top before:block before:text-200 before:text-muted-foreground before:content-[attr(data-label)] md:table-cell md:px-300 md:py-300 md:align-middle md:before:content-none',
};

type Update = (change: (d: Draft) => Draft) => void;

type View = 'list' | 'cards';
/** The same switch as on the Equipment detail page: Cards then List, icon and word. */
const VIEWS: readonly { view: View; text: string; label: string; icon: ReactNode }[] = [
  { view: 'cards', text: 'Cards', label: 'Card view', icon: <LayoutGrid aria-hidden="true" className="icon-size-100" /> },
  { view: 'list', text: 'List', label: 'List view', icon: <List aria-hidden="true" className="icon-size-100" /> },
];

export function VerifyTable({
  draft,
  update,
  heater,
  isAdmin,
  photos,
  setPhotos,
}: {
  draft: Draft;
  update: Update;
  heater: SampleHeater;
  isAdmin: boolean;
  photos: Photo[];
  setPhotos: (change: (p: Photo[]) => Photo[]) => void;
}) {
  const progress = keyProgress(draft, isAdmin);
  const [view, setView] = useState<View>('list');
  const setAnswer = (key: string, change: Partial<Answer>) =>
    update((d) => ({ ...d, answers: { ...d.answers, [key]: { status: null, value: '', ...d.answers[key], ...change } } }));
  const markAllCorrect = () =>
    update((d) => {
      const answers = { ...d.answers };
      for (const f of FIELDS) if (!isReadOnly(f, isAdmin) && !answers[f.key]?.status) answers[f.key] = { status: 'CORRECT', value: '' };
      return { ...d, answers };
    });

  return (
    <div className="grid gap-400 xl:grid-cols-4 xl:items-start">
      <div className="space-y-400 xl:col-span-3">
        <div className={`${card} flex flex-wrap items-center gap-400 px-500 py-300`}>
          <div className="min-w-0 flex-1 basis-60">
            <p className="text-300 font-medium tabular-nums">
              {progress.done} of {progress.total} key fields verified
            </p>
            <div className="mt-100 h-200 rounded-full bg-muted" role="progressbar" aria-label="Key fields verified" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span className="block h-full rounded-full bg-success-foreground transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
          <button type="button" className={button.secondary} onClick={markAllCorrect}>
            <Check aria-hidden="true" className="icon-size-200" />
            Mark all correct
          </button>
        </div>

        {/* Above the first group: the view switch on the left, keyboard guidance on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-300">
          {/* A view switch (not a form answer): toggle buttons, styled like the Equipment detail page's. */}
          <div role="group" aria-label="Show fields as" className="inline-flex rounded-lg border border-border bg-muted p-100">
            {VIEWS.map((v) => (
              <button
                key={v.view}
                type="button"
                aria-pressed={view === v.view}
                aria-label={v.label}
                onClick={() => setView(v.view)}
                className={clsx(
                  'inline-flex h-700 items-center gap-100 rounded-md px-200 text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  view === v.view ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                )}
              >
                {v.icon}
                {v.text}
              </button>
            ))}
          </div>
          <p className="text-200 text-muted-foreground">
            Tab moves between rows. On a row, press <kbd className="id-plate">1</kbd> Correct, <kbd className="id-plate">2</kbd> Correction, <kbd className="id-plate">3</kbd> Skip.
          </p>
        </div>

        {GROUPS.filter((g) => g.group !== 'SAP').map((g) => (
          <Group key={g.group} title={g.label} view={view} fields={FIELDS.filter((f) => f.group === g.group)} draft={draft} heater={heater} isAdmin={isAdmin} setAnswer={setAnswer} />
        ))}
      </div>

      <aside className="space-y-400 xl:sticky xl:top-0" aria-label="Verification tools">
        <Photos equipClass={heater.sap['equipClass']} photos={photos} setPhotos={setPhotos} />
        <NameplateHelper heater={heater} onUse={(value) => setAnswer('manufacturer', value === heater.sap['manufacturer'] ? { status: 'CORRECT' } : { status: 'CORRECTION', value })} />
        <SapInformation heater={heater} />
      </aside>
    </div>
  );
}

function Group({
  title,
  view,
  fields,
  draft,
  heater,
  isAdmin,
  setAnswer,
}: {
  title: string;
  view: View;
  fields: readonly FieldDef[];
  draft: Draft;
  heater: SampleHeater;
  isAdmin: boolean;
  setAnswer: (key: string, change: Partial<Answer>) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(true);
  const locked = fields.every((f) => f.locked);
  const hasAdminOnly = fields.some((f) => f.adminOnly);
  const hasKeyFields = fields.some((f) => f.keyField);
  return (
    <section className={`${card} overflow-hidden`} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-200 px-500 py-300 text-left text-400 font-semibold hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {title}
          <span className="text-200 font-normal text-muted-foreground">{fields.length} fields</span>
          {locked ? <span className="inline-flex items-center gap-100 text-200 font-normal text-muted-foreground"><Lock aria-hidden="true" className="icon-size-100" />From SAP, not editable</span> : null}
          <span className="ml-auto flex items-center gap-100">
            {hasAdminOnly ? <Pill tone="neutral"><ShieldCheck aria-hidden="true" className="icon-size-100" />Admin change only</Pill> : null}
            {hasKeyFields ? <Pill tone="info"><Star aria-hidden="true" className="icon-size-100" />Key fields</Pill> : null}
          </span>
          {/* The chevron sits in the right corner: down when folded, up when open, like the nameplate card. */}
          <ChevronDown aria-hidden="true" className={clsx('icon-size-300 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} />
        </button>
      </h3>
      {open && view === 'cards' ? (
        <ul id={`${id}-body`} className="grid gap-400 border-t border-border p-400 md:grid-cols-2">
          {fields.map((f) => (
            <FieldCard key={f.key} field={f} sap={heater.sap[f.key] ?? null} answer={draft.answers[f.key]} readOnly={isReadOnly(f, isAdmin)} setAnswer={(c) => setAnswer(f.key, c)} />
          ))}
        </ul>
      ) : null}
      {open && view === 'list' ? (
        <table id={`${id}-body`} className={T.table}>
          <thead className={T.thead}>
            <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
              <th className="w-1/4 px-300 py-200 font-semibold">Field</th>
              <th className="w-1/5 px-300 py-200 font-semibold">SAP value</th>
              {locked ? null : <th className="px-300 py-200 font-semibold">Is the SAP value right?</th>}
              {locked ? null : <th className="w-1/4 px-300 py-200 font-semibold">Corrected value</th>}
            </tr>
          </thead>
          <tbody className={T.tbody}>
            {fields.map((f) => (
              <Row key={f.key} field={f} sap={heater.sap[f.key] ?? null} answer={draft.answers[f.key]} readOnly={isReadOnly(f, isAdmin)} setAnswer={(c) => setAnswer(f.key, c)} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

interface FieldProps {
  field: FieldDef;
  sap: string | null;
  answer: Answer | undefined;
  readOnly: boolean;
  setAnswer: (c: Partial<Answer>) => void;
}

/** What a field's row and card share: its status, the error shown after blur, and the 1 / 2 / 3 shortcuts. */
function useFieldControls({ field, answer, readOnly, setAnswer }: FieldProps) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const status = answer?.status ?? null;
  const problem = status === 'CORRECTION' && touched ? valueProblem(field, answer?.value ?? '') : null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (readOnly || event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    const next = SHORTCUT[event.key.toLowerCase()];
    if (next) {
      event.preventDefault();
      setAnswer({ status: next });
    }
  };
  return { id, status, problem, onKeyDown, touch: () => setTouched(true) };
}

/** A compact verification card with the SAP value and field metadata clearly separated. */
function FieldCard(props: FieldProps) {
  const { field, sap, answer, readOnly, setAnswer } = props;
  const { id, status, problem, onKeyDown, touch } = useFieldControls(props);
  return (
    <li id={`row-${field.key}`} onKeyDown={onKeyDown} className="relative flex flex-col gap-200 rounded-lg border border-border bg-muted/40 p-300">
      {field.adminOnly || field.keyField ? (
        <div className="absolute right-300 top-300 flex flex-col items-center gap-100">
          {field.adminOnly ? <ShieldCheck aria-label="Admin change only" className="icon-size-200 text-muted-foreground" /> : null}
          {field.keyField ? <Star aria-label="Key field" className="icon-size-200 text-info-foreground" /> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-300 pr-700">
        <div>
          <p className="text-200 text-muted-foreground">Field</p>
          <p className="flex flex-wrap items-center gap-100 text-300 font-medium">
            {field.label}
            {field.unit ? <span className="font-normal text-muted-foreground">({field.unit})</span> : null}
          </p>
        </div>
        <div>
          <p className="text-200 text-muted-foreground">SAP value</p>
          <p className="text-300 font-medium">{sap ?? <span className="font-normal text-muted-foreground">Blank in SAP</span>}</p>
        </div>
      </div>
      <div className="mt-auto border-t border-divider pt-200">
        {field.locked ? (
          <p className="inline-flex items-center gap-100 text-200 text-muted-foreground">
            <Lock aria-hidden="true" className="icon-size-100" />
            From SAP, not editable
          </p>
        ) : readOnly ? (
          <p className="inline-flex items-center gap-100 text-200 text-muted-foreground">
            <Lock aria-hidden="true" className="icon-size-100" />
            Only an admin can change this
          </p>
        ) : (
          <ChoiceChips label={`Is the SAP value of ${field.label} right?`} options={STATUS_OPTIONS} value={status} onChange={(s: Status) => setAnswer({ status: s })} />
        )}
      </div>
      {status === 'CORRECTION' && !readOnly ? (
        <div>
          <CorrectionInput id={id} field={field} value={answer?.value ?? ''} onChange={(value) => setAnswer({ value })} onBlur={touch} invalid={problem !== null} />
          <p id={`${id}-err`} aria-live="polite" className="mt-100 text-200 text-destructive">
            {problem ?? ''}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function Row(props: FieldProps) {
  const { field, sap, answer, readOnly, setAnswer } = props;
  const { id, status, problem, onKeyDown, touch } = useFieldControls(props);

  return (
    <tr id={`row-${field.key}`} className={T.tr} onKeyDown={onKeyDown}>
      <th scope="row" data-label="Field" className={clsx(T.td, 'text-left font-medium')}>
        <span className="flex flex-wrap items-center gap-100">
          {field.label}
          {field.unit ? <span className="font-normal text-muted-foreground">({field.unit})</span> : null}
          {field.adminOnly ? <Pill tone="info">Admin change only</Pill> : null}
          {field.keyField ? <span className="sr-only">, key field</span> : null}
        </span>
      </th>
      <td data-label="SAP value" className={T.td}>
        {sap ?? <span className="text-muted-foreground">Blank in SAP</span>}
      </td>
      {field.locked ? null : (
        <td data-label="Is the SAP value right?" className={T.td}>
          {readOnly ? (
            <span className="inline-flex min-h-11 items-center gap-100 text-200 text-muted-foreground">
              <Lock aria-hidden="true" className="icon-size-100" />
              Only an admin can change this
            </span>
          ) : (
            <ChoiceChips label={`Is the SAP value of ${field.label} right?`} options={STATUS_OPTIONS} value={status} onChange={(s: Status) => setAnswer({ status: s })} />
          )}
        </td>
      )}
      {field.locked ? null : (
        <td data-label={status === 'CORRECTION' ? 'Corrected value' : ''} className={clsx(T.td, status !== 'CORRECTION' && 'max-md:hidden')}>
          {status === 'CORRECTION' ? (
            <div>
              <CorrectionInput id={id} field={field} value={answer?.value ?? ''} onChange={(value) => setAnswer({ value })} onBlur={touch} invalid={problem !== null} />
              <p id={`${id}-err`} aria-live="polite" className="mt-100 text-200 text-destructive">
                {problem ?? ''}
              </p>
            </div>
          ) : null}
        </td>
      )}
    </tr>
  );
}

/** The right control for the field: a list, a number with its unit, diameter x length, or text. */
function CorrectionInput({ id, field, value, onChange, onBlur, invalid }: { id: string; field: FieldDef; value: string; onChange: (v: string) => void; onBlur: () => void; invalid: boolean }) {
  const common = { 'aria-invalid': invalid, 'aria-describedby': `${id}-err`, onBlur, className: clsx(inputCompact, 'aria-[invalid=true]:border-destructive') };
  const name = `Corrected ${field.label}`;
  if (field.control === 'list') {
    return (
      <select id={id} aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} {...common}>
        <option value="">Choose a value</option>
        {field.options?.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.control === 'dimensions') {
    const [d = '', l = ''] = value.split('x').map((p) => p.trim());
    const set = (nd: string, nl: string) => onChange(`${nd} x ${nl}`);
    return (
      <div className="flex items-center gap-100">
        <input aria-label={`${name}: diameter, ft`} type="number" min={0} step="any" inputMode="decimal" value={d} onChange={(e) => set(e.target.value, l)} {...common} />
        <span aria-hidden="true">×</span>
        <input aria-label={`${name}: length, ft`} type="number" min={0} step="any" inputMode="decimal" value={l} onChange={(e) => set(d, e.target.value)} {...common} />
        <span className="text-200 text-muted-foreground">ft</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-100">
      <input
        id={id}
        aria-label={name}
        type={field.control === 'number' ? 'number' : 'text'}
        inputMode={field.control === 'number' ? 'decimal' : undefined}
        step={field.control === 'number' ? 'any' : undefined}
        autoComplete="off"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        {...common}
      />
      {field.unit ? <span className="shrink-0 text-200 text-muted-foreground">{field.unit}</span> : null}
    </div>
  );
}

/** "Read nameplate with AI": suggestions the person still confirms. SAMPLE: answers from the sample heater. */
function NameplateHelper({ heater, onUse }: { heater: SampleHeater; onUse: (manufacturer: string) => void }) {
  const [read, setRead] = useState(false);
  return (
    <details className={`${card} group px-500 py-300`}>
      <summary className="flex cursor-pointer list-none items-center gap-200 text-300 font-medium">
        <ScanText aria-hidden="true" className="icon-size-300 text-link" />
        Read nameplate with AI
        <ChevronDown aria-hidden="true" className="ml-auto icon-size-300 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="mt-300 space-y-300 text-300">
        <p className="text-muted-foreground">Reads the nameplate photo and suggests values. Nothing changes until you choose to use a suggestion.</p>
        {read ? (
          <dl className="grid gap-200">
            <div>
              <dt className="text-200 text-muted-foreground">Manufacturer</dt>
              <dd className="flex items-center gap-200 font-medium">
                {heater.nameplate.manufacturer}
                <button type="button" className={button.small} onClick={() => onUse(heater.nameplate.manufacturer)}>
                  Use
                </button>
              </dd>
            </div>
            <div>
              <dt className="text-200 text-muted-foreground">Model</dt>
              <dd className="font-medium">{heater.nameplate.model}</dd>
            </div>
            <div>
              <dt className="text-200 text-muted-foreground">Serial</dt>
              <dd className="font-medium">{heater.nameplate.serial}</dd>
            </div>
          </dl>
        ) : (
          <button type="button" className={`${button.secondary} w-full`} onClick={() => setRead(true)}>
            <ScanText aria-hidden="true" className="icon-size-200" />
            Read nameplate
          </button>
        )}
      </div>
    </details>
  );
}

function Photos({ equipClass, photos, setPhotos }: { equipClass: string | null | undefined; photos: Photo[]; setPhotos: (change: (p: Photo[]) => Photo[]) => void }) {
  const id = useId();
  const required = requiredPhotos(equipClass);
  const add = (label: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setPhotos((p) => [...p, ...files.map((f, i) => ({ id: `${Date.now()}-${i}`, label, name: f.name, url: URL.createObjectURL(f) }))]);
    event.target.value = '';
  };
  return (
    <section id="photos" tabIndex={-1} className={`${card} space-y-300 p-500`} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="text-400 font-semibold">
        Photos
      </h3>
      <div className="space-y-300">
        {required.map((r) => (
          <div key={r} className="space-y-100">
            <p className="text-300 font-medium">
              {r}<span aria-hidden="true" className="text-danger-text">*</span><span className="sr-only"> required</span>
            </p>
            <label className={clsx(button.secondary, 'w-full cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring')}>
              <Camera aria-hidden="true" className="icon-size-200" />
              Upload
              <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={add(r)} />
            </label>
          </div>
        ))}
      </div>
      <h4 className="text-300 font-semibold">Images</h4>
      {photos.length > 0 ? (
        <ul className="grid grid-cols-2 gap-300">
          {photos.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border border-border">
              <img src={p.url} alt={`${p.label}: ${p.name}`} className="aspect-square w-full object-cover" />
              <p className="truncate px-200 py-100 text-200">{p.label}</p>
              <button
                type="button"
                aria-label={`Remove ${p.label} photo ${p.name}`}
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setPhotos((all) => all.filter((x) => x.id !== p.id));
                }}
                className="absolute right-100 top-100 rounded-full bg-card p-100 shadow-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X aria-hidden="true" className="icon-size-200" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-200 text-muted-foreground">No photos yet.</p>
      )}
    </section>
  );
}

function SapInformation({ heater }: { heater: SampleHeater }) {
  const facts = [
    { label: 'Equipment number', value: heater.sap['equipmentNo'] },
    { label: 'Functional location', value: heater.sap['floc'] },
    { label: 'User status description', value: heater.sap['userStatusDesc'] },
  ];

  return (
    <section className={`${card} space-y-300 p-500`} aria-labelledby="sap-information-heading">
      <div>
        <h3 id="sap-information-heading" className="text-400 font-semibold">SAP information</h3>
        <p className="mt-100 inline-flex items-center gap-100 text-200 text-muted-foreground">
          <Lock aria-hidden="true" className="icon-size-100" />
          From SAP, not editable
        </p>
      </div>
      <dl className="space-y-300">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-200 text-muted-foreground">{fact.label}</dt>
            <dd className="mt-100 text-300 font-medium">{fact.value ?? 'Blank in SAP'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
