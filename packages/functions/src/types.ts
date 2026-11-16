/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  getMyProfile: {
    input: Record<string, never>;
    output: { status: 'OK' | 'NOT_REGISTERED' | 'NOT_AUTHENTICATED'; userId: null | string; email: null | string; displayName: null | string; roles: string[]; groups: string[]; canView: boolean; canSubmitRequests: boolean; canEditRules: boolean; canPublishRules: boolean; canResponsibleApprove: boolean; canAccountableApprove: boolean; canManageAdmin: boolean; responsibleScope: { allOrcm: boolean; profitCenters: string[] }; accountableScope: { allOrcm: boolean; profitCenters: string[] } };
  };
  searchEquipment: {
    input: { mode: string; searchColumn: string; searchText: string; facility: string; sortColumn: string; sortDirection: string; offset: number; pageSize: number };
    output: { rows: { equipmentId: number; equipmentNumber: null | string; equipmentDescription: null | string; functionalLocation: null | string; flocDescription: null | string; superiorFunctionalLocation: null | string; equipmentTagNumber: null | string; equipClass: null | string; classType: null | string; objectType: null | string; flocClass: null | string; techObjectType: null | string; manufacturer: null | string; modelNumber: null | string; manufacturerSerialNumber: null | string; firedUnfired: null | string; heatDutyMmbtuHr: null | number; heatDutySource: null | string; equipmentUserStatus: null | string; flocUserStatus: null | string; profitCenterName: null | string; plannerGroup: null | string; heaterPopulationMethod: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string; baselineAsOfUtc: null | string; openRequestCount: number; invalidRuleCount: null | number; verificationPct: null | number }[]; totalMatches: number; hasMore: boolean; truncated: boolean; timing: { connectMs: number; queryMs: number; totalMs: number }; error: null | string };
  };
  getEquipmentDetail: {
    input: { equipmentId: number };
    output: { found: boolean; heater: null | { equipmentId: number; equipmentNumber: null | string; equipmentDescription: null | string; functionalLocation: null | string; flocDescription: null | string; superiorFunctionalLocation: null | string; equipmentTagNumber: null | string; equipClass: null | string; classType: null | string; objectType: null | string; flocClass: null | string; techObjectType: null | string; manufacturer: null | string; modelNumber: null | string; manufacturerSerialNumber: null | string; firedUnfired: null | string; heatDutyMmbtuHr: null | number; heatDutySource: null | string; equipmentUserStatus: null | string; flocUserStatus: null | string; profitCenterName: null | string; plannerGroup: null | string; heaterPopulationMethod: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string; baselineAsOfUtc: null | string }; floc: null | { functionalLocation: string; flocDescription: null | string; superiorFunctionalLocation: null | string; flocClass: null | string; techObjectType: null | string; flocUserStatus: null | string; profitCenterName: null | string; level1Id: null | string; level2Id: null | string; level3Id: null | string; level4Id: null | string; level5Id: null | string; level6Id: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string }; fieldValues: { equipmentFieldKey: string; equipmentId: number; fieldCode: string; currentValue: null | string; baselineValue: null | string; unit: null | string; valueSource: null | string; lastRequestId: null | string; lastChangedAtUtc: null | string }[]; ownership: { fieldOwnershipKey: string; entityType: null | string; fieldCode: null | string; label: null | string; responsibleRole: null | string; accountableRole: null | string; routeId: null | number }[]; timing: { connectMs: number; queryMs: number; totalMs: number }; error: null | string };
  };
  whoAmI: {
    input: Record<string, never>;
    output: { tokenKind: 'jwt' | 'opaque' | 'missing'; claimNames: string[]; emailClaim: null | string; email: null | string; claims: { [k: string]: string } };
  };
  sqlPing: {
    input: Record<string, never>;
    output: { ok: boolean; step: 'token' | 'connect' | 'identity' | 'transaction' | 'done'; connectedAs: null | string; database: null | string; serverTimeUtc: null | string; connectMs: null | number; queryMs: null | number; totalMs: number; transaction: null | { rowsBefore: null | number; rowsInsideTransaction: null | number; rowsAfterRollback: null | number; rolledBack: boolean }; error: null | { number: null | number; message: string; hint: null | string } };
  };
  storageProbe: {
    input: Record<string, never>;
    output: { ok: boolean; step: 'token' | 'done' | 'create' | 'append' | 'flush' | 'read' | 'delete'; path: string; httpStatus: null | number; readBackMatches: null | false | true; totalMs: number; error: null | string };
  };
};
