/**
 * What the Admin page (S-13) reads and sends. Columns follow `FINAL PLAN/09` (`app.role`, `app.security_group`,
 * `app.role_assignment`, `app.approval_route`, `app.field_allowed_value`, `app.app_setting`). These are the
 * shapes the APP-D preview uses (FINAL PLAN/11); APP-9 builds the functions and may adjust them.
 */

/** The ten permission flags of `app.role`, in the order of the client's workbook (REF-46 "Role Definitions"). */
export const PERMISSIONS = [
  { key: 'canView', label: 'View' },
  { key: 'canSubmitRequests', label: 'Submit requests' },
  { key: 'canRequestEditBusinessRules', label: 'Edit business rules' },
  { key: 'canPublishBusinessRules', label: 'Publish business rules' },
  { key: 'canRequestEditEvidenceGuidance', label: 'Edit evidence guidance' },
  { key: 'canPublishEvidenceGuidance', label: 'Publish evidence guidance' },
  { key: 'canResponsibleApprove', label: 'Responsible approve' },
  { key: 'canAccountableApprove', label: 'Accountable approve' },
  { key: 'canManageAdmin', label: 'Manage admin' },
  { key: 'isActive', label: 'Active' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export type RoleRow = { roleName: string; description: string } & Record<PermissionKey, boolean>;

export interface Member {
  email: string;
  displayName: string;
}

/** A security group, its members, and the roles it holds with their areas (profit centres). */
export interface GroupRow {
  groupKey: string;
  members: Member[];
  roles: { roleName: string; area: string }[];
}

export interface RouteRow {
  routeId: number;
  entityType: 'EQUIPMENT' | 'FLOC';
  requestAction: 'CREATE' | 'UPDATE';
  /** `*` = every field. */
  field: string;
  /** ANY, or LIST with the classes it applies to. */
  classScope: 'ANY' | 'LIST';
  classes: string[];
  responsibleRole: string;
  accountableRole: string;
}

/** Who owns a catalogue field: the route a heater change of that field takes. */
export interface FieldGovernanceRow {
  fieldCode: string;
  label: string;
  routeId: number | null;
  responsibleRole: string | null;
  accountableRole: string | null;
}

export interface DropdownRow {
  fieldCode: string;
  value: string;
  order: number;
  active: boolean;
}

export interface MandatoryRow {
  fieldCode: string;
  label: string;
  mandatory: boolean;
}

/** One line of the route check: a heater field change in one profit centre, and who would get it. */
export interface RouteCheckRow {
  profitCenter: string;
  responsibleGroup: string | null;
  responsibleMembers: number;
  accountableGroup: string | null;
  accountableMembers: number;
  /** FEW_MEMBERS = fewer than two (nobody covers an absence); UNROUTED = no group at a stage. */
  status: 'OK' | 'FEW_MEMBERS' | 'UNROUTED';
}

export interface AdminData {
  roles: RoleRow[];
  groups: GroupRow[];
  routes: RouteRow[];
  routeRoles: string[];
  fieldGovernance: FieldGovernanceRow[];
  dropdownFields: { fieldCode: string; label: string }[];
  dropdowns: DropdownRow[];
  mandatory: MandatoryRow[];
  routeCheck: RouteCheckRow[];
  notice: string;
}
