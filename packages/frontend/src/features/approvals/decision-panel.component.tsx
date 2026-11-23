import { Check, CornerUpLeft, Undo2, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Modal } from '@/components/modal.component';
import { button, input } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import { decide, withdraw, type CheckRow, type DetailRow, type ReturnCandidate, type Viewer } from './request-api';
import { approvalBlockers, candidateText, decisionBanner, returnTarget, valueText, withdrawBanner, type ResultBanner } from './request-model';

type Action = 'APPROVE' | 'REJECT' | 'RETURN' | 'WITHDRAW';

const FALLBACK_REASON = 'You may not decide this request.';
/** The longest comment the procedures accept (nvarchar(1000)). */
const COMMENT_MAX = 1000;

const DESTRUCTIVE =
  'inline-flex items-center justify-center gap-200 rounded-md bg-danger-solid px-400 py-200 text-300 font-medium text-on-danger transition-colors hover:bg-danger-solid-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/** Compact (small padding, no wrapping) versions of the shared buttons, so the whole panel fits one row. */
const COMPACT_BASE =
  'inline-flex items-center justify-center gap-100 whitespace-nowrap rounded-md px-300 py-100 text-200 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const COMPACT_PRIMARY = `${COMPACT_BASE} bg-primary text-primary-foreground hover:bg-primary/90`;
const COMPACT_SECONDARY = `${COMPACT_BASE} border border-border bg-card text-foreground hover:bg-accent`;
const COMPACT_GHOST = `${COMPACT_BASE} text-foreground hover:bg-accent`;

export interface DecisionPanelProps {
  request: DetailRow;
  viewer: Viewer;
  /** The checks now on screen; only used to explain why Approve is off (the server enforces the block). */
  checks: readonly CheckRow[];
  /**
   * Who the person may return the request to (the server's list, app.fn_return_candidates): the submitter, members
   * of both groups, and themselves. Empty = no picker; the request goes to the default recipient.
   */
  returnCandidates?: readonly ReturnCandidate[];
  /** Called after the server accepted the action, with the sentence to show; the page then reloads the request. */
  onDone: (banner: ResultBanner) => void;
}

/**
 * The decision panel of S-3: Approve, Reject, Return and (for the requester) Withdraw.
 *
 * What a person may do comes from the server (`viewer`, worked out by T-SQL from the same rules the decision
 * procedure enforces); this component only shows it. A button that is off always says why, next to the buttons,
 * and the same reason is attached to the button for screen readers. Reject and Return are gated by `canDecide`,
 * Approve by `canApprove` (the same since 18 Nov 2026, when the client allowed one person to approve both stages;
 * kept apart so a future rule can split them again).
 *
 * Return has a recipient picker (client, 18 Nov 2026): the default recipient first, then the server's candidates.
 */
