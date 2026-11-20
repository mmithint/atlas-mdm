import clsx from 'clsx';
import { Check, Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { HEAD_ROW, PageHeader, Panel, Pill, ROW, TABLE, TD, TH, Tabs } from '@/components/layout';
import { ErrorState, LoadingState } from '@/components/states';
import { button, input, inputCompact } from '@/components/ui';
import { useLoad } from '@/hooks/use-load';
import { errorText } from '@/lib/act-answer';

import { addMember, fetchAdminData, removeMember, setDropdownValue, setMandatory, setRoute } from './admin-api';
import { PERMISSIONS, type AdminData, type GroupRow, type RouteCheckRow, type RouteRow } from './admin-types';

type TabId = 'users' | 'roles' | 'governance' | 'dropdowns' | 'mandatory' | 'check';

/** Runs one admin change, then reloads the page data; a refusal is shown in the tab. */
type Act = (change: () => Promise<unknown>) => Promise<boolean>;

/**
 * S-13 Admin (APP-9; `guide/app/S-13` §2), admins only: user roles, role definitions, field governance,
 * drop-down values, mandatory fields and the route check. Names come from the client's seeds; members are
 * sample people.
 */
export function Admin() {
  const [reload, setReload] = useState(0);
  const load = useLoad(`admin|${reload}`, fetchAdminData);
  const [tab, setTab] = useState<TabId>('users');
  const [error, setError] = useState<string | null>(null);

  const act: Act = async (change) => {
    setError(null);
    try {
      await change();
      setReload((n) => n + 1);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };

  return (
    <div className="space-y-400">
      <PageHeader title="Admin" subtitle="Who may do what, who approves which field, the drop-down values and the mandatory fields. Only admins see this page." />
      {load.status === 'loading' ? <LoadingState rows={6} label="Loading the admin settings" /> : null}
      {load.status === 'error' ? <ErrorState message={load.message} onRetry={load.retry} /> : null}
      {load.status === 'ready' ? (
        <>
          <p className="rounded-md border border-dashed border-border px-300 py-200 text-200 text-muted-foreground">{load.data.notice}</p>
          {error ? (
            <p role="alert" className="text-300 text-destructive">
              {error}
            </p>
          ) : null}
          {/* <Tabs<TabId>
            label="Admin"
            active={tab}
            onChange={(t) => {
              setTab(t);
              setError(null);
            }}
            tabs={[
              { id: 'users', label: 'User roles' },
              { id: 'roles', label: 'Role definitions' },
              { id: 'governance', label: 'Field governance' },
              { id: 'dropdowns', label: 'Drop-down values' },
              { id: 'mandatory', label: 'Mandatory fields' },
              { id: 'check', label: `Route check${load.data.routeCheck.some((r) => r.status !== 'OK') ? ' ⚠' : ''}` },
            ]}
          >
            {tab === 'users' ? <UsersTab data={load.data} act={act} /> : null}
            {tab === 'roles' ? <RolesTab data={load.data} /> : null}
            {tab === 'governance' ? <GovernanceTab data={load.data} act={act} /> : null}
            {tab === 'dropdowns' ? <DropdownsTab data={load.data} act={act} /> : null}
            {tab === 'mandatory' ? <MandatoryTab data={load.data} act={act} /> : null}
            {tab === 'check' ? <RouteCheckTab rows={load.data.routeCheck} /> : null}
          </Tabs> */}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- user roles

function UsersTab({ data, act }: { data: AdminData; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th className={TH}>Group</th>
            <th className={TH}>Members</th>
            <th className={TH}>Roles and areas</th>
            <th className={TH}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <GroupLine key={g.groupKey} group={g} act={act} open={open === g.groupKey} onToggle={() => setOpen(open === g.groupKey ? null : g.groupKey)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupLine({ group, act, open, onToggle }: { group: GroupRow; act: Act; open: boolean; onToggle: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const few = group.members.length < 2;
  return (
    <>
      <tr className={clsx(ROW, few && 'bg-warning/30')}>
        <td className={clsx(TD, 'font-mono')}>{group.groupKey}</td>
        <td className={TD}>
          <Pill tone={few ? 'warning' : 'neutral'} title={few ? 'Fewer than two members: nobody covers an absence' : undefined}>
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </Pill>
          <ul className="mt-100 space-y-100">
            {group.members.map((m) => (
              <li key={m.email} className="flex items-center gap-200">
                <span>{m.displayName}</span>
                <button type="button" className={button.small} aria-label={`Remove ${m.displayName} from ${group.groupKey}`} onClick={() => void act(() => removeMember(group.groupKey, m.email))}>
                  <Trash2 aria-hidden="true" className="icon-size-100" />
                </button>
              </li>
            ))}
          </ul>
        </td>
        <td className={TD}>
          {group.roles.length === 0 ? (
            <span className="text-muted-foreground">No role assigned yet</span>
          ) : (
            <ul className="space-y-100">
              {group.roles.map((r, i) => (
                <li key={i}>
                  <span className="font-medium">{r.roleName}</span> <span className="text-muted-foreground">· {r.area}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className={TD}>
          <button type="button" className={button.small} onClick={onToggle} aria-expanded={open}>
            <Plus aria-hidden="true" className="icon-size-100" />
            Add member
          </button>
        </td>
      </tr>
      {open ? (
        <tr className={ROW}>
          <td className={TD} colSpan={4}>
            <form
              className="flex flex-wrap items-end gap-200"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() => addMember(group.groupKey, name, email)).then((ok) => {
                  if (ok) {
                    setName('');
                    setEmail('');
                    onToggle();
                  }
                });
              }}
            >
              <label className="text-200">
                <span className="text-muted-foreground">Name</span>
                <input className={inputCompact} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="text-200">
                <span className="text-muted-foreground">E-mail (sample, @example.test)</span>
                <input className={inputCompact} value={email} placeholder="name@example.test" onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button type="submit" className={button.small}>
                Add to {group.groupKey}
              </button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- role definitions

function RolesTab({ data }: { data: AdminData }) {
  return (
    <div className="space-y-200">
      <p className="text-200 text-muted-foreground">
        {data.roles.length} roles × {PERMISSIONS.length} permissions, as in the client&apos;s workbook (REF-46). Read only: a change goes through the seed.
      </p>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className={HEAD_ROW}>
              <th className={TH}>Role</th>
              {PERMISSIONS.map((p) => (
                <th key={p.key} className={clsx(TH, 'text-center')}>
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.roles.map((r) => (
              <tr key={r.roleName} className={ROW}>
                <td className={TD}>
                  <span className="font-mono font-medium">{r.roleName}</span>
                  <span className="block max-w-xs whitespace-normal text-200 text-muted-foreground">{r.description}</span>
                </td>
                {PERMISSIONS.map((p) => (
                  <td key={p.key} className={clsx(TD, 'text-center')}>
                    {r[p.key] ? <Check aria-label="yes" className="icon-size-200 mx-auto text-success-foreground" /> : <Minus aria-label="no" className="icon-size-200 mx-auto text-muted-foreground" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- field governance

function GovernanceTab({ data, act }: { data: AdminData; act: Act }) {
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div className="space-y-400">
      <Panel title="Who approves each field" hint="A heater change follows the EQUIPMENT (or FLOC) UPDATE route for every field. Operations-IOC - NMD means the regional Operations-IOC group of the heater's profit centre.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className={HEAD_ROW}>
                <th className={TH}>Field</th>
                <th className={TH}>Route</th>
                <th className={TH}>Responsible (stage 1)</th>
                <th className={TH}>Accountable (stage 2)</th>
              </tr>
            </thead>
            <tbody>
              {data.fieldGovernance.map((f) => (
                <tr key={f.fieldCode} className={ROW}>
                  <td className={TD}>{f.label}</td>
                  <td className={clsx(TD, 'font-mono')}>{f.routeId ?? '—'}</td>
                  <td className={TD}>{f.responsibleRole ?? <Pill tone="warning">UNROUTED</Pill>}</td>
                  <td className={TD}>{f.accountableRole ?? <Pill tone="warning">UNROUTED</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Approval routes" hint="From seed 0103. Edit changes the two roles of a route.">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr className={HEAD_ROW}>
                <th className={TH}>#</th>
                <th className={TH}>Object</th>
                <th className={TH}>Action</th>
                <th className={TH}>Field</th>
                <th className={TH}>Classes</th>
                <th className={TH}>Responsible</th>
                <th className={TH}>Accountable</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r) =>
                editing === r.routeId ? (
                  <RouteEditor key={r.routeId} route={r} roles={data.routeRoles} act={act} onClose={() => setEditing(null)} />
                ) : (
                  <tr key={r.routeId} className={ROW}>
                    <td className={TD}>{r.routeId}</td>
                    <td className={TD}>{r.entityType}</td>
                    <td className={TD}>{r.requestAction}</td>
                    <td className={clsx(TD, 'font-mono')}>{r.field}</td>
                    <td className={clsx(TD, 'max-w-xs whitespace-normal')}>{r.classScope === 'ANY' ? 'Any' : r.classes.join(', ')}</td>
                    <td className={TD}>{r.responsibleRole}</td>
                    <td className={TD}>{r.accountableRole}</td>
                    <td className={TD}>
                      <button type="button" className={button.small} onClick={() => setEditing(r.routeId)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function RouteEditor({ route, roles, act, onClose }: { route: RouteRow; roles: string[]; act: Act; onClose: () => void }) {
  const [responsible, setResponsible] = useState(route.responsibleRole);
  const [accountable, setAccountable] = useState(route.accountableRole);
  const pick = (label: string, value: string, onChange: (v: string) => void) => (
    <select aria-label={label} className={inputCompact} value={value} onChange={(e) => onChange(e.target.value)}>
      {roles.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
  return (
    <tr className={clsx(ROW, 'bg-muted')}>
      <td className={TD}>{route.routeId}</td>
      <td className={TD}>{route.entityType}</td>
      <td className={TD}>{route.requestAction}</td>
      <td className={clsx(TD, 'font-mono')}>{route.field}</td>
      <td className={TD}>{route.classScope === 'ANY' ? 'Any' : 'List'}</td>
      <td className={TD}>{pick(`Route ${route.routeId} responsible role`, responsible, setResponsible)}</td>
      <td className={TD}>{pick(`Route ${route.routeId} accountable role`, accountable, setAccountable)}</td>
      <td className={clsx(TD, 'space-x-100 whitespace-nowrap')}>
        <button type="button" className={button.small} onClick={() => void act(() => setRoute(route.routeId, responsible, accountable)).then((ok) => ok && onClose())}>
          Save
        </button>
        <button type="button" className={button.small} onClick={onClose}>
          Cancel
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------- drop-down values

function DropdownsTab({ data, act }: { data: AdminData; act: Act }) {
  const [fieldCode, setFieldCode] = useState(data.dropdownFields[0]?.fieldCode ?? '');
  const [value, setValue] = useState('');
  const rows = data.dropdowns.filter((d) => d.fieldCode === fieldCode).sort((a, b) => a.order - b.order);
  return (
    <Panel title="Drop-down values" hint="Field catalogue v1 fields with a list. A value switched off disappears from the Field view and the change dialog; values already stored stay.">
      <div className="space-y-300">
        <label className="block max-w-sm text-200">
          <span className="text-muted-foreground">Field</span>
          <select className={input} value={fieldCode} onChange={(e) => setFieldCode(e.target.value)}>
            {data.dropdownFields.map((f) => (
              <option key={f.fieldCode} value={f.fieldCode}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((d) => (
            <li key={d.value} className="flex items-center justify-between gap-200 px-300 py-200">
              <span className={clsx('font-mono', !d.active && 'text-muted-foreground line-through')}>{d.value}</span>
              <label className="flex items-center gap-200 text-200">
                <input type="checkbox" checked={d.active} onChange={(e) => void act(() => setDropdownValue(fieldCode, d.value, e.target.checked))} />
                {d.active ? 'On' : 'Off'}
              </label>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-200"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => setDropdownValue(fieldCode, value, true)).then((ok) => ok && setValue(''));
          }}
        >
          <label className="text-200">
            <span className="text-muted-foreground">New value</span>
            <input className={inputCompact} value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button type="submit" className={button.small} disabled={!value.trim()}>
            <Plus aria-hidden="true" className="icon-size-100" />
            Add value
          </button>
        </form>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- mandatory fields

function MandatoryTab({ data, act }: { data: AdminData; act: Act }) {
  return (
    <Panel title="Mandatory fields" hint="A mandatory field must be marked (verified, corrected or did not verify) on the Field view before Review.">
      <ul className="divide-y divide-border rounded-md border border-border">
        {data.mandatory.map((m) => (
          <li key={m.fieldCode} className="flex items-center justify-between gap-200 px-300 py-200">
            <span>{m.label}</span>
            <label className="flex items-center gap-200 text-200">
              <input type="checkbox" role="switch" aria-label={`${m.label} mandatory`} checked={m.mandatory} onChange={(e) => void act(() => setMandatory(m.fieldCode, e.target.checked))} />
              {m.mandatory ? 'Mandatory' : 'Optional'}
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------- route check

const STATUS: Record<RouteCheckRow['status'], { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  OK: { tone: 'success', text: 'OK' },
  FEW_MEMBERS: { tone: 'warning', text: 'Fewer than two members' },
  UNROUTED: { tone: 'danger', text: 'UNROUTED' },
};

function RouteCheckTab({ rows }: { rows: RouteCheckRow[] }) {
  const flagged = rows.filter((r) => r.status !== 'OK').length;
  return (
    <Panel title="Route check" hint={`A heater field change in each profit centre: which group gets each stage, and how many members it has. ${flagged} of ${rows.length} flagged.`}>
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr className={HEAD_ROW}>
              <th className={TH}>Profit centre</th>
              <th className={TH}>Responsible group</th>
              <th className={TH}>Members</th>
              <th className={TH}>Accountable group</th>
              <th className={TH}>Members</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.profitCenter} className={ROW}>
                <td className={clsx(TD, 'font-mono')}>{r.profitCenter}</td>
                <td className={TD}>{r.responsibleGroup ?? '—'}</td>
                <td className={TD}>{r.responsibleMembers}</td>
                <td className={TD}>{r.accountableGroup ?? '—'}</td>
                <td className={TD}>{r.accountableMembers}</td>
                <td className={TD}>
                  <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
