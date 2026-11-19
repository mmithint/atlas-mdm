import { useState } from 'react';

import { Modal } from '@/components/modal.component';
import { button, input } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import type { BulkAnswer } from './queue-api';
import { mergeNote } from './queue-model';

const COMMENT_MAX = 1000;

/**
 * Step 1 of a bulk approval: "Approve n requests?". The people see what will happen before it does:
 * every request is judged on its own, so one that fails a check is skipped and listed, never approved
 * by the others' company. `onApprove` makes the call; this dialog only shows that it is running and,
 * when the call as a whole fails, its message, keeping itself open so nothing is lost.
 */
export function BulkConfirmDialog({
  count,
  onApprove,
  onCancel,
  onResult,
}: {
  readonly count: number;
  readonly onApprove: (comment: string) => Promise<BulkAnswer>;
  readonly onCancel: () => void;
  readonly onResult: (answer: BulkAnswer) => void;
}) {
  const [comment, setComment] = useState('');
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noun = count === 1 ? 'request' : 'requests';

  const approve = async () => {
    setRunning(true);
    setProblem(null);
    try {
      onResult(await onApprove(comment.trim()));
    } catch (error) {
      setProblem(errorText(error));
      setRunning(false);
    }
  };

  return (
    <Modal
      title={`Approve ${count} ${noun}?`}
      onClose={onCancel}
      busy={running}
      footer={
        <>
          <button type="button" className={button.secondary} onClick={onCancel} disabled={running}>
            Cancel
          </button>
          <button type="button" className={button.primary} onClick={() => void approve()} disabled={running}>
            {running ? 'Approving…' : `Approve ${count} ${noun}`}
          </button>
        </>
      }
    >
      <div className="space-y-300 text-300">
        <p>
          Each request is checked on its own, exactly as if you approved it alone. A request that fails a check, or that you may not decide, is
          skipped and listed afterwards; the others are approved.
        </p>
        <label className="flex flex-col gap-100 text-200 font-medium text-muted-foreground">
          Comment (optional, kept on every request&apos;s history)
          <textarea
            className={`${input} min-h-24 font-normal`}
            maxLength={COMMENT_MAX}
            value={comment}
            disabled={running}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        {problem ? (
          <p role="alert" className="rounded-md border border-destructive px-300 py-200 text-destructive">
            {problem}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Step 2: what happened. "n approved, m skipped", the reason for each skipped request (the server's own
 * sentence), and, for an approved request whose copy into the golden record did not complete, a line
 * saying so: the approval stands, the update is pending.
 */
export function BulkResultDialog({ answer, onClose }: { readonly answer: BulkAnswer; readonly onClose: () => void }) {
  const skipped = answer.results.filter((r) => r.outcome !== 'DECIDED');
  const pending = answer.results.map((r) => ({ row: r, note: mergeNote(r) })).filter((x) => x.note !== null);

  return (
    <Modal
      title="Bulk approval finished"
      size="lg"
      onClose={onClose}
      footer={
        <button type="button" className={button.primary} onClick={onClose} data-autofocus>
          Done
        </button>
      }
    >
      <div className="space-y-400 text-300">
        <p role="status" className="text-400">
          <strong>{answer.decided}</strong> approved, <strong>{answer.skipped}</strong> skipped
        </p>

        {skipped.length > 0 ? (
          <section aria-labelledby="bulk-skipped">
            <h3 id="bulk-skipped" className="text-300 font-semibold">
              Skipped
            </h3>
            <ul className="mt-200 divide-y divide-border rounded-md border border-border">
              {skipped.map((r, i) => (
                <li key={`${r.requestId ?? 'x'}-${i}`} className="px-300 py-200">
                  <span className="id-plate">{r.requestRef ?? (r.requestId === null ? 'unknown' : `#${r.requestId}`)}</span>
                  <span className="ml-200 break-words text-muted-foreground">{r.reason ?? 'No reason was given.'}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pending.length > 0 ? (
          <section aria-labelledby="bulk-pending">
            <h3 id="bulk-pending" className="text-300 font-semibold">
              Approved, golden record not updated yet
            </h3>
            <ul className="mt-200 divide-y divide-border rounded-md border border-border">
              {pending.map(({ row, note }, i) => (
                <li key={`${row.requestId ?? 'x'}-${i}`} className="px-300 py-200">
                  <span className="id-plate">{row.requestRef ?? `#${row.requestId}`}</span>
                  <span className="ml-200 break-words text-muted-foreground">{note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
