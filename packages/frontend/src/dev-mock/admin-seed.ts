/**
 * The client's security and routing metadata for the Admin page in the demo (`npm run dev:mock` only), copied
 * from the committed seeds: roles `db/seed/0101_roles.sql` [REF-46:L0191-L0207], groups `0102_groups.sql`
 * [REF-46:L0285-L0303], role assignments `0104_assignments.sql`, routes `0103_routes.sql`. Names and flags only;
 * no person.
 */
import type { RoleRow, RouteRow } from '@/features/admin/admin-types';

/** `flags` = the ten permission bits in the order of `PERMISSIONS`. */
const role = (roleName: string, description: string, flags: string): RoleRow => {
  const b = flags.split('').map((c) => c === '1');
  return {
    roleName,
    description,
    canView: b[0],
    canSubmitRequests: b[1],
    canRequestEditBusinessRules: b[2],
    canPublishBusinessRules: b[3],
    canRequestEditEvidenceGuidance: b[4],
    canPublishEvidenceGuidance: b[5],
    canResponsibleApprove: b[6],
    canAccountableApprove: b[7],
    canManageAdmin: b[8],
    isActive: b[9],
  };
};

/** Descriptions as in the client's workbook, spelling kept. */
export const ROLES: readonly RoleRow[] = [
  role('Admin', 'Application Owners  with full security access to do anything within the app', '1111111111'),
  role('SAPBusinessSupport', 'SAP Business support team with final approval for any equipment creation and floc creation', '1111101101'),
  role('ReliabilityandMaintenance', 'Rotating equipment team with approval for all rotating equipment data', '1110001101'),
  role('AirQuality', 'Accountable for all air / reporting data', '1110001101'),
  role('HSESDS', 'Accountable for all data required for integration with HSE and sustainability systems', '1110001101'),
  role('Enviromental', 'Accountable for all environmental compliance fields', '1110001101'),
  role('Operations-IOC', 'Responsible for providing key ties of equipment data in the field to sap and assigning call outs for physical field verificaitons', '1110001101'),
  role('Operations-PT', 'responsible for physical field verifications', '1100000001'),
  role('Engineering_Central', 'Responsible for adding new equipment associated with new projects', '1110000001'),
  role('Engineering_Asset', 'Similar to Operations IOC with more access to engineering related fields', '1110001101'),
  role('Construction', 'Responsible for field verificaiton when new equipment lands on site and / or is removed from site', '1100000001'),
  role('SCM', 'Responsible for proactively managing inventory through lifecycle of equipment', '1110001001'),
  role('GeneralViewer', 'All OXY Users', '1100000001'),
  role('DataQualityOwner', 'Able to create business rules around data quality', '1110100001'),
  role('Approval_EvidenceOwner', 'Able to add evidence to data fields for approvers', '1100110001'),
  role('AssetIntegrity', 'PSV record access; Responsible and Accountable for PSV changes; Responsible for PSV creation', '1100001101'),
];

export const GROUPS: readonly string[] = [
  'SAPBusinessSupport',
  'ReliabilityandMaintenance',
  'AirQuality',
  'HSESDS',
  'Enviromental',
  'Operations-IOC',
  'Operations-PT',
  'Engineering_Central',
  'Engineering_Asset',
  'Construction',
  'SCM',
  'GeneralViewer',
  'DataQualityOwner',
  'Approval_EvidenceOwner',
  'AssetIntegrity',
  'Operations-IOC-Carlsbad',
  'Operations-IOC-Midland',
  'Operations-IOC-DenverCity',
  'Operations-IOC-Platteville',
];

const RES = 'OP RES MB, OP RES DB TX, OP RES MB CROWNROCK, OP RES DB NM';
const EOR = 'OP EOR GAS PLANT, OP EOR, OP EOR CO2 OPS';
const RK = 'ROCKIES-DJ BASIN, ROCKIES-OTHER, ROCKIES-PRB';