export function DecisionPanel({ request, viewer, checks, returnCandidates = [], onDone }: DecisionPanelProps) {
  const reasonId = useId();
  const approveReasonId = useId();
  const commentId = useId();
  const recipientId = useId();
  const [action, setAction] = useState<Action | null>(null);
  const [comment, setComment] = useState('');
  const [returnTo, setReturnTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockers = approvalBlockers(checks);
  const rejectReason = viewer.canDecide ? null : (viewer.decideBlockedReason ?? FALLBACK_REASON);
  const approveReason = !viewer.canApprove
    ? (viewer.approveBlockedReason ?? viewer.decideBlockedReason ?? FALLBACK_REASON)
    : blockers.length > 0
      ? `A failed approval check blocks approval: ${blockers.join(', ')}.`
      : null;
  const sameReason = approveReason !== null && approveReason === rejectReason;

  const open = (next: Action) => {
    setAction(next);
    setComment('');
    setReturnTo('');
    setError(null);
  };
  const close = () => {
    if (!busy) setAction(null);
  };

  const stage = viewer.stage ?? request.approvalStage;
  const defaultTarget = returnTarget(viewer);
  const picked = returnCandidates.find((c) => c.email === returnTo);
  const target = picked ? candidateText(picked) : defaultTarget;
  const adminNote =
    viewer.canDecide && viewer.decidedAs === 'ADMIN'
      ? `You may decide this stage as an admin: you are not a member of ${stage === 'ACCOUNTABLE' ? request.accountableGroup : request.responsibleGroup}. The history will say so.`
      : null;
  const required = action === 'REJECT' || action === 'RETURN';
  const trimmed = comment.trim();

  const submit = async () => {
    if (action === null || (required && trimmed === '')) return;
    setBusy(true);
    setError(null);
    try {
      let banner: ResultBanner;
      if (action === 'WITHDRAW') {
        const answer = await withdraw(request.requestId, trimmed);
        banner = withdrawBanner(answer.requestRef ?? request.requestRef);
      } else {
        // `expectedStatus`: the procedure refuses when somebody decided the request after this page loaded.
        const answer = await decide(request.requestId, action, trimmed, request.requestStatus, action === 'RETURN' ? returnTo : '');
        banner = decisionBanner({ ...answer, requestRef: answer.requestRef ?? request.requestRef });
      }
      setAction(null);
      setComment('');
      onDone(banner);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    // One compact row that sits beside the page header. The reasons a button is off are now tooltips (a `title` on
    // the wrapper, since a disabled button shows none of its own) and stay in the page for screen readers (sr-only).
    <section aria-label="Decision" title={adminNote ?? undefined} className="flex flex-nowrap items-center gap-100">
      <span title={approveReason ?? undefined} className="inline-flex">
        <button
          type="button"
          className={COMPACT_PRIMARY}
          disabled={approveReason !== null}
          aria-describedby={approveReason === null ? undefined : sameReason ? reasonId : approveReasonId}
          onClick={() => open('APPROVE')}
        >
          <Check aria-hidden="true" className="icon-size-200" />
          Approve
        </button>
      </span>
      <span title={rejectReason ?? undefined} className="inline-flex">
        <button
          type="button"
          className={COMPACT_SECONDARY}
          disabled={rejectReason !== null}
          aria-describedby={rejectReason === null ? undefined : reasonId}
          onClick={() => open('REJECT')}
        >
          <X aria-hidden="true" className="icon-size-200" />
          Reject
        </button>
      </span>
      <span title={rejectReason ?? undefined} className="inline-flex">
        <button
          type="button"
          className={COMPACT_SECONDARY}
          disabled={rejectReason !== null}
          aria-describedby={rejectReason === null ? undefined : reasonId}
          onClick={() => open('RETURN')}
        >
          <CornerUpLeft aria-hidden="true" className="icon-size-200" />
          Return for correction
        </button>
      </span>
      {viewer.canCancel ? (
        <button type="button" className={COMPACT_GHOST} onClick={() => open('WITHDRAW')}>
          <Undo2 aria-hidden="true" className="icon-size-200" />
          Withdraw request
        </button>
      ) : null}

      {adminNote !== null ? <p className="sr-only">{adminNote}</p> : null}

      {sameReason ? (
        <p id={reasonId} className="sr-only">
          <span className="font-medium">Approve, Reject and Return are off:</span> {approveReason}
        </p>
      ) : (
        <>
          {approveReason !== null ? (
            <p id={approveReasonId} className="sr-only">
              <span className="font-medium">Approve is off:</span> {approveReason}
            </p>
          ) : null}
          {rejectReason !== null ? (
            <p id={reasonId} className="sr-only">
              <span className="font-medium">Reject and Return are off:</span> {rejectReason}
            </p>
          ) : null}
        </>
      )}

      {action !== null ? (
        <Modal
          title={titleFor(action, request.requestRef)}
          onClose={close}
          busy={busy}
          footer={
            <>
              <button type="button" className={button.secondary} onClick={close} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className={action === 'REJECT' || action === 'WITHDRAW' ? DESTRUCTIVE : button.primary}
                disabled={busy || (required && trimmed === '')}
                onClick={() => void submit()}
              >
                {busy ? 'Working…' : confirmLabel(action)}
              </button>
            </>
          }
        >
          <div className="space-y-300">
            <p className="text-300">
              {request.fieldLabel ?? request.fieldCode ?? 'Change'}:{' '}
              <span className="id-plate">{valueText(request.oldValue)}</span> <span aria-hidden="true">→</span>
              <span className="sr-only"> to </span> <span className="id-plate">{valueText(request.newValue)}</span>
            </p>
            <p className="text-300 text-muted-foreground">{explain(action, stage, request.accountableGroup, target)}</p>
            {action === 'RETURN' && returnCandidates.length > 0 ? (
              <div>
                <label htmlFor={recipientId} className="text-300 font-medium">
                  Return to
                </label>
                <select
                  id={recipientId}
                  className={`${input} mt-100`}
                  value={returnTo}
                  disabled={busy}
                  onChange={(event) => setReturnTo(event.target.value)}
                >
                  <option value="">{defaultTarget ? `${defaultTarget} (default)` : 'The default recipient'}</option>
                  {returnCandidates.map((c) => (
                    <option key={c.email} value={c.email}>
                      {candidateText(c)}
                    </option>
                  ))}
                </select>
                <p className="mt-100 text-200 text-muted-foreground">
                  The person you pick corrects and resubmits it. The requester keeps the request and is the only one,
                  with an admin, who may withdraw it.
                </p>
              </div>
            ) : null}
            <div>
              <label htmlFor={commentId} className="text-300 font-medium">
                {required ? 'Comment (required)' : 'Comment (optional)'}
              </label>
              <textarea
                id={commentId}
                className={`${input} mt-100 min-h-24`}
                value={comment}
                maxLength={COMMENT_MAX}
                aria-required={required}
                disabled={busy}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
            {error !== null ? (
              <Alert>
                <span className="font-medium">It was not recorded.</span> {error}
              </Alert>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive px-300 py-200 text-300">
      {children}
    </p>
  );
}

function titleFor(action: Action, ref: string): string {
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

function confirmLabel(action: Action): string {
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

/** What will happen, in plain words, for the confirm dialog. */
function explain(action: Action, stage: string | null, accountableGroup: string, target: string | null): string {
  switch (action) {
    case 'APPROVE':
      return stage === 'ACCOUNTABLE'
        ? 'This is the final approval. The request becomes Approved and the golden record is updated with the proposed value.'
        : `You are approving at the responsible stage. The request then goes to ${accountableGroup} for the second approval.`;
    case 'REJECT':
      return 'Rejecting closes the request. Nothing changes in the golden record, and the requester sees your comment.';
    case 'RETURN':
      return `Returning sends the request back for correction. It will be returned to ${target ?? 'the person or group that raised it'}.`;
    case 'WITHDRAW':
      return 'Withdrawing closes the request. It stays in the history, and the same change can be raised again.';
  }
}
