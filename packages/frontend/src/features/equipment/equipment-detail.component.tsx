import { Briefcase, Fingerprint, Key, LayoutGrid, List, ListPlus, MapPin, Pencil, Tags } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { useProfile } from '@/app/profile.context';
import { hrefFor } from '@/app/router';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { badge, button, card, identifierBadge } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { BLANK, formatUtc, orBlank } from '@/lib/format';

import { fetchFormOptions } from './change-request-api';
import { buildFieldRows, flocLevels, type FieldRow } from './detail-model';
import { fetchHeater, type HeaterDetail } from './equipment-api';
import { EquipmentRequests } from './equipment-requests.component';
import { RequestDialog } from './request-dialog.component';
import { buildFieldChoices, submitBlockReason, type AccessInput } from './request-dialog-model';

/**
 * S-5 Equipment detail (POC-APP-06): the golden record of one heater and the change requests
 * associated with it. Reading changes nothing; "Request change" (APP-4) opens a dialog whose
 * submit goes through the request function and procedure.
 */
export function EquipmentDetail({ idText }: { idText: string }) {
  const valid = /^\d+$/.test(idText);
  const equipmentId = valid ? Number(idText) : -1;
  const state = useLoad(`heater:${equipmentId}`, () => (valid ? fetchHeater(equipmentId) : Promise.resolve(null)));

  return (
    <div className="space-y-400">
      {state.status === 'loading' ? <LoadingState rows={6} label="Loading the equipment record" /> : null}
      {state.status === 'error' ? (
        <ErrorState title="The equipment record could not be loaded" message={state.message} onRetry={state.retry} />
      ) : null}
      {state.status === 'ready' && state.data === null ? (
        <EmptyState
          title="Equipment not found"
          hint={`There is no equipment record with the id "${idText}". It may have been removed, or the link is wrong.`}
          action={
            <a className={button.secondary} href={hrefFor('/equipment')}>
              Back to equipment
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
      <header className={`${card} overflow-hidden`}>
        <div className="flex flex-col gap-300 p-400 sm:px-600 sm:pb-300 sm:pt-400 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-100">
            <p className="text-200 font-semibold uppercase tracking-wide text-muted-foreground">Equipment record</p>
            <div className="flex flex-wrap items-center gap-200">
              <h1 className="min-w-0 break-words text-600 font-semibold leading-600">{title}</h1>
              {heater.equipmentUserStatus ? <span className={badge.neutral}>{heater.equipmentUserStatus}</span> : null}
            </div>
            {heater.equipmentDescription ? (
              <p className="max-w-3xl text-300 leading-300 text-muted-foreground">{heater.equipmentDescription}</p>
            ) : null}
          </div>

          <button
            type="button"
            className={`${button.primary} w-full shrink-0 lg:w-auto`}
            disabled={blockReason !== null}
            title={blockReason ?? 'Propose an update to any editable field.'}
            onClick={() => setDialog({ fieldCode: null })}
          >
            <Pencil aria-hidden="true" className="icon-size-200" />
            Request change
          </button>
        </div>

        <dl className="grid gap-x-600 gap-y-300 px-400 pb-300 sm:grid-cols-2 sm:px-600 lg:grid-cols-3">
          <RecordFact label="Equipment number" value={tag(heater.equipmentNumber)} />
          <RecordFact label="Functional location" value={plate(heater.functionalLocation)} />
          <RecordFact label="Facility" value={plate(heater.superiorFunctionalLocation)} />
        </dl>

        <dl className="grid gap-300 px-400 pb-400 pt-200 text-200 text-muted-foreground sm:grid-cols-3 sm:px-600">
          <RecordMeta label="Golden record" value={heater.goldenVersionId ? `Version ${heater.goldenVersionId}` : BLANK} />
          <RecordMeta label="Last approved change" value={heater.lastChangedAtUtc ? formatUtc(heater.lastChangedAtUtc) : 'No approved changes yet'} />
          <RecordMeta label="SAP baseline" value={formatUtc(heater.baselineAsOfUtc)} />
        </dl>
      </header>

      <FieldsGroups
        columns={columns}
        requestBlock={(code) => blockReason ?? choiceByCode.get(code)?.unavailableReason ?? null}
        onRequest={(code) => setDialog({ fieldCode: code })}
      />
      {fields.length === 0 ? (
        <EmptyState title="No catalogue fields configured" hint="No additional catalogue fields are available for this equipment record." />
      ) : null}

      <EquipmentRequests equipmentId={heater.equipmentId} reloadKey={requestsReload} />

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

/** One field-value pair in a detail group. */
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
const tag = (value: string | null | undefined): ReactNode => (value ? <span className={identifierBadge}>{value}</span> : BLANK);

function RecordFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-200 font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-100 min-w-0 break-words text-300 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function RecordMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-100">
      <dt>{label}:</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function summaryGroups(heater: HeaterDetail['heater'], levels: readonly string[]) {
  const facility = heater.superiorFunctionalLocation;
  const identity: DetailGroup = {
    title: 'Identity',
    rows: [
      { label: 'Equipment number', value: tag(heater.equipmentNumber) },
      { label: 'Engineering tag', value: tag(heater.equipmentTagNumber) },
      { label: 'Serial number', value: tag(heater.manufacturerSerialNumber) },
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
          <a className="id-plate underline-offset-2 hover:underline" href={hrefFor('/equipment', { facility })} title="List every heater at this facility">
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

/** The two responsive columns of field groups. Groups without rows are left out. */
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

function FieldsGroups({ columns, ...request }: { columns: readonly (readonly DetailGroup[])[] } & RequestControls) {
  const [layout, setLayout] = useState<'list' | 'cards'>('cards');
  const scanGroups = useMemo(() => columns.flat(), [columns]);

  return (
    <section aria-labelledby="fields-title" className="space-y-300">
      <div className="flex flex-wrap items-start justify-between gap-300">
        <div>
          <h2 id="fields-title" className="text-400 font-semibold">
            Equipment information
          </h2>
          <p className="mt-100 text-200 text-muted-foreground">Review the current record in the layout that works best for you.</p>
        </div>

        <div
          role="group"
          aria-label="Equipment information layout"
          className="inline-flex rounded-lg border border-border bg-muted p-100"
        >
          <button
            type="button"
            aria-label="Card view"
            aria-pressed={layout === 'cards'}
            className={`inline-flex h-700 items-center gap-100 rounded-md px-200 text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              layout === 'cards' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
            }`}
            onClick={() => setLayout('cards')}
          >
            <LayoutGrid aria-hidden="true" className="icon-size-100" />
            Cards
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={layout === 'list'}
            className={`inline-flex h-700 items-center gap-100 rounded-md px-200 text-200 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              layout === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
            }`}
            onClick={() => setLayout('list')}
          >
            <List aria-hidden="true" className="icon-size-100" />
            List
          </button>
        </div>
      </div>

      {layout === 'list' ? (
        <div className="grid items-start gap-300 lg:grid-cols-2">
          {columns.map((groups, columnIndex) => (
            <div key={columnIndex} className="space-y-300">
              {groups.map((group) => (
                <FieldGroup key={group.title} group={group} {...request} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-300">
          {scanGroups.map((group) => (
            <ScanGroup key={group.title} group={group} {...request} />
          ))}
        </div>
      )}
    </section>
  );
}

function FieldGroup({ group, ...request }: { group: DetailGroup } & RequestControls) {
  const headingId = `field-group-${group.title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className={`${card} overflow-hidden`}>
      <div className="flex items-center justify-between gap-200 border-b border-border bg-muted px-400 py-300">
        <h3 id={headingId} className="text-300 font-semibold">{group.title}</h3>
        <span className={badge.neutral}>{group.rows.length}</span>
      </div>
      <dl className="divide-y divide-divider">
        {group.rows.map((row) => (
          <FieldLine key={row.fieldCode ?? row.label} row={row} {...request} />
        ))}
      </dl>
    </section>
  );
}

function FieldLine({ row, requestBlock, onRequest }: { row: DetailRow } & RequestControls) {
  const { fieldCode } = row;
  const block = fieldCode === undefined ? null : requestBlock(fieldCode);
  return (
    <div className="grid gap-200 px-400 py-300 transition-colors hover:bg-hover sm:grid-cols-2 sm:items-start">
      <dt className="text-250 font-medium leading-250 text-muted-foreground">{row.label}</dt>
      <dd className="flex min-w-0 items-center justify-between gap-200 text-300 leading-300 text-foreground">
        <span className="min-w-0 break-words">{row.value}</span>
        {fieldCode !== undefined ? (
          <button
            type="button"
            className={`${button.small} shrink-0`}
            disabled={block !== null}
            aria-label={`Request a change to ${row.label}`}
            title={block ?? `Request a change to ${row.label}`}
            onClick={() => onRequest(fieldCode)}
          >
            <Pencil aria-hidden="true" className="icon-size-100" />
            Change
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function groupIcon(title: string): ReactNode {
  const iconClass = 'icon-size-200';
  switch (title) {
    case 'Identity':
      return <Fingerprint aria-hidden="true" className={iconClass} />;
    case 'Location':
      return <MapPin aria-hidden="true" className={iconClass} />;
    case 'Key fields':
      return <Key aria-hidden="true" className={iconClass} />;
    case 'Classification':
      return <Tags aria-hidden="true" className={iconClass} />;
    case 'Business':
      return <Briefcase aria-hidden="true" className={iconClass} />;
    default:
      return <ListPlus aria-hidden="true" className={iconClass} />;
  }
}

function ScanGroup({ group, ...request }: { group: DetailGroup } & RequestControls) {
  const headingId = `scan-field-group-${group.title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={headingId} className={`${card} overflow-hidden`}>
      <div className="flex items-center gap-200 border-b border-border px-400 py-300">
        <span className="flex h-700 w-700 shrink-0 items-center justify-center rounded-lg bg-info text-info-foreground">
          {groupIcon(group.title)}
        </span>
        <h3 id={headingId} className="text-300 font-semibold">{group.title}</h3>
      </div>
      <dl className="grid gap-x-600 gap-y-400 px-500 py-500 sm:grid-cols-2 lg:grid-cols-4">
        {group.rows.map((row) => (
          <ScanField key={row.fieldCode ?? row.label} row={row} {...request} />
        ))}
      </dl>
    </section>
  );
}

function ScanField({ row, requestBlock, onRequest }: { row: DetailRow } & RequestControls) {
  const { fieldCode } = row;
  const block = fieldCode === undefined ? null : requestBlock(fieldCode);
  return (
    <div className="min-w-0">
      <dt className="text-200 font-semibold leading-200 text-muted-foreground">{row.label}</dt>
      <dd className="mt-200 flex min-w-0 items-center gap-100 text-300 leading-300 text-foreground">
        <span className="min-w-0 break-words">{row.value}</span>
        {fieldCode !== undefined ? (
          <button
            type="button"
            className="inline-flex h-700 w-700 shrink-0 items-center justify-center rounded-lg border border-transparent text-brand-foreground transition-colors hover:border-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-disabled-foreground"
            disabled={block !== null}
            aria-label={`Request a change to ${row.label}`}
            title={block ?? `Request a change to ${row.label}`}
            onClick={() => onRequest(fieldCode)}
          >
            <Pencil aria-hidden="true" className="icon-size-100" />
          </button>
        ) : null}
      </dd>
    </div>
  );
}
