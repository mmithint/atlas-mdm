import { Check, CornerUpLeft, Undo2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { button } from '@/components/ui';
import { useHashRoute } from '@/hooks/use-hash-route';

import { DecisionDialog, type DialogAction } from './decision-dialog.component';
import type { CheckRow, DetailRow, RelatedRow, ReturnCandidate, Viewer } from './request-api';
import { approvalBlockers, isClosed, nextStepText, type ResultBanner } from './request-model';
import { isTypingTarget } from './use-queue-position';

const FALLBACK_REASON = 'You may not decide this request.';

export interface DecisionActionsProps {
  request: DetailRow;
  viewer: Viewer;
  /** The checks now on screen; only used to explain why Approve is off (the server enforces the block). */
  checks: readonly CheckRow[];
  returnCandidates: readonly ReturnCandidate[];
  /** Other open requests that change the same field (an approval names them first). */
  conflicts: readonly RelatedRow[];
  /** Called after the server accepted the action; the page then reads the request again and shows the sentence. */
  onDone: (banner: ResultBanner) => void;
}

/**
 * The decision as a row of buttons for the page header: Reject, Return for correction and Approve (the one filled
 * button, last), and Withdraw for the requester, apart at the start. Any of them opens the dialog, which asks for the reason (required to return or
 * reject) and does the action.
 *
 * What a person may do comes from the server (`viewer`, worked out by T-SQL from the same rules the decision procedure
 * enforces); this only shows it. A button that is off says why in a tooltip, and in words for screen readers. A, R and X
 * decide from the keyboard. Opened from a row's Reject or Return icon in the Approvals list, the dialog is already open.
 */
export function DecisionActions({ request, viewer, checks, returnCandidates, conflicts, onDone }: DecisionActionsProps) {
  const offId = useId();
  const preset = useHashRoute().query.get('decide');
  const [dialog, setDialog] = useState<DialogAction | null>(preset === 'REJECT' || preset === 'RETURN' ? preset : null);

  const closed = isClosed(request.requestStatus);
  const blockers = approvalBlockers(checks);
  const rejectReason = viewer.canDecide ? null : (viewer.decideBlockedReason ?? FALLBACK_REASON);
  const approveReason = !viewer.canApprove
    ? (viewer.approveBlockedReason ?? viewer.decideBlockedReason ?? FALLBACK_REASON)
    : blockers.length > 0
      ? `A failed approval check blocks approval: ${blockers.join(', ')}.`
      : null;
  const offNotes =
    approveReason !== null && approveReason === rejectReason
      ? [`Approve, Return and Reject are off: ${approveReason}`]
      : [approveReason !== null ? `Approve is off: ${approveReason}` : null, rejectReason !== null ? `Return and Reject are off: ${rejectReason}` : null].filter((x): x is string => x !== null);

  const stage = viewer.stage ?? request.approvalStage;
  const adminNote =
    viewer.canDecide && viewer.decidedAs === 'ADMIN'
      ? `You may decide this stage as an admin: you are not a member of ${stage === 'ACCOUNTABLE' ? request.accountableGroup : request.responsibleGroup}. The history will say so.`
      : null;
  // Not shown on screen: who may decide as an admin, and what happens after an approval. It is part of Approve's tooltip.
  const tip = [adminNote, nextStepText(request)].filter((x): x is string => x !== null).join(' ');

  // A, R and X decide from the keyboard, unless a field or a dialog has the keys.
  const live = useRef({ approve: approveReason === null, reject: rejectReason === null });
  useEffect(() => {
    live.current = { approve: approveReason === null, reject: rejectReason === null };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event)) return;
      const { approve, reject } = live.current;
      const key = event.key.toLowerCase();
      if (key === 'a' && approve) setDialog('APPROVE');
      else if (key === 'r' && reject) setDialog('RETURN');
      else if (key === 'x' && reject) setDialog('REJECT');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const done = (banner: ResultBanner) => {
    setDialog(null);
    onDone(banner);
  };

  // A button's tooltip (on its wrapper, since a disabled button shows none): why it is off, or its key.
  const tipped = (reason: string | null, key: string, node: ReactNode) => (
    <span title={reason ?? `Shortcut: ${key}`} className="inline-flex">
      {node}
    </span>
  );

  return (
    <>
      {offNotes.length > 0 && !closed ? (
        <div id={offId} className="sr-only">
          {offNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}

      {closed ? null : (
        <div role="group" aria-label="Your decision" className="flex flex-wrap items-center gap-200">
          {/* The requester's own action first, apart from the decision; then, least final to most: Reject, Return, Approve (the one filled button, at the end where the eye finishes). */}
          {viewer.canCancel ? (
            <>
              <button type="button" className={button.ghost} onClick={() => setDialog('WITHDRAW')}>
                <Undo2 aria-hidden="true" className="icon-size-200" />
                Withdraw request
              </button>
              <span aria-hidden="true" className="mx-100 h-600 w-px bg-border" />
            </>
          ) : null}
          {tipped(
            rejectReason,
            'X',
            <button type="button" className={button.dangerOutline} disabled={rejectReason !== null} aria-describedby={rejectReason === null ? undefined : offId} onClick={() => setDialog('REJECT')}>
              <X aria-hidden="true" className="icon-size-200" />
              Reject
            </button>
          )}
          {tipped(
            rejectReason,
            'R',
            <button type="button" className={button.secondary} disabled={rejectReason !== null} aria-describedby={rejectReason === null ? undefined : offId} onClick={() => setDialog('RETURN')}>
              <CornerUpLeft aria-hidden="true" className="icon-size-200" />
              Return for correction
            </button>
          )}
          {tipped(
            approveReason,
            tip ? `A. ${tip}` : 'A',
            <button type="button" className={button.primary} disabled={approveReason !== null} aria-describedby={approveReason === null ? undefined : offId} onClick={() => setDialog('APPROVE')}>
              <Check aria-hidden="true" className="icon-size-200" />
              Approve
            </button>
          )}
        </div>
      )}

      {dialog !== null ? (
        <DecisionDialog action={dialog} request={request} viewer={viewer} returnCandidates={returnCandidates} conflicts={conflicts} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </>
  );
}
