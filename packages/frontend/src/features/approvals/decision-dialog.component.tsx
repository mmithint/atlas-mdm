import { TriangleAlert } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { FormField } from '@/components/layout';
import { Modal } from '@/components/modal.component';
import { button, input } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import { InfoTip } from './info-tip.component';
import { decide, withdraw, type DetailRow, type RelatedRow, type ReturnCandidate, type Viewer } from './request-api';
import { CANNED_REASONS, MIN_REASON, candidateText, decisionBanner, returnTarget, valueText, withdrawBanner, type ResultBanner } from './request-model';

export type DialogAction = 'APPROVE' | 'REJECT' | 'RETURN' | 'WITHDRAW';

/** The longest comment the procedures accept (nvarchar(1000)). */
const COMMENT_MAX = 1000;

export interface DecisionDialogProps {
  action: DialogAction;
  request: DetailRow;
  viewer: Viewer;
  /** Who the person may return the request to (the server's list); empty = the default recipient only. */
  returnCandidates: readonly ReturnCandidate[];
  /** Other open requests that change the same field: an approval names them and asks again. */
  conflicts: readonly RelatedRow[];
  onClose: () => void;
  /** Called after the server accepted the action, with the sentence to show; the page then reads the request again. */
  onDone: (banner: ResultBanner) => void;
}

/**
 * The step after any of the decision buttons: the reason (required, at least 10 characters, to return or reject;
 * optional to approve or withdraw), what will happen, and one button that does it. Approve with an open conflict names
 * the conflicting requests first. Return adds the recipient picker. The procedure checks everything again, so a stale
 * page cannot do what the person was not allowed to do.
 */
