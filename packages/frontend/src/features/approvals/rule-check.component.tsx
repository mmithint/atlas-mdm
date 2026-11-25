import { Check, CircleHelp, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { Pill } from '@/components/layout';
import { button } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import type { CheckRow } from './request-api';
import { checkLabel, summarizeChecks } from './request-model';

/**
 * The approval checks as pills under their heading: a tick for pass (grey), a cross for fail (red), a question mark for
 * not checked (grey), each with its words (never colour alone). A failed check says what was found under the strip. The labels, results and
 * messages all come from the checks the server sent; "Check again" reads them again.
 */
export function RuleCheck({ checks, onRecheck }: { checks: readonly CheckRow[]; onRecheck: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = [...checks].sort((a, b) => a.order - b.order);
  const summary = summarizeChecks(rows);
  const failed = rows.filter((c) => c.checkStatus === 'FAIL');

  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRecheck();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0) return <p className="text-300 text-muted-foreground">No approval checks were returned for this request.</p>;

  return (
    <div className="space-y-200">
      <div className="flex flex-wrap items-center justify-between gap-200">
        <h3 className="text-300 font-medium">
          Approval checks <span className="font-normal text-muted-foreground tabular-nums">{summary.pass} of {rows.length} passed</span>
        </h3>
        <button type="button" className={button.small} onClick={() => void recheck()} disabled={busy}>
          <RefreshCw aria-hidden="true" className="icon-size-100" />
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {/* Below the heading; a pass is grey (a tick and its words), only a failure is red. */}
      <ul className="flex flex-wrap items-center gap-200" aria-label="Approval checks">
        {rows.map((c) => {
          const pass = c.checkStatus === 'PASS';
          const fail = c.checkStatus === 'FAIL';
          const Icon = pass ? Check : fail ? X : CircleHelp;
          return (
            <li key={c.code}>
              <Pill tone={fail ? 'danger' : 'neutral'} title={c.message}>
                <Icon aria-hidden="true" className="mr-100 icon-size-100" />
                {checkLabel(c.code)}
                <span className="sr-only">{pass ? ': passed' : fail ? ': failed' : ': not checked'}</span>
              </Pill>
            </li>
          );
        })}
      </ul>
      {failed.length > 0 ? (
        <ul role="alert" className="space-y-100 text-300 text-danger-text">
          {failed.map((c) => (
            <li key={c.code}>
              <span className="font-medium">{checkLabel(c.code)}:</span> {c.message}
            </li>
          ))}
        </ul>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-300 text-destructive">
          The checks could not be read again: {error}
        </p>
      ) : null}
    </div>
  );
}
