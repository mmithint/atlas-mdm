import { AlertTriangle, ArrowRight, CircleCheck, PencilLine, SkipForward } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { FormField } from '@/components/layout';
import { button, card, input } from '@/components/ui';

import { FIELDS, type SampleHeater } from './config';
import { fullPath, isReadOnly, nodeById, outcomeOf, type Draft, type Problem } from './model';

type Update = (change: (d: Draft) => Draft) => void;

/** Step 4: what will be sent, what still blocks it, and the submit. */
export function ReviewSummary({
  draft,
  update,
  heater,
  isAdmin,
  problems,
  submitting,
  error,
  onJump,
}: {
  draft: Draft;
  update: Update;
  heater: SampleHeater | undefined;
  isAdmin: boolean;
  problems: readonly Problem[];
  submitting: boolean;
  error: string | null;
  onJump: (target: string) => void;
}) {
  const id = useId();
  const outcome = outcomeOf(draft);
  const site = nodeById(draft.path.SITE);
  const fields = FIELDS.filter((f) => !isReadOnly(f, isAdmin));
  const by = (s: string) => fields.filter((f) => draft.answers[f.key]?.status === s);
  const corrections = by('CORRECTION');
  const skipped = by('SKIP');

  return (
    <div className="space-y-400">
      <div className="grid gap-300 sm:grid-cols-2">
        <section className={`${card} p-400`} aria-label="Location">
          <h2 className="text-200 font-medium text-muted-foreground">Location</h2>
          <p className="mt-100 text-300 font-medium">{site ? fullPath(site.id) : '—'}</p>
          {site?.floc ? <span className="id-plate mt-100 inline-block">{site.floc}</span> : null}
          {draft.missingLocation ? <p className="mt-200 text-200 text-muted-foreground">Missing location reported: {draft.missingLocation}</p> : null}
        </section>
        <section className={`${card} p-400`} aria-label="Equipment">
          <h2 className="text-200 font-medium text-muted-foreground">Equipment</h2>
          {outcome === 'VERIFY' && heater ? (
            <p className="mt-100 flex flex-wrap items-center gap-200 text-300 font-medium">
              <span className="id-plate">{heater.equipmentNo}</span>
              {heater.tag}
            </p>
          ) : outcome === 'MISSING' ? (
            <p className="mt-100 text-300 font-medium">Missing equipment request{draft.missingNote ? `: ${draft.missingNote}` : ''}</p>
          ) : (
            <p className="mt-100 text-300 font-medium">
              New equipment request: {draft.newEquipment.equipClass} {draft.newEquipment.tag}
            </p>
          )}
        </section>
      </div>

      {outcome === 'VERIFY' ? (
        <>
          <div className="grid grid-cols-3 gap-300">
            <Count icon={<CircleCheck className="icon-size-300" />} label="Correct" n={by('CORRECT').length} tone="bg-success text-success-foreground" />
            <Count icon={<PencilLine className="icon-size-300" />} label="Corrections" n={corrections.length} tone="bg-info text-info-foreground" />
            <Count icon={<SkipForward className="icon-size-300" />} label="Skipped" n={skipped.length} tone="bg-muted text-muted-foreground" />
          </div>

          {problems.length > 0 ? (
            <section role="alert" className="rounded-lg border border-danger-border bg-danger-bg p-400">
              <h2 className="flex items-center gap-200 text-300 font-semibold text-danger-text">
                <AlertTriangle aria-hidden="true" className="icon-size-300" />
                Fix {problems.length} {problems.length === 1 ? 'item' : 'items'} before you submit
              </h2>
              <ul className="mt-200 space-y-100 text-300">
                {problems.map((p) => (
                  <li key={p.target + p.message}>
                    <button type="button" className="text-left text-link underline underline-offset-2 hover:text-link-hover" onClick={() => onJump(p.target)}>
                      {p.message}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={`${card} p-400`} aria-labelledby={`${id}-changes`}>
            <h2 id={`${id}-changes`} className="text-400 font-semibold">
              Changes for approval
            </h2>
            {corrections.length === 0 ? (
              <p className="mt-200 text-300 text-muted-foreground">No corrections: every checked field matches SAP.</p>
            ) : (
              <ul className="mt-200 divide-y divide-divider">
                {corrections.map((f) => (
                  <li key={f.key} className="flex flex-wrap items-center gap-x-300 gap-y-100 py-200 text-300">
                    <span className="min-w-40 font-medium">{f.label}</span>
                    <span className="text-muted-foreground line-through">{heater?.sap[f.key] ?? 'Blank'}</span>
                    <ArrowRight aria-label="changes to" className="icon-size-200 text-muted-foreground" />
                    <span className="font-semibold">
                      {draft.answers[f.key]?.value}
                      {f.unit ? ` ${f.unit}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {skipped.length > 0 ? (
              <p className="mt-300 text-200 text-muted-foreground">
                Skipped: {skipped.map((f) => f.label).join(', ')}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <div className={`${card} p-400`}>
        <FormField label="Comment (optional)" htmlFor={`${id}-comment`} hint="Anything the approver should know.">
          <textarea id={`${id}-comment`} rows={3} className={input} value={draft.comment} onChange={(e) => update((d) => ({ ...d, comment: e.target.value }))} />
        </FormField>
      </div>

      <p aria-live="assertive" className="text-300 text-destructive">
        {error ?? ''}
      </p>
      {submitting ? <p className="sr-only" aria-live="polite">Submitting for approval</p> : null}
    </div>
  );
}

function Count({ icon, label, n, tone }: { icon: ReactNode; label: string; n: number; tone: string }) {
  return (
    <div className={`${card} flex items-center gap-300 px-400 py-300`}>
      <span aria-hidden="true" className={`flex icon-size-600 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        {icon}
      </span>
      <span>
        <span className="block text-600 font-semibold leading-600 tabular-nums">{n}</span>
        <span className="block text-200 text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

/** After submit: the request number and what to do next. */
export function SubmittedState({ requestRef, onAnother }: { requestRef: string; onAnother: () => void }) {
  return (
    <section className={`${card} mx-auto max-w-xl space-y-300 p-600 text-center`} aria-live="polite">
      <CircleCheck aria-hidden="true" className="mx-auto icon-size-700 text-success-foreground" />
      <h2 className="text-500 font-semibold">Submitted for approval</h2>
      <p className="text-300 text-muted-foreground">
        Request <span className="id-plate">{requestRef}</span> is with the approvers. You will see it under My requests.
      </p>
      <div className="flex flex-wrap justify-center gap-200 pt-200">
        <a href={hrefFor('/approvals', { tab: 'MY_REQUESTS' })} className={button.secondary}>
          View request
        </a>
        <button type="button" className={button.primary} onClick={onAnother}>
          Verify another heater
        </button>
      </div>
    </section>
  );
}
