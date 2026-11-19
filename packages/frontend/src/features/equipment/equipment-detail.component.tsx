import { ArrowLeft, Pencil } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useProfile } from '@/app/profile.context';
import { hrefFor } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, orBlank } from '@/lib/format';

import { fetchFormOptions } from './change-request-api';
import { buildFieldRows, flocLevels, type FieldRow } from './detail-model';
import { fetchHeater, type HeaterDetail } from './equipment-api';
import { EquipmentRequests } from './equipment-requests.component';
import { RequestDialog } from './request-dialog.component';
import { buildFieldChoices, submitBlockReason, type AccessInput } from './request-dialog-model';

/**
 * S-5 Equipment detail (POC-APP-06): the golden record of one heater, who answers and who
 * signs off for every field, the change requests on it, and honest placeholders for what later
 * phases add (rule results, verification, evidence). Reading changes nothing; "Request change"
 * (APP-4) opens a dialog whose submit goes through the request function and procedure.
 */
export function EquipmentDetail({ idText }: { idText: string }) {
  const valid = /^\d+$/.test(idText);
  const equipmentId = valid ? Number(idText) : -1;
  const state = useLoad(`heater:${equipmentId}`, () => (valid ? fetchHeater(equipmentId) : Promise.resolve(null)));

  return (
    <div className="space-y-400">
      <nav aria-label="Breadcrumb">
        <a className="inline-flex items-center gap-100 text-300 font-medium text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/equipment')}>
          <ArrowLeft aria-hidden="true" className="icon-size-200" />
          Equipment
        </a>
      </nav>

      {state.status === 'loading' ? <LoadingState rows={6} label="Loading the heater" /> : null}
      {state.status === 'error' ? (
        <ErrorState title="The heater could not be loaded" message={state.message} onRetry={state.retry} />
      ) : null}
      {state.status === 'ready' && state.data === null ? (
        <EmptyState
          title="No such heater"
          hint={`There is no heater with the id "${idText}". It may have been removed, or the link is wrong.`}
          action={
            <a className={button.secondary} href={hrefFor('/equipment')}>
              Search for a heater
            </a>
          }
        />
      ) : null}
      {state.status === 'ready' && state.data !== null ? <Heater detail={state.data} /> : null}
    </div>
  );
}

/** A stable empty list, so the memo below is not rebuilt on every render while the options load. */
const NO_BLOCKED_FIELDS: never[] = [];

