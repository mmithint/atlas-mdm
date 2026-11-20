/**
 * S-13 Admin in the client demo (`npm run dev:mock` only; FINAL PLAN/11 §6 S-13, §5 L6).
 *
 * Roles, groups, assignments and routes are the client's names from the committed seeds (`admin-seed.ts`);
 * members are the demo's "(sample)" people. User decisions of 20 Nov: adding or removing a member changes only
 * this page (route check included), not the queues or the bell; drop-down values and mandatory fields cover
 * field catalogue v1 only. A switched-off drop-down value disappears from S-6 and the change dialog, and a
 * mandatory field must be marked on S-6 before Review.
 */
import type { AdminData, FieldGovernanceRow, RouteCheckRow, RouteRow } from '@/features/admin/admin-types';

import { ASSIGNMENTS, GROUPS, ROLES, ROUTE_ROLES } from './admin-seed';
import { CATALOG, fieldOf } from './catalog';
import { demo, PROFIT_CENTRES } from './demo-store';
import { Refusal } from './refusal';

/** The route alias the seed uses for "the regional Operations-IOC group of the heater's profit centre". */
const REGIONAL_ALIAS = 'Operations-IOC - NMD';

/** The heater field-change route: EQUIPMENT UPDATE of every field, any class (FLOC UPDATE for FLOC fields). */
function routeFor(entity: 'EQUIPMENT' | 'FLOC'): RouteRow | undefined {
  return demo().admin.routes.find((r) => r.entityType === entity && r.requestAction === 'UPDATE' && r.field === '*' && r.classScope === 'ANY');
}

const inArea = (area: string, pc: string) => area === 'All ORCM' || area.split(',').some((a) => a.replace(/\(.*\)/, '').trim() === pc);

/** Which group holds a route stage in one profit centre. */
function groupFor(role: string, pc: string): string | null {
  const roleName = role === REGIONAL_ALIAS ? 'Operations-IOC' : role;
  const assigned = ASSIGNMENTS.find((a) => a.roleName === roleName && inArea(a.area, pc));
  if (assigned) return assigned.groupKey;
  return GROUPS.includes(roleName) && roleName !== 'Operations-IOC' ? roleName : null;
}

function routeCheck(): RouteCheckRow[] {
  const route = routeFor('EQUIPMENT');
  const count = (g: string | null) => (g ? (demo().admin.members[g] ?? []).length : 0);
  return PROFIT_CENTRES.map((pc) => {
    const responsibleGroup = route ? groupFor(route.responsibleRole, pc) : null;
    const accountableGroup = route ? groupFor(route.accountableRole, pc) : null;
    const responsibleMembers = count(responsibleGroup);
    const accountableMembers = count(accountableGroup);
    const status: RouteCheckRow['status'] =
      !responsibleGroup || !accountableGroup || responsibleMembers === 0 || accountableMembers === 0 ? 'UNROUTED' : responsibleMembers < 2 || accountableMembers < 2 ? 'FEW_MEMBERS' : 'OK';
    return { profitCenter: pc, responsibleGroup, responsibleMembers, accountableGroup, accountableMembers, status };
  });
}

export function adminData(): AdminData {
  const a = demo().admin;
  const fieldGovernance: FieldGovernanceRow[] = CATALOG.map((c) => {
    const r = routeFor(c.entityType);
    return { fieldCode: c.fieldCode, label: c.label, routeId: r?.routeId ?? null, responsibleRole: r?.responsibleRole ?? null, accountableRole: r?.accountableRole ?? null };
  });
  return {
    roles: ROLES.map((r) => ({ ...r })),
    groups: GROUPS.map((g) => ({ groupKey: g, members: [...(a.members[g] ?? [])], roles: ASSIGNMENTS.filter((x) => x.groupKey === g).map(({ roleName, area }) => ({ roleName, area })) })),
    routes: a.routes.map((r) => ({ ...r, classes: [...r.classes] })),
    routeRoles: [...ROUTE_ROLES],
    fieldGovernance,
    dropdownFields: CATALOG.filter((c) => c.allowedValuesSource === 'LIST').map((c) => ({ fieldCode: c.fieldCode, label: c.label })),
    dropdowns: a.dropdowns.map((d) => ({ ...d })),
    mandatory: CATALOG.map((c) => ({ fieldCode: c.fieldCode, label: c.label, mandatory: a.mandatory.includes(c.fieldCode) })),
    routeCheck: routeCheck(),
    notice: 'Roles, groups, areas and routes are the client\'s own names (seeds 0101-0104). Members are sample people. In the demo, member changes stay on this page; they do not move requests or notifications.',
  };
}

export function addMember(groupKey: string, displayName: string, email: string): void {
  if (!GROUPS.includes(groupKey)) throw new Refusal('There is no such group.', 51301);
  const name = displayName.trim();
  const mail = email.trim().toLowerCase();
  if (!name) throw new Refusal('Type the person\'s name.', 51302);
  if (!/^[^@\s]+@example\.test$/.test(mail)) throw new Refusal('In the demo only sample addresses ending in @example.test are allowed.', 51303);
  const list = (demo().admin.members[groupKey] ??= []);
  if (list.some((m) => m.email === mail)) throw new Refusal(`${mail} is already in ${groupKey}.`, 51304);
  list.push({ email: mail, displayName: name.endsWith('(sample)') ? name : `${name} (sample)` });
}

export function removeMember(groupKey: string, email: string): void {
  const list = demo().admin.members[groupKey] ?? [];
  const i = list.findIndex((m) => m.email === email);
  if (i < 0) throw new Refusal('That person is not in the group.', 51305);
  list.splice(i, 1);
}

export function setRoute(routeId: number, responsibleRole: string, accountableRole: string): void {
  const r = demo().admin.routes.find((x) => x.routeId === routeId);
  if (!r) throw new Refusal('There is no such route.', 51306);
  if (!ROUTE_ROLES.includes(responsibleRole) || !ROUTE_ROLES.includes(accountableRole)) throw new Refusal('Pick a role that may approve.', 51307);
  if (responsibleRole === accountableRole) throw new Refusal('The two stages need different roles (two-stage approval).', 51308);
  r.responsibleRole = responsibleRole;
  r.accountableRole = accountableRole;
}

export function setDropdown(fieldCode: string, value: string, active: boolean): void {
  const field = fieldOf(fieldCode);
  if (!field || field.allowedValuesSource !== 'LIST') throw new Refusal('This field has no drop-down list.', 51309);
  const v = value.trim().toUpperCase();
  if (!v) throw new Refusal('Type a value.', 51310);
  if (field.maxLength !== null && v.length > field.maxLength) throw new Refusal(`At most ${field.maxLength} characters.`, 51311);
  const list = demo().admin.dropdowns;
  const row = list.find((d) => d.fieldCode === fieldCode && d.value === v);
  if (row) {
    if (!active && list.filter((d) => d.fieldCode === fieldCode && d.active).length === 1 && row.active) throw new Refusal('Keep at least one value switched on.', 51312);
    row.active = active;
    return;
  }
  const order = Math.max(0, ...list.filter((d) => d.fieldCode === fieldCode).map((d) => d.order)) + 1;
  list.push({ fieldCode, value: v, order, active: true });
}

export function setMandatory(fieldCode: string, mandatory: boolean): void {
  if (!fieldOf(fieldCode)) throw new Refusal('There is no such field.', 51313);
  const a = demo().admin;
  a.mandatory = mandatory ? [...new Set([...a.mandatory, fieldCode])] : a.mandatory.filter((c) => c !== fieldCode);
}