/** Group → role → area, from seed 0104 (the three AirQuality sub-groups are shown under AirQuality). */
export const ASSIGNMENTS: readonly { groupKey: string; roleName: string; area: string }[] = [
  { groupKey: 'HSESDS', roleName: 'HSESDS', area: 'All ORCM' },
  { groupKey: 'AirQuality', roleName: 'AirQuality', area: `${RES} (AirQuality - RES)` },
  { groupKey: 'AirQuality', roleName: 'AirQuality', area: `${EOR} (AirQuality - EOR)` },
  { groupKey: 'AirQuality', roleName: 'AirQuality', area: `${RK} (AirQuality - RK)` },
  { groupKey: 'AssetIntegrity', roleName: 'AssetIntegrity', area: 'All ORCM' },
  { groupKey: 'SAPBusinessSupport', roleName: 'SAPBusinessSupport', area: `${RES}, ${RK}` },
  { groupKey: 'SAPBusinessSupport', roleName: 'SAPBusinessSupport', area: EOR },
  { groupKey: 'Operations-IOC-Carlsbad', roleName: 'Operations-IOC', area: 'OP RES DB NM' },
  { groupKey: 'Operations-IOC-Midland', roleName: 'Operations-IOC', area: 'OP RES MB, OP RES DB TX, OP RES MB CROWNROCK' },
  { groupKey: 'Operations-IOC-DenverCity', roleName: 'Operations-IOC', area: EOR },
  { groupKey: 'Operations-IOC-Platteville', roleName: 'Operations-IOC', area: RK },
  { groupKey: 'ReliabilityandMaintenance', roleName: 'ReliabilityandMaintenance', area: 'All ORCM' },
];

const PSV = ['PRDV_PRV', 'PRESS_RELIEF_DEV', 'PRDV_PVRV', 'PRDV', 'PRDV_VENT_VLV', 'PRDV_RUPT_DISK', 'PRDV_THIEF_HATCH', 'PRDV_BLOWOFF_HATCH'];
const ROTATING = ['(rotating equipment classes, see seed 0103)'];

const route = (
  routeId: number,
  entityType: RouteRow['entityType'],
  requestAction: RouteRow['requestAction'],
  field: string,
  classes: string[],
  responsibleRole: string,
  accountableRole: string
): RouteRow => ({ routeId, entityType, requestAction, field, classScope: classes.length ? 'LIST' : 'ANY', classes, responsibleRole, accountableRole });

/** Seed 0103, in its order. */
export const ROUTES: readonly RouteRow[] = [
  route(1, 'FLOC', 'CREATE', '*', [], 'Operations-IOC - NMD', 'SAPBusinessSupport'),
  route(2, 'EQUIPMENT', 'CREATE', '*', [], 'Operations-IOC - NMD', 'SAPBusinessSupport'),
  route(3, 'EQUIPMENT', 'UPDATE', '*', [], 'Operations-IOC - NMD', 'SAPBusinessSupport'),
  route(4, 'FLOC', 'UPDATE', '*', [], 'Operations-IOC - NMD', 'SAPBusinessSupport'),
  route(5, 'EQUIPMENT', 'CREATE', '*', PSV, 'AssetIntegrity', 'SAPBusinessSupport'),
  route(6, 'EQUIPMENT', 'UPDATE', '*', PSV, 'AssetIntegrity', 'SAPBusinessSupport'),
  route(7, 'FLOC', 'CREATE', '*', PSV, 'AssetIntegrity', 'SAPBusinessSupport'),
  route(8, 'FLOC', 'UPDATE', '*', PSV, 'AssetIntegrity', 'SAPBusinessSupport'),
  route(9, 'FLOC', 'CREATE', '*', ROTATING, 'ReliabilityandMaintenance', 'SAPBusinessSupport'),
  route(10, 'EQUIPMENT', 'CREATE', '*', ROTATING, 'ReliabilityandMaintenance', 'SAPBusinessSupport'),
  route(11, 'EQUIPMENT', 'UPDATE', '*', ROTATING, 'ReliabilityandMaintenance', 'SAPBusinessSupport'),
  route(12, 'FLOC', 'UPDATE', '*', ROTATING, 'ReliabilityandMaintenance', 'SAPBusinessSupport'),
  route(13, 'EQUIPMENT', 'UPDATE', 'OEM_BSFC', [], 'ReliabilityandMaintenance', 'AirQuality'),
];

/** Roles that may hold a route stage, plus the seed's route alias for the regional Operations-IOC groups. */
export const ROUTE_ROLES: readonly string[] = ['Operations-IOC - NMD', ...ROLES.filter((x) => x.canResponsibleApprove || x.canAccountableApprove).map((x) => x.roleName)];
