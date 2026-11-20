import { useId, useState } from 'react';

import { Modal } from '@/components/modal.component';
import { hrefFor } from '@/app/router';
import { badge, button, input } from '@/components/ui';
import { errorText } from '@/lib/act-answer';
import { BLANK } from '@/lib/format';

import { submitChangeRequest, type AllowedValueRow, type CreateAnswer } from './change-request-api';
import {
  REASON_MAX,
  allowedFor,
  buildCreateArguments,
  canSubmit,
  sameValue,
  valueHint,
  valueProblem,
  type FieldChoice,
} from './request-dialog-model';

export interface RequestDialogProps {
  /** The heater the request is about. `title` is what the page calls it (tag, number). */
  heater: { equipmentId: number; functionalLocation: string | null; title: string };
  /** Every catalogue field of the heater; the ones the person may not request are left out of the picker. */
  choices: readonly FieldChoice[];
  allowedValues: readonly AllowedValueRow[];
  /** The field to start on (the row's pencil button), or null to let the person pick. */
  initialFieldCode: string | null;
  onClose: () => void;
  /** Called once when a NEW request was created (not for a suppressed duplicate), so the page can reload its list. */
  onCreated: () => void;
}

/**
 * S-5 "Request change" (POC-APP-09; the client's compressor pattern, REF-15 and REF-18): choose a field, see the
 * current value read-only, give the new value and a reason, and Submit stays disabled until the value differs.
 *
 * The browser only collects and hints; `app.usp_request_create` decides. Its refusal text appears inside the dialog
 * and the dialog stays open. A request that already exists (same change, or a different value for the same field) is
 * not an error: the server answers with the OTHER request, shown with a link.
 */
