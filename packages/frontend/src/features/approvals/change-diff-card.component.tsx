import { ArrowRight, CircleCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Panel, Pill } from '@/components/layout';
import { BLANK, isBlank } from '@/lib/format';

import { InfoTip } from './info-tip.component';
import type { CheckRow, DetailRow, GoldRow } from './request-api';
import { isClosed, oldValueMismatch, valueText } from './request-model';

/**
 * One side of the change. The type scale: a 12px uppercase label, then the value in the mono face at 14px (the old one in red, the new one in green, both medium weight), with the unit as a quiet 12px suffix. A blank is a dash that a screen reader
 * hears as "blank".
 */
function Side({ label, value, unit, tone }: { label: string; value: string | null | undefined; unit: string | null; tone: 'old' | 'new' }) {
  const blank = isBlank(value);
  const box = tone === 'old' ? 'border-danger-border bg-danger-bg' : 'border-success-border bg-success';
  return (
    <div className={`min-w-0 rounded-md border px-300 py-200 ${box}`}>
      <p className="text-200 font-medium uppercase leading-200 tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-100 break-words font-monospace text-300 font-medium leading-300 ${tone === 'old' ? 'text-danger-text' : 'text-success-foreground'}`}>
        {blank ? BLANK : String(value)}
        {blank ? <span className="sr-only">blank</span> : null}
        {!blank && !isBlank(unit) ? <span className="ml-100 font-sans text-200 font-normal text-muted-foreground no-underline">{unit}</span> : null}
      </p>
    </div>
  );
}

/**
 * The hero of the page: the change in one look, what the requester saw next to what they propose, then whether SAP
 * still holds the value they saw (so approving cannot overwrite a newer edit). `footer` holds the rule checks.
 */
export function ChangeDiffCard({ request, gold, checks, footer }: { request: DetailRow; gold: GoldRow | null; checks: readonly CheckRow[]; footer?: ReactNode }) {
  const unit = gold?.fieldUnit ?? null;
  const open = !isClosed(request.requestStatus);
  const current = gold?.fieldCurrentValue ?? null;
  // The server's own words win; otherwise compare the values it sent. Blank and null are the same ("no value held").
  const serverNote = oldValueMismatch(checks);
  const moved = open && gold !== null && (isBlank(current) ? '' : String(current)) !== (isBlank(request.oldValue) ? '' : String(request.oldValue));
  const stale = serverNote !== null || moved;

  return (
    <Panel
      title="Proposed change"
      hint={
        <span className="flex flex-wrap items-center gap-200">
          <span className="text-200 font-medium text-foreground">{request.fieldLabel ?? request.fieldCode ?? 'Field'}</span>
          {request.sapField ? (
            <span className="id-plate" title="The SAP field this changes">
              {request.sapField}
            </span>
          ) : null}
        </span>
      }
      actions={
        <Pill tone="info" title="Where the request came from">
          {request.sourceLabel}
        </Pill>
      }
    >
      {/* Two compact boxes side by side, packed at the left (16rem each); `justify-start` stops the arrow's column stretching across the card. */}
      <div className="grid items-center justify-start gap-200 md:grid-cols-[16rem_auto_16rem]">
        <Side label="Requester saw" value={request.oldValue} unit={unit} tone="old" />
        <ArrowRight aria-label="changes to" role="img" className="mx-auto icon-size-200 rotate-90 text-muted-foreground md:rotate-0" />
        <Side label="Proposed value" value={request.newValue} unit={unit} tone="new" />
      </div>

      {open && stale ? (
        <p role="alert" className="mt-300 flex flex-wrap items-center gap-200 rounded-md border border-border bg-card px-300 py-200 text-250">
          <TriangleAlert aria-hidden="true" className="icon-size-200 shrink-0 text-warning-foreground" />
          <span className="font-semibold">SAP value changed since this was raised: now</span>
          <span className="id-plate">{valueText(current, unit)}</span>
          <InfoTip text={serverNote ?? `The requester saw ${valueText(request.oldValue, unit)}; the golden record now holds ${valueText(current, unit)}.`} />
        </p>
      ) : null}
      {open && !stale && gold !== null ? (
        <p className="mt-300 flex flex-wrap items-center gap-200 text-250 text-muted-foreground">
          <CircleCheck aria-hidden="true" className="icon-size-200 shrink-0 text-success-foreground" />
          Current SAP value
          <span className="id-plate">{valueText(current, unit)}</span>
          <InfoTip text="Still the value the requester saw, so approving will not overwrite a newer edit." />
        </p>
      ) : null}
      {open && gold === null ? (
        <p className="mt-300 flex items-center gap-200 text-250 text-muted-foreground">
          Not in the golden record
          <InfoTip text="The heater or location is no longer in the golden record, so its current value cannot be compared." />
        </p>
      ) : null}

      {footer ? <div className="mt-300 border-t border-divider pt-300">{footer}</div> : null}
    </Panel>
  );
}