function Heater({ detail }: { detail: HeaterDetail }) {
  const { heater, floc } = detail;
  const fields = useMemo(
    () => buildFieldRows(detail.catalog, detail.fieldValues, detail.ownership, heater),
    [detail.catalog, detail.fieldValues, detail.ownership, heater]
  );
  const levels = flocLevels(floc);
  const title = heater.equipmentTagNumber || heater.equipmentNumber || `Heater ${heater.equipmentId}`;
  const facility = heater.superiorFunctionalLocation;

  // What this person may request: the person (profile) and the form options, loaded once beside the page. A
  // failure here only switches the buttons off with the reason; it never breaks the page.
  const { state: profileState } = useProfile();
  const options = useLoad('request-form-options', fetchFormOptions);
  const blocked = options.status === 'ready' ? options.data.blockedFields : NO_BLOCKED_FIELDS;
  const choices = useMemo(
    () => buildFieldChoices(fields, detail.catalog, detail.fieldValues, blocked),
    [fields, detail.catalog, detail.fieldValues, blocked]
  );
  const access: AccessInput = {
    person:
      profileState.status === 'loading'
        ? 'loading'
        : profileState.status === 'error'
          ? 'unavailable'
          : profileState.profile.status === 'OK'
            ? 'registered'
            : 'not-registered',
    options:
      options.status === 'ready'
        ? { status: 'ready', canSubmit: options.data.canSubmit }
        : options.status === 'error'
          ? { status: 'error', message: options.message }
          : { status: 'loading' },
  };
  const blockReason = submitBlockReason(access);
  const choiceByCode = new Map(choices.map((c) => [c.fieldCode, c]));
  const [dialog, setDialog] = useState<{ fieldCode: string | null } | null>(null);
  const [requestsReload, setRequestsReload] = useState(0);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-300">
        <div className="min-w-0">
          <h1 className="break-words text-600 font-semibold">{title}</h1>
          <p className="mt-100 text-300 text-muted-foreground">{orBlank(heater.equipmentDescription)}</p>
          <p className="mt-200 flex flex-wrap items-center gap-200">
            {heater.equipmentNumber ? <span className="id-plate">{heater.equipmentNumber}</span> : null}
            {heater.functionalLocation ? <span className="id-plate">{heater.functionalLocation}</span> : null}
          </p>
        </div>
        <button
          type="button"
          className={button.primary}
          disabled={blockReason !== null}
          title={blockReason ?? 'Propose a change to one of the fields below'}
          onClick={() => setDialog({ fieldCode: null })}
        >
          <Pencil aria-hidden="true" className="icon-size-200" />
          Request change
        </button>
      </header>

      <div className="grid gap-300 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Identity">
          <Item label="Equipment number" plate={heater.equipmentNumber} />
          <Item label="Engineering tag" plate={heater.equipmentTagNumber} />
          <Item label="Serial number" plate={heater.manufacturerSerialNumber} />
          <Item label="Description" value={heater.equipmentDescription} />
        </SummaryCard>

        <SummaryCard title="Location">
          <Item label="Functional location (FLOC)" plate={heater.functionalLocation} />
          <Item label="FLOC description" value={heater.flocDescription} />
          <Item label="Facility (parent FLOC)">
            {facility ? (
              <a className="id-plate text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/equipment', { facility })} title="List every heater at this facility">
                {facility}
              </a>
            ) : (
              BLANK
            )}
          </Item>
          {levels.length > 0 ? (
            <Item label="Hierarchy, top level first">
              <span className="break-words text-200 text-muted-foreground">{levels.join('  ›  ')}</span>
            </Item>
          ) : null}
        </SummaryCard>

        <SummaryCard title="Classification">
          <Item label="Equipment class" value={heater.equipClass} />
          <Item label="Class type" value={heater.classType} />
          <Item label="Object type" value={heater.objectType} />
          <Item label="FLOC class" value={heater.flocClass} />
          <Item label="Technical object type" value={heater.techObjectType} />
        </SummaryCard>

        <SummaryCard title="Business">
          <Item label="Profit centre" value={heater.profitCenterName} />
          <Item label="Planner group" value={heater.plannerGroup} />
          <Item label="Equipment status" value={heater.equipmentUserStatus} />
          <Item label="FLOC status" value={heater.flocUserStatus} />
        </SummaryCard>
      </div>

      <FieldsTable
        fields={fields}
        requestBlock={(code) => blockReason ?? choiceByCode.get(code)?.unavailableReason ?? null}
        onRequest={(code) => setDialog({ fieldCode: code })}
      />

      <p className="text-200 text-muted-foreground">
        Golden record version {orBlank(heater.goldenVersionId)}. Last approved change:{' '}
        {heater.lastChangedAtUtc ? formatUtc(heater.lastChangedAtUtc) : 'none yet (the values are the SAP baseline)'}.
        SAP baseline taken {formatUtc(heater.baselineAsOfUtc)}.
      </p>

      <EquipmentRequests equipmentId={heater.equipmentId} reloadKey={requestsReload} />

      <section aria-labelledby="later-title" className="space-y-300">
        <h2 id="later-title" className="text-400 font-semibold">
          Still to come on this page
        </h2>
        <div className="grid gap-300 md:grid-cols-3">
          <Later title="Rule results" phase="APP-5" text="Valid or Invalid badges from the business rules, each with a Fix button." />
          <Later title="Verification" phase="APP-9" text="How many of the five key fields were verified, and when." />
          <Later title="Evidence" phase="APP-7" text="Photos from the field and the P&ID drawings for this site." />
        </div>
      </section>

      {dialog !== null && options.status === 'ready' ? (
        <RequestDialog
          heater={{ equipmentId: heater.equipmentId, functionalLocation: heater.functionalLocation, title }}
          choices={choices}
          allowedValues={options.data.allowedValues}
          initialFieldCode={dialog.fieldCode}
          onClose={() => setDialog(null)}
          onCreated={() => setRequestsReload((n) => n + 1)}
        />
      ) : null}
    </>
  );
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${card} p-400`} aria-label={title}>
      <h2 className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <dl className="mt-300 space-y-300">{children}</dl>
    </section>
  );
}

function Item({
  label,
  value,
  plate,
  children,
}: {
  label: string;
  value?: string | null;
  plate?: string | null;
  children?: ReactNode;
}) {
  let body: ReactNode;
  if (children !== undefined) body = children;
  else if (plate !== undefined) body = plate ? <span className="id-plate">{plate}</span> : BLANK;
  else body = orBlank(value);
  return (
    <div>
      <dt className="text-200 text-muted-foreground">{label}</dt>
      <dd className="mt-100 break-words text-300">{body}</dd>
    </div>
  );
}

const SOURCE_BADGE: Record<string, { text: string; className: string }> = {
  STATED: { text: 'stated', className: badge.neutral },
  ASSUMED: { text: 'assumed', className: badge.warning },
  MISSING: { text: 'missing', className: badge.warning },
  FIELD_VERIFIED: { text: 'field verified', className: badge.success },
  CORRECTED: { text: 'corrected', className: badge.info },
};

function FieldsTable({
  fields,
  requestBlock,
  onRequest,
}: {
  fields: readonly FieldRow[];
  /** Why a change to this field cannot be requested right now (the button's title), or null when it can. */
  requestBlock: (fieldCode: string) => string | null;
  onRequest: (fieldCode: string) => void;
}) {
  if (fields.length === 0) {
    return <EmptyState title="No fields to show" hint="The field catalogue is empty. Run the seed 0106 (field catalogue) in the database." />;
  }
  const groups: { title: string; rows: FieldRow[] }[] = [
    { title: 'Key fields', rows: fields.filter((f) => f.group === 'KEY') },
    { title: 'Additional details', rows: fields.filter((f) => f.group === 'ADDITIONAL') },
  ];
  return (
    <section aria-labelledby="fields-title" className={card}>
      <div className="border-b border-border px-400 py-300">
        <h2 id="fields-title" className="text-400 font-semibold">
          Fields
        </h2>
        <p className="mt-100 text-200 text-muted-foreground">
          The golden value of each field, the value in the SAP baseline, and who answers first and signs off second when someone proposes a change.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-300">
          <caption className="sr-only">All fields of this heater</caption>
          <thead>
            <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-400 py-200 font-semibold">Field</th>
              <th scope="col" className="px-400 py-200 font-semibold">Current value</th>
              <th scope="col" className="px-400 py-200 font-semibold">SAP baseline</th>
              <th scope="col" className="px-400 py-200 font-semibold">Answers first, signs off second</th>
              <th scope="col" className="px-400 py-200 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {groups
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <tbody key={g.title}>
                <tr>
                  <th scope="rowgroup" colSpan={5} className="bg-accent px-400 py-100 text-left text-200 font-semibold text-accent-foreground">
                    {g.title}
                  </th>
                </tr>
                {g.rows.map((f) => (
                  <FieldLine key={f.fieldCode} field={f} blockedBecause={requestBlock(f.fieldCode)} onRequest={() => onRequest(f.fieldCode)} />
                ))}
              </tbody>
            ))}
        </table>
      </div>
    </section>
  );
}

function FieldLine({ field, blockedBecause, onRequest }: { field: FieldRow; blockedBecause: string | null; onRequest: () => void }) {
  const source = field.valueSource ? (SOURCE_BADGE[field.valueSource] ?? { text: field.valueSource.toLowerCase(), className: badge.neutral }) : null;
  const unit = field.unit && field.current ? ` ${field.unit}` : '';
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="px-400 py-300 text-left font-medium">
        {field.label}
        {field.isKeyVerificationField ? <span className="ml-200 text-200 font-normal text-muted-foreground">counts toward verification</span> : null}
      </th>
      <td className="px-400 py-300">
        <span className="flex flex-wrap items-center gap-200">
          <span className={field.current ? 'id-plate' : 'text-muted-foreground'}>{field.current ? `${field.current}${unit}` : BLANK}</span>
          {source ? <span className={source.className}>{source.text}</span> : null}
          {field.changedFromBaseline ? <span className={badge.info}>changed</span> : null}
        </span>
      </td>
      <td className="px-400 py-300 text-muted-foreground">{field.baseline ? `${field.baseline}${field.unit ? ` ${field.unit}` : ''}` : BLANK}</td>
      <td className="px-400 py-300">
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
      </td>
      <td className="px-400 py-300 text-right">
        <button
          type="button"
          className={button.small}
          disabled={blockedBecause !== null}
          aria-label={`Request a change to ${field.label}`}
          title={blockedBecause ?? `Request a change to ${field.label}`}
          onClick={onRequest}
        >
          <Pencil aria-hidden="true" className="icon-size-100" />
        </button>
      </td>
    </tr>
  );
}

function Later({ title, phase, text }: { title: string; phase: string; text: string }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-card p-400" aria-label={`${title}, not built yet`}>
      <div className="flex items-center justify-between gap-200">
        <h3 className="text-300 font-semibold">{title}</h3>
        <span className={badge.neutral}>{phase}</span>
      </div>
      <p className="mt-200 text-200 text-muted-foreground">{text}</p>
    </section>
  );
}
