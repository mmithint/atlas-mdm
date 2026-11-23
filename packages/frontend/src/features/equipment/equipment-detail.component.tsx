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
  const columns = useMemo(() => buildColumns(heater, flocLevels(floc), fields), [heater, floc, fields]);
  const title = heater.equipmentTagNumber || heater.equipmentNumber || `Heater ${heater.equipmentId}`;

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
        <div className="min-w-0 flex">
          <h1 className="break-words text-600 font-semibold">{title}</h1>
          {/* <p className="mt-100 text-300 text-muted-foreground">{orBlank(heater.equipmentDescription)}</p> */}
          <p className="ml-4 flex flex-wrap items-center gap-200">
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

      <FieldsTables
        columns={columns}
        requestBlock={(code) => blockReason ?? choiceByCode.get(code)?.unavailableReason ?? null}
        onRequest={(code) => setDialog({ fieldCode: code })}
      />
      {fields.length === 0 ? (
        <EmptyState title="No catalogue fields to show" hint="The field catalogue is empty. Run the seed 0106 (field catalogue) in the database." />
      ) : null}

      {/* <p className="text-200 text-muted-foreground">
        Golden record version {orBlank(heater.goldenVersionId)}. Last approved change:{' '}
        {heater.lastChangedAtUtc ? formatUtc(heater.lastChangedAtUtc) : 'none yet (the values are the SAP baseline)'}.
        SAP baseline taken {formatUtc(heater.baselineAsOfUtc)}.
      </p> */}

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

/** One line of a table: a label and what to show as its value. */
interface DetailRow {
  label: string;
  value: ReactNode;
  /** Set for a catalogue field, which can be changed by request. The heater's own columns are read-only. */
  fieldCode?: string;
}

interface DetailGroup {
  title: string;
  rows: DetailRow[];
}

const plate = (value: string | null | undefined): ReactNode => (value ? <span className="id-plate">{value}</span> : BLANK);

function summaryGroups(heater: HeaterDetail['heater'], levels: readonly string[]) {
  const facility = heater.superiorFunctionalLocation;
  const identity: DetailGroup = {
    title: 'Identity',
    rows: [
      { label: 'Equipment number', value: plate(heater.equipmentNumber) },
      { label: 'Engineering tag', value: plate(heater.equipmentTagNumber) },
      { label: 'Serial number', value: plate(heater.manufacturerSerialNumber) },
      { label: 'Description', value: orBlank(heater.equipmentDescription) },
    ],
  };
  const location: DetailGroup = {
    title: 'Location',
    rows: [
      { label: 'Functional location (FLOC)', value: plate(heater.functionalLocation) },
      { label: 'FLOC description', value: orBlank(heater.flocDescription) },
      {
        label: 'Facility (parent FLOC)',
        value: facility ? (
          <a className="id-plate text-brand-foreground underline-offset-2 hover:underline" href={hrefFor('/equipment', { facility })} title="List every heater at this facility">
            {facility}
          </a>
        ) : (
          BLANK
        ),
      },
      ...(levels.length > 0
        ? [{ label: 'Hierarchy, top level first', value: <span className="text-200 text-muted-foreground">{levels.join('  ›  ')}</span> }]
        : []),
    ],
  };
  const classification: DetailGroup = {
    title: 'Classification',
    rows: [
      { label: 'Equipment class', value: orBlank(heater.equipClass) },
      { label: 'Class type', value: orBlank(heater.classType) },
      { label: 'Object type', value: orBlank(heater.objectType) },
      { label: 'FLOC class', value: orBlank(heater.flocClass) },
      { label: 'Technical object type', value: orBlank(heater.techObjectType) },
    ],
  };
  const business: DetailGroup = {
    title: 'Business',
    rows: [
      { label: 'Profit centre', value: orBlank(heater.profitCenterName) },
      { label: 'Planner group', value: orBlank(heater.plannerGroup) },
      { label: 'Equipment status', value: orBlank(heater.equipmentUserStatus) },
      { label: 'FLOC status', value: orBlank(heater.flocUserStatus) },
    ],
  };
  return { identity, location, classification, business };
}

function catalogueGroup(title: string, fields: readonly FieldRow[]): DetailGroup {
  return {
    title,
    rows: fields.map((f) => ({
      label: f.label,
      fieldCode: f.fieldCode,
      value: plate(f.current && f.unit ? `${f.current} ${f.unit}` : f.current),
    })),
  };
}

/** The two tables shown side by side, each a list of groups. Groups without rows are left out. */
function buildColumns(heater: HeaterDetail['heater'], levels: readonly string[], fields: readonly FieldRow[]): DetailGroup[][] {
  const { identity, location, classification, business } = summaryGroups(heater, levels);
  const keyFields = catalogueGroup('Key fields', fields.filter((f) => f.group === 'KEY'));
  const additionalDetails = catalogueGroup('Additional details', fields.filter((f) => f.group === 'ADDITIONAL'));
  return [
    [identity, location, keyFields],
    [classification, business, additionalDetails],
  ].map((groups) => groups.filter((g) => g.rows.length > 0));
}

interface RequestControls {
  /** Why a change to this field cannot be requested right now (the button's title), or null when it can. */
  requestBlock: (fieldCode: string) => string | null;
  onRequest: (fieldCode: string) => void;
}

function FieldsTables({ columns, ...request }: { columns: readonly (readonly DetailGroup[])[] } & RequestControls) {
  return (
    <section aria-labelledby="fields-title" className="space-y-300">
      <h2 id="fields-title" className="text-400 font-semibold">
        Fields
      </h2>
      <div className="grid items-start gap-300 md:grid-cols-2">
        {columns.map((groups) => (
          <FieldsTable key={groups.map((g) => g.title).join()} groups={groups} {...request} />
        ))}
      </div>
    </section>
  );
}

function FieldsTable({ groups, ...request }: { groups: readonly DetailGroup[] } & RequestControls) {
  return (
    <div className={`${card} overflow-hidden`}>
      <table className="w-full border-collapse text-250 leading-250">
        <caption className="sr-only">{groups.map((g) => g.title).join(', ')}</caption>
        <thead>
          <tr className="bg-muted text-left text-200 uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-400 py-200 font-semibold">Field</th>
            <th scope="col" className="px-400 py-200 font-semibold">Current value</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th scope="rowgroup" colSpan={2} className="bg-accent px-400 py-100 text-left text-200 font-semibold text-accent-foreground">
                {g.title}
              </th>
            </tr>
            {g.rows.map((row) => (
              <FieldLine key={row.fieldCode ?? row.label} row={row} {...request} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function FieldLine({ row, requestBlock, onRequest }: { row: DetailRow } & RequestControls) {
  const { fieldCode } = row;
  return (
    <tr className="border-t border-border align-top">
      <th scope="row" className="px-400 py-300 text-left font-medium">
        {row.label}
      </th>
      <td className="px-400 py-300">
        <div className="flex items-start justify-between gap-200">
          <span className="min-w-0 break-words">{row.value}</span>
          {fieldCode !== undefined ? (
            <button
              type="button"
              className={button.small}
              disabled={requestBlock(fieldCode) !== null}
              aria-label={`Request a change to ${row.label}`}
              title={requestBlock(fieldCode) ?? `Request a change to ${row.label}`}
              onClick={() => onRequest(fieldCode)}
            >
              <Pencil aria-hidden="true" className="icon-size-100" />
            </button>
          ) : null}
        </div>
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
