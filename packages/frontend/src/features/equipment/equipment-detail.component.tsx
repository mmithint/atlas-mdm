import { ArrowLeft, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

import { hrefFor } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, orBlank } from '@/lib/format';

import { buildFieldRows, flocLevels, type FieldRow } from './detail-model';
import { fetchHeater, type HeaterDetail } from './equipment-api';

/**
 * S-5 Equipment detail (POC-APP-06), first half: the golden record of one heater, who
 * answers and who signs off for every field, and honest placeholders for what later phases
 * add (rule results, verification, history and requests, evidence). Nothing here changes
 * data; "Request change" is wired in APP-4.
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

function Heater({ detail }: { detail: HeaterDetail }) {
  const { heater, floc } = detail;
  const fields = buildFieldRows(detail.catalog, detail.fieldValues, detail.ownership, heater);
  const levels = flocLevels(floc);
  const title = heater.equipmentTagNumber || heater.equipmentNumber || `Heater ${heater.equipmentId}`;
  const facility = heater.superiorFunctionalLocation;

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
          disabled
          title="Change requests open in the approval phase (APP-4)"
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

      <FieldsTable fields={fields} />

      <p className="text-200 text-muted-foreground">
        Golden record version {orBlank(heater.goldenVersionId)}. Last approved change:{' '}
        {heater.lastChangedAtUtc ? formatUtc(heater.lastChangedAtUtc) : 'none yet (the values are the SAP baseline)'}.
        SAP baseline taken {formatUtc(heater.baselineAsOfUtc)}.
      </p>

      <section aria-labelledby="later-title" className="space-y-300">
        <h2 id="later-title" className="text-400 font-semibold">
          Still to come on this page
        </h2>
        <div className="grid gap-300 md:grid-cols-2 xl:grid-cols-4">
          <Later title="Rule results" phase="APP-5" text="Valid or Invalid badges from the business rules, each with a Fix button." />
          <Later title="Verification" phase="APP-9" text="How many of the five key fields were verified, and when." />
          <Later title="History and requests" phase="APP-4" text="Every change request on this heater or its FLOC, open and closed, and who approved what." />
          <Later title="Evidence" phase="APP-7" text="Photos from the field and the P&ID drawings for this site." />
        </div>
      </section>
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

function FieldsTable({ fields }: { fields: readonly FieldRow[] }) {
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
                  <FieldLine key={f.fieldCode} field={f} />
                ))}
              </tbody>
            ))}
        </table>
      </div>
    </section>
  );
}

function FieldLine({ field }: { field: FieldRow }) {
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
          disabled
          aria-label={`Request a change to ${field.label} (available in the approval phase)`}
          title="Change requests open in the approval phase (APP-4)"
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
