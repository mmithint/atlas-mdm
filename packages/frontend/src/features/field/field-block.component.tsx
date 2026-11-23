import clsx from 'clsx';
import { useId } from 'react';

import { Pill } from '@/components/layout';
import { input } from '@/components/ui';
import { formatUtc } from '@/lib/format';

import { MARK_LABEL, type BlockEntry } from './field-model';
import type { FormFieldRow, Mark } from './field-types';

const MARKS: Mark[] = ['VERIFIED_CORRECT', 'CORRECTION_REQUIRED', 'DID_NOT_VERIFY'];

/**
 * One field of the TrueContext form: the current value, its last mark, the three-way choice and, for a
 * correction, the value seen on site (list, or typed when it "does not exist in the list"), illegible / not
 * found, and the required comment (PTD-12).
 */
export function FieldBlock({ field, entry, onChange }: { field: FormFieldRow; entry: BlockEntry; onChange: (next: BlockEntry) => void }) {
  const id = useId();
  const set = (patch: Partial<BlockEntry>) => onChange({ ...entry, ...patch });
  const unit = field.unit ? ` ${field.unit}` : '';
  const useList = field.input === 'LIST' && field.options.length > 0 && !entry.dne;

  return (
    <fieldset className={clsx('rounded-md border p-300', entry.mark === 'CORRECTION_REQUIRED' ? 'border-warning-border' : 'border-border')}>
      <legend className="sr-only">{field.label}</legend>
      <div className="flex flex-wrap items-center gap-200">
        <span className="text-300 font-semibold">{field.label}</span>
        {field.mandatory ? <Pill tone="warning" title="Set by the admin: mark it before Review">Required</Pill> : null}
        {field.isKey ? <Pill tone="info" title="Counts towards the heater's verification % (WA-07)">Key field</Pill> : null}
        {field.source === 'EXTRA' ? <Pill tone="neutral" title="On the TrueContext form, not in field catalogue v1">Recorded only</Pill> : null}
        {field.adminOnly ? <Pill tone="neutral" title="Only an admin or a rule may change it">Admin-only change</Pill> : null}
      </div>
      <p className="mt-100 text-300">
        <span className="text-muted-foreground">Current value: </span>
        <span className="font-mono">{field.currentValue ? `${field.currentValue}${unit}` : '— (blank)'}</span>
      </p>
      {field.lastMark ? (
        <p className="text-200 text-muted-foreground">
          Last mark: {MARK_LABEL[field.lastMark]} · {field.markedBy ?? 'unknown'} · {formatUtc(field.markedAtUtc)}
        </p>
      ) : (
        <p className="text-200 text-muted-foreground">Not marked yet</p>
      )}
      {field.note ? <p className="text-200 text-muted-foreground">{field.note}</p> : null}

      <div role="radiogroup" aria-label={`${field.label}: mark`} className="mt-200 grid grid-cols-1 gap-100 sm:grid-cols-3">
        {MARKS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={entry.mark === m}
            onClick={() => set({ mark: entry.mark === m ? null : m })}
            className={clsx(
              'rounded-md border px-300 py-200 text-300 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              entry.mark === m ? (m === 'CORRECTION_REQUIRED' ? 'border-warning-border bg-warning text-warning-foreground' : m === 'VERIFIED_CORRECT' ? 'border-success-border bg-success text-success-foreground' : 'border-border bg-muted') : 'border-border bg-card hover:bg-accent'
            )}
          >
            {MARK_LABEL[m]}
          </button>
        ))}
      </div>

      {entry.mark === 'CORRECTION_REQUIRED' ? (
        <div className="mt-300 space-y-200">
          <label className="block text-200">
            <span className="text-muted-foreground">Can you read it?</span>
            <select className={input} value={entry.unreadableReason} onChange={(e) => set({ unreadableReason: e.target.value })}>
              <option value="">Yes, I can read the value</option>
              <option value="Illegible">Illegible (needs a photo)</option>
              <option value="Not found">Not found (needs a photo)</option>
            </select>
          </label>

          {entry.unreadableReason ? null : (
            <div>
              <label htmlFor={`${id}-value`} className="block text-200 text-muted-foreground">
                Value seen on site{unit}
              </label>
              {useList ? (
                <select id={`${id}-value`} className={input} value={entry.newValue} onChange={(e) => set({ newValue: e.target.value })}>
                  <option value="">Pick a value</option>
                  {field.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${id}-value`}
                  className={input}
                  inputMode={field.input === 'NUMBER' ? 'decimal' : undefined}
                  value={entry.newValue}
                  placeholder={field.input === 'NUMBER' ? 'A number' : 'Type the value as written'}
                  onChange={(e) => set({ newValue: e.target.value })}
                />
              )}
              {field.allowDne ? (
                <label className="mt-100 flex items-center gap-200 text-200">
                  <input type="checkbox" checked={entry.dne} onChange={(e) => set({ dne: e.target.checked, newValue: '' })} />
                  Does not exist in the list (type it)
                </label>
              ) : null}
            </div>
          )}

          <label className="block text-200">
            <span className="text-muted-foreground">Why it needs correcting (required)</span>
            <textarea className={input} rows={2} value={entry.comment} onChange={(e) => set({ comment: e.target.value })} />
          </label>
          {field.source === 'EXTRA' ? <p className="text-200 text-muted-foreground">Kept with the form. No approval request: this field is not in field catalogue v1.</p> : null}
          {field.adminOnly ? <p className="text-200 text-muted-foreground">Kept for the data owner. Only an admin or a business rule changes this field.</p> : null}
          {field.source === 'CATALOG' && !field.adminOnly ? <p className="text-200 text-muted-foreground">Becomes an approval request when you submit.</p> : null}
        </div>
      ) : null}
    </fieldset>
  );
}
