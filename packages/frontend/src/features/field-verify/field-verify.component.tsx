import { ArrowLeft, ArrowRight, Send } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { useRegisteredProfile } from '@/app/profile.context';
import { button } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import { EquipmentStep, EquipmentSummary } from './equipment-step.component';
import { submitVerification } from './field-verify-api';
import { FieldViewStepper } from './field-view-stepper.component';
import { LocationPicker } from './location-picker.component';
import { blockedReason, heaterOf, nextStep, nodeById, outcomeOf, previousStep, problemsOf, type Step } from './model';
import { ReviewSummary, SubmittedState } from './review-summary.component';
import { savedText, useFieldDraft } from './use-field-draft';
import { VerifyTable } from './verify-table.component';

/**
 * S-6 Field view: a field user confirms or corrects a heater's master data in four steps (location, equipment,
 * verify, review). SAP values are shown locked; corrections go to the approval flow on submit. The draft saves on
 * every change. SAMPLE data until the Field view functions exist (see config.ts and field-verify-api.ts).
 */
export function FieldVerify() {
  const profile = useRegisteredProfile();
  const isAdmin = profile?.canManageAdmin === true;
  const { draft, update, photos, setPhotos, savedAt, reset } = useFieldDraft(profile?.email ?? 'signed-in');
  const reasonId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const heater = heaterOf(draft);
  const site = nodeById(draft.path.SITE);
  const outcome = outcomeOf(draft);
  const problems = problemsOf(draft, isAdmin, photos);
  const reason = draft.step === 4 ? (problems.length > 0 ? 'Fix the items listed above to submit' : null) : blockedReason(draft);

  const go = (step: Step) => {
    update((d) => ({ ...d, step }));
    document.querySelector('main')?.scrollTo({ top: 0 });
  };

  /** From Review back to the row (or the photos) that blocks Submit. */
  const jump = (target: string) => {
    go(3);
    setTimeout(() => {
      const el = document.getElementById(target === 'photos' ? 'photos' : `row-${target}`);
      el?.scrollIntoView({ block: 'center' });
      (el?.querySelector<HTMLElement>('[role="radio"][tabindex="0"], input, select') ?? el)?.focus();
    }, 0);
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      setSubmitted((await submitVerification(draft, photos)).requestRef);
    } catch (e) {
      setError(`The request was not sent: ${errorText(e)} Your answers are kept; try again.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="w-full space-y-400">
        <h1 className="text-600 font-semibold">Field view</h1>
        <SubmittedState
          requestRef={submitted}
          onAnother={() => {
            reset();
            setSubmitted(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-400">
      <header className="space-y-400">
        <div className="flex flex-wrap items-baseline justify-between gap-300">
          <h1 className="text-600 font-semibold">Field view</h1>
          <p className="text-200 text-muted-foreground" aria-live="polite">
            {savedText(savedAt, now)}
          </p>
        </div>
        <FieldViewStepper current={draft.step} skipped={outcome && outcome !== 'VERIFY' ? [3] : []} onGo={go} />
      </header>

      <div className="flex min-w-0 flex-col gap-400">
        {draft.step >= 3 && outcome === 'VERIFY' && heater ? (
          <div className="sticky top-0 z-10 rounded-lg border border-border bg-card p-300 sm:px-400 shadow-sm">
            <EquipmentSummary heater={heater} siteLabel={site?.label ?? ''} />
          </div>
        ) : null}

        {draft.step === 1 ? <LocationPicker draft={draft} update={update} /> : null}
        {draft.step === 2 ? <EquipmentStep draft={draft} update={update} /> : null}
        {draft.step === 3 && heater ? <VerifyTable draft={draft} update={update} heater={heater} isAdmin={isAdmin} photos={photos} setPhotos={setPhotos} /> : null}
        {draft.step === 4 ? <ReviewSummary draft={draft} update={update} heater={heater} isAdmin={isAdmin} problems={problems} submitting={submitting} error={error} onJump={jump} /> : null}

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-300 rounded-lg border border-border bg-card px-400 py-300">
          <button type="button" className={button.secondary} disabled={draft.step === 1} onClick={() => go(previousStep(draft))}>
            <ArrowLeft aria-hidden="true" className="icon-size-200" />
            Back
          </button>
          <p id={reasonId} aria-live="polite" className="min-w-0 flex-1 text-right text-200 text-muted-foreground">
            {reason ?? ''}
          </p>
          {draft.step === 4 ? (
            <button type="button" className={button.primary} disabled={problems.length > 0 || submitting} aria-describedby={reasonId} onClick={() => void submit()}>
              <Send aria-hidden="true" className="icon-size-200" />
              {submitting ? 'Submitting…' : 'Submit for approval'}
            </button>
          ) : (
            <button type="button" className={button.primary} disabled={reason !== null} aria-describedby={reasonId} onClick={() => go(nextStep(draft))}>
              {draft.step === 3 ? 'Continue to review' : 'Next'}
              <ArrowRight aria-hidden="true" className="icon-size-200" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