export function DecisionDialog({ action, request, viewer, returnCandidates, conflicts, onClose, onDone }: DecisionDialogProps) {
  const recipientId = useId();
  const reasonId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [returnTo, setReturnTo] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stage = viewer.stage ?? request.approvalStage;
  const defaultTarget = returnTarget(viewer);
  const picked = returnCandidates.find((c) => c.email === returnTo);
  const target = picked ? candidateText(picked) : defaultTarget;
  const text = reason.trim();
  const required = action === 'RETURN' || action === 'REJECT';
  const conflicting = action === 'APPROVE' && conflicts.length > 0;
  const quick = required ? [...CANNED_REASONS, ...conflicts.slice(0, 1).map((c) => `Duplicate of ${c.requestRef}`)] : [];

  const submit = async () => {
    if (required && text.length < MIN_REASON) {
      setReasonError(`Write at least ${MIN_REASON} characters so the requester knows what to fix.`);
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let banner: ResultBanner;
      if (action === 'WITHDRAW') {
        const answer = await withdraw(request.requestId, text);
        banner = withdrawBanner(answer.requestRef ?? request.requestRef);
      } else {
        // `expectedStatus`: the procedure refuses when somebody decided the request after this page loaded.
        const answer = await decide(request.requestId, action, text, request.requestStatus, action === 'RETURN' ? returnTo : '');
        banner = decisionBanner({ ...answer, requestRef: answer.requestRef ?? request.requestRef });
      }
      onDone(banner);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      title={titleFor(action, request.requestRef)}
      onClose={close}
      busy={busy}
      footer={
        <>
          <button type="button" className={button.secondary} onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={action === 'REJECT' || action === 'WITHDRAW' ? button.danger : button.primary} disabled={busy} onClick={() => void submit()}>
            {busy ? 'Working…' : conflicting ? 'Approve anyway' : confirmLabel(action)}
          </button>
        </>
      }
    >
      <div className="space-y-400">
        <p className="flex flex-wrap items-center gap-x-200 text-300">
          {request.fieldLabel ?? request.fieldCode ?? 'Change'}: <span className="id-plate">{valueText(request.oldValue)}</span> <span aria-hidden="true">→</span>
          <span className="sr-only"> to </span> <span className="id-plate">{valueText(request.newValue)}</span>
          <InfoTip text={explain(action, stage, request.accountableGroup, target)} />
        </p>
        {conflicting ? (
          <div role="alert" className="flex items-start gap-200 rounded-md border border-border bg-card px-300 py-200 text-300">
            <TriangleAlert aria-hidden="true" className="mt-100 icon-size-300 shrink-0 text-warning-foreground" />
            <p className="flex flex-wrap items-center gap-x-100">
              <span className="font-semibold">{conflicts.length} other open {conflicts.length === 1 ? 'request changes' : 'requests change'} this field:</span>
              {conflicts.map((c) => (
                <span key={c.requestId} className="id-plate">
                  {c.requestRef}
                </span>
              ))}
              <InfoTip text={`Approving may overwrite or duplicate ${conflicts.length === 1 ? 'its' : 'their'} change.`} />
            </p>
          </div>
        ) : null}
        {action === 'RETURN' && returnCandidates.length > 0 ? (
          <div>
            <label htmlFor={recipientId} className="inline-flex items-center gap-100 text-300 font-medium">
              Return to
              <InfoTip text="The person you pick corrects and resubmits it. The requester keeps the request and is the only one, with an admin, who may withdraw it." />
            </label>
            <select id={recipientId} className={`${input} mt-100`} value={returnTo} disabled={busy} onChange={(event) => setReturnTo(event.target.value)}>
              <option value="">{defaultTarget ? `${defaultTarget} (default)` : 'The default recipient'}</option>
              {returnCandidates.map((c) => (
                <option key={c.email} value={c.email}>
                  {candidateText(c)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-200">
          <FormField
            label={
              <span className="inline-flex items-center gap-100 text-250">
                {action === 'WITHDRAW' ? 'Comment (optional)' : 'Reason (required to return or reject)'}
                {action === 'WITHDRAW' ? null : <InfoTip text={`At least ${MIN_REASON} characters to return or reject. Optional when you approve.`} />}
              </span>
            }
            htmlFor={reasonId}
            error={reasonError}
          >
            <textarea
              id={reasonId}
              ref={reasonRef}
              data-autofocus
              rows={3}
              maxLength={COMMENT_MAX}
              className={`${input} aria-[invalid=true]:border-destructive`}
              placeholder={action === 'WITHDRAW' ? '' : 'Add a note for the requester…'}
              value={reason}
              disabled={busy}
              aria-invalid={reasonError !== null}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError !== null && e.target.value.trim().length >= MIN_REASON) setReasonError(null);
              }}
            />
          </FormField>
          {quick.length > 0 ? (
            <ul className="flex flex-wrap gap-200" aria-label="Quick reasons">
              {quick.map((r) => (
                <li key={r}>
                  <button
                    type="button"
                    className={button.small}
                    disabled={busy}
                    onClick={() => {
                      setReason((n) => (n.trim() === '' ? r : `${n.trim()}. ${r}`));
                      setReasonError(null);
                      reasonRef.current?.focus();
                    }}
                  >
                    {r}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {error !== null ? <Alert><span className="font-medium">It was not recorded.</span> {error}</Alert> : null}
      </div>
    </Modal>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive px-300 py-200 text-300">
      {children}
    </p>
  );
}

function titleFor(action: DialogAction, ref: string): string {
  switch (action) {
    case 'APPROVE':
      return `Approve ${ref}`;
    case 'REJECT':
      return `Reject ${ref}`;
    case 'RETURN':
      return `Return ${ref} for correction`;
    case 'WITHDRAW':
      return `Withdraw ${ref}`;
  }
}

function confirmLabel(action: DialogAction): string {
  switch (action) {
    case 'APPROVE':
      return 'Approve';
    case 'REJECT':
      return 'Reject';
    case 'RETURN':
      return 'Return for correction';
    case 'WITHDRAW':
      return 'Withdraw request';
  }
}

/** What will happen, in plain words (shown as a tooltip beside the values). */
function explain(action: DialogAction, stage: string | null, accountableGroup: string, target: string | null): string {
  switch (action) {
    case 'APPROVE':
      return stage === 'ACCOUNTABLE'
        ? 'This is the final approval. The request becomes Approved and the golden record is updated with the proposed value.'
        : `You are approving at the responsible stage. The request then goes to ${accountableGroup} for the second approval.`;
    case 'REJECT':
      return 'Rejecting closes the request. Nothing changes in the golden record, and the requester sees your reason.';
    case 'RETURN':
      return `Returning sends the request back for correction. It will be returned to ${target ?? 'the person or group that raised it'}.`;
    case 'WITHDRAW':
      return 'Withdrawing closes the request. It stays in the history, and the same change can be raised again.';
  }
}