export function RequestDialog({ heater, choices, allowedValues, initialFieldCode, onClose, onCreated }: RequestDialogProps) {
  const ids = useId();
  const available = choices.filter((c) => c.unavailableReason === null);
  const [fieldCode, setFieldCode] = useState(() => (available.some((c) => c.fieldCode === initialFieldCode) ? (initialFieldCode ?? '') : ''));
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CreateAnswer | null>(null);

  const field = available.find((c) => c.fieldCode === fieldCode) ?? null;
  const allowed = field === null ? [] : allowedFor(allowedValues, field.fieldCode);
  const problem = field === null ? null : valueProblem(field, newValue, allowed);
  const unchanged = field !== null && newValue.trim() !== '' && sameValue(field.rawCurrent, newValue, field.dataType);
  const ready = canSubmit(field, newValue, reason, allowed);

  async function submit() {
    if (field === null || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitChangeRequest(buildCreateArguments(heater, field, newValue, reason));
      setAnswer(result);
      if (result.outcome === 'CREATED') onCreated();
    } catch (failure) {
      // A refusal ("only an admin may ...", "the value is not in the allowed list") or a failure: keep the form open.
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (answer !== null) {
    return (
      <Modal
        title="Change request"
        onClose={onClose}
        footer={
          <button type="button" data-autofocus className={button.primary} onClick={onClose}>
            Close
          </button>
        }
      >
        <Outcome answer={answer} />
      </Modal>
    );
  }

  const valueId = `${ids}-value`;
  const hintId = `${ids}-hint`;
  const reasonId = `${ids}-reason`;

  return (
    <Modal
      title={`Request a change to ${heater.title}`}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" className={button.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={button.primary} onClick={() => void submit()} disabled={!ready || busy}>
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
        </>
      }
    >
      <form
        className="space-y-400"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor={`${ids}-field`} className="text-200 font-medium">
            Field
          </label>
          <select
            id={`${ids}-field`}
            className={`${input} mt-100`}
            value={fieldCode}
            disabled={busy}
            onChange={(event) => {
              setFieldCode(event.target.value);
              setNewValue('');
              setError(null);
            }}
          >
            <option value="">Choose a field</option>
            {available.map((c) => (
              <option key={c.fieldCode} value={c.fieldCode}>
                {c.label}
              </option>
            ))}
          </select>
          {available.length === 0 ? <p className="mt-100 text-200 text-muted-foreground">No field of this heater can be requested by you.</p> : null}
        </div>

        {field !== null ? (
          <>
            <dl className="grid gap-300 rounded-md bg-muted px-300 py-300 sm:grid-cols-2">
              <div>
                <dt className="text-200 text-muted-foreground">Current value</dt>
                <dd className="mt-100 break-words text-300">
                  {field.current ? (
                    <span className="id-plate">{withUnit(field.current, field.unit)}</span>
                  ) : (
                    <span className="text-muted-foreground">{BLANK} (blank)</span>
                  )}
                </dd>
              </div>
              {field.baseline ? (
                <div>
                  <dt className="text-200 text-muted-foreground">SAP baseline</dt>
                  <dd className="mt-100 break-words text-300">
                    <span className="id-plate">{withUnit(field.baseline, field.unit)}</span>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-200 text-muted-foreground">Answers first, signs off second</dt>
                <dd className="mt-100 text-300">
                  {field.responsibleRole && field.accountableRole ? (
                    <span>
                      {field.responsibleRole} <span aria-hidden="true">→</span>
                      <span className="sr-only"> then </span> {field.accountableRole}
                    </span>
                  ) : (
                    <span className={badge.warning} title="No approval route matches this field. An admin sees it on the route check.">
                      no route
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <div>
              <label htmlFor={valueId} className="text-200 font-medium">
                New value
              </label>
              {field.valuesFromList ? (
                <select
                  id={valueId}
                  className={`${input} mt-100`}
                  value={newValue}
                  disabled={busy}
                  aria-describedby={hintId}
                  onChange={(event) => setNewValue(event.target.value)}
                >
                  <option value="">Choose a value</option>
                  {allowed.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={valueId}
                  type="text"
                  className={`${input} mt-100`}
                  inputMode={field.dataType === 'DECIMAL' ? 'decimal' : 'text'}
                  autoComplete="off"
                  value={newValue}
                  disabled={busy}
                  aria-describedby={hintId}
                  aria-invalid={problem !== null}
                  onChange={(event) => setNewValue(event.target.value)}
                />
              )}
              <p id={hintId} className={`mt-100 text-200 ${problem !== null || unchanged ? 'text-destructive' : 'text-muted-foreground'}`}>
                {problem ?? (unchanged ? 'This is the value the field already has: type a different one.' : valueHint(field))}
              </p>
            </div>

            <div>
              <label htmlFor={reasonId} className="text-200 font-medium">
                Reason for the change
              </label>
              <textarea
                id={reasonId}
                className={`${input} mt-100`}
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="mt-100 text-right text-200 text-muted-foreground" aria-live="off">
                {reason.length} / {REASON_MAX}
              </p>
            </div>
          </>
        ) : null}

        {error !== null ? (
          <p role="alert" className="rounded-md border border-destructive bg-card px-300 py-200 text-300">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

const withUnit = (value: string, unit: string | null): string => (unit ? `${value} ${unit}` : value);

function Outcome({ answer }: { answer: CreateAnswer }) {
  const link =
    answer.requestId !== null ? (
      <a className="id-plate text-brand-foreground underline-offset-2 hover:underline" href={hrefFor(`/requests/${answer.requestId}`)}>
        {answer.requestRef ?? `Request ${answer.requestId}`}
      </a>
    ) : null;

  if (answer.outcome === 'CREATED') {
    return (
      <div role="status" className="space-y-200 text-300">
        <p className={`${badge.success} text-300`}>Request created</p>
        <p>
          Request {link} was created. It now waits for <strong>{answer.responsibleGroup ?? 'the responsible group'}</strong>, then for{' '}
          <strong>{answer.accountableGroup ?? 'the accountable group'}</strong>.
        </p>
      </div>
    );
  }
  if (answer.outcome === 'DUPLICATE_SUPPRESSED') {
    return (
      <div role="status" className="space-y-200 text-300">
        <p className={`${badge.info} text-300`}>Already requested</p>
        <p>An open request already proposes this change: {link}. Nothing new was created.</p>
      </div>
    );
  }
  if (answer.outcome === 'BLOCKED_INCOMPATIBLE') {
    return (
      <div role="status" className="space-y-200 text-300">
        <p className={`${badge.warning} text-300`}>Blocked by another request</p>
        <p>Another open request proposes a different value for this field: {link}. Nothing new was created.</p>
      </div>
    );
  }
  return (
    <p role="status" className="text-300">
      The server answered &ldquo;{answer.outcome ?? 'nothing'}&rdquo;. Nothing new was created.
    </p>
  );
}
