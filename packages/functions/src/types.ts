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
    input: { mode: string; searchColumn: string; searchText: string; facility: string; sortColumn: string; sortDirection: string; offset: number; pageSize: number; filtersJson: string };
    output: { rows: { equipmentId: number; equipmentNumber: null | string; equipmentDescription: null | string; functionalLocation: null | string; flocDescription: null | string; superiorFunctionalLocation: null | string; equipmentTagNumber: null | string; equipClass: null | string; classType: null | string; objectType: null | string; flocClass: null | string; techObjectType: null | string; manufacturer: null | string; modelNumber: null | string; manufacturerSerialNumber: null | string; firedUnfired: null | string; heatDutyMmbtuHr: null | number; heatDutySource: null | string; equipmentUserStatus: null | string; flocUserStatus: null | string; profitCenterName: null | string; plannerGroup: null | string; heaterPopulationMethod: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string; baselineAsOfUtc: null | string; openRequestCount: number; invalidRuleCount: null | number; verificationPct: null | number }[]; totalMatches: number; hasMore: boolean; truncated: boolean; timing: { connectMs: number; queryMs: number; totalMs: number }; error: null | string };
  };
  getEquipmentDetail: {
    input: { equipmentId: number };
    output: { found: boolean; heater: null | { equipmentId: number; equipmentNumber: null | string; equipmentDescription: null | string; functionalLocation: null | string; flocDescription: null | string; superiorFunctionalLocation: null | string; equipmentTagNumber: null | string; equipClass: null | string; classType: null | string; objectType: null | string; flocClass: null | string; techObjectType: null | string; manufacturer: null | string; modelNumber: null | string; manufacturerSerialNumber: null | string; firedUnfired: null | string; heatDutyMmbtuHr: null | number; heatDutySource: null | string; equipmentUserStatus: null | string; flocUserStatus: null | string; profitCenterName: null | string; plannerGroup: null | string; heaterPopulationMethod: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string; baselineAsOfUtc: null | string }; floc: null | { functionalLocation: string; flocDescription: null | string; superiorFunctionalLocation: null | string; flocClass: null | string; techObjectType: null | string; flocUserStatus: null | string; profitCenterName: null | string; level1Id: null | string; level2Id: null | string; level3Id: null | string; level4Id: null | string; level5Id: null | string; level6Id: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string }; fieldValues: { equipmentFieldKey: string; equipmentId: number; fieldCode: string; currentValue: null | string; baselineValue: null | string; unit: null | string; valueSource: null | string; lastRequestId: null | string; lastChangedAtUtc: null | string }[]; ownership: { fieldOwnershipKey: string; entityType: null | string; fieldCode: null | string; label: null | string; responsibleRole: null | string; accountableRole: null | string; routeId: null | number }[]; timing: { connectMs: number; queryMs: number; totalMs: number }; error: null | string };
  };
  createChangeRequest: {
    input: { source: string; entityType: string; equipmentId: number; functionalLocation: string; fieldCode: string; oldValue: string; newValue: string; reason: string; comment: string; evidenceJson: string };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestId: null | number; requestRef: null | string; outcome: null | string; responsibleGroup: null | string; accountableGroup: null | string };
  };
  decideRequest: {
    input: { requestId: number; decision: string; comment: string; expectedStatus: string; returnTo: string };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestId: null | number; requestRef: null | string; decision: null | string; previousStatus: null | string; newStatus: null | string; stage: null | string; needsMerge: boolean; merge: null | { outcome: string; message: null | string; goldenVersionId: null | number; recorded: null | string; error: null | string } };
  };
  bulkApprove: {
    input: { requestIds: string; comment: string };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; decided: number; skipped: number; results: { requestId: null | number; requestRef: null | string; outcome: string; newStatus: null | string; reason: null | string; merge: null | { outcome: string; message: null | string; goldenVersionId: null | number; recorded: null | string; error: null | string } }[] };
  };
  resubmitRequest: {
    input: { requestId: number; newValue: string; comment: string };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestId: null | number; requestRef: null | string; newStatus: null | string; newValue: null | string };
  };
  cancelRequest: {
    input: { requestId: number; comment: string };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestId: null | number; requestRef: null | string; previousStatus: null | string; newStatus: null | string };
  };
  getRequestChecks: {
    input: { requestId: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestStatus: null | string; checks: { order: number; code: string; checkStatus: string; message: string; checkedAtUtc: null | string }[] };
  };
  getRequestEvidence: {
    input: { requestId: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; requestRef: null | string; createdAtUtc: null | string; createdBy: null | string; detailsJson: null | string };
  };
  getRequestQueue: {
    input: { tab: string; profitCenter: string; fieldCode: string; ruleId: string; minAgeHours: number; noteOnly: number; offset: number; pageSize: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; counts: { responsible: number; accountable: number; returned: number; approved: number; rejected: number; mine: number }; totalMatches: number; hasMore: boolean; rows: { requestId: number; requestRef: string; requestStatus: string; approvalStage: null | string; entityType: string; equipmentId: null | number; equipmentNumber: null | string; functionalLocation: null | string; equipmentTagNumber: null | string; profitCenterName: null | string; fieldCode: null | string; fieldLabel: null | string; sapField: null | string; oldValue: null | string; newValue: null | string; reason: null | string; note: null | string; sourceType: string; sourceRuleId: null | string; sourceRuleVersion: null | number; sourceLabel: string; requestedBy: string; requestedAtUtc: null | string; detectedAtUtc: null | string; responsibleGroup: string; accountableGroup: string; returnRecipientType: null | string; returnRecipient: null | string; ageHours: null | number; photoCount: number; updatedAtUtc: null | string; canApprove: boolean }[]; facets: { kind: string; value: string; label: string; n: number }[] };
  };
  getRequestDetail: {
    input: { requestId: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; request: null | { requestId: number; requestRef: string; requestStatus: string; approvalStage: null | string; entityType: string; equipmentId: null | number; equipmentNumber: null | string; functionalLocation: null | string; equipmentTagNumber: null | string; profitCenterName: null | string; fieldCode: null | string; fieldLabel: null | string; sapField: null | string; oldValue: null | string; newValue: null | string; reason: null | string; note: null | string; sourceType: string; sourceRuleId: null | string; sourceRuleVersion: null | number; sourceLabel: string; requestedBy: string; requestedAtUtc: null | string; detectedAtUtc: null | string; responsibleGroup: string; accountableGroup: string; returnRecipientType: null | string; returnRecipient: null | string; ageHours: null | number; photoCount: number; updatedAtUtc: null | string; classCode: null | string; routeId: null | number; creationComment: null | string; lastDecisionBy: null | string; lastDecisionAtUtc: null | string; mergeOutcome: null | string; mergedAtUtc: null | string; goldenVersionId: null | number; exportedAtUtc: null | string; evolveBatchId: null | number; evolveRowNumber: null | number }; events: { eventId: number; eventType: string; approvalStage: null | string; actor: string; actorGroup: null | string; occurredAtUtc: null | string; comments: null | string; statusFrom: null | string; statusTo: null | string; decidedAs: null | string; samePersonBothStages: boolean; returnedTo: null | string }[]; related: { requestId: number; requestRef: string; requestStatus: string; isOpen: boolean; equipmentId: null | number; functionalLocation: null | string; fieldCode: null | string; fieldLabel: null | string; sourceLabel: string; requestedAtUtc: null | string; otherOpenRequestsSameField: number }[]; route: null | { routeId: number; entityType: string; requestAction: string; fieldOrCharacteristic: string; classScope: string; responsibleRole: string; accountableRole: string }; gold: null | { entityType: string; equipmentNumber: null | string; equipmentDescription: null | string; equipmentTagNumber: null | string; functionalLocation: null | string; flocDescription: null | string; equipClass: null | string; profitCenterName: null | string; manufacturer: null | string; modelNumber: null | string; manufacturerSerialNumber: null | string; equipmentUserStatus: null | string; goldenVersionId: null | number; lastChangedAtUtc: null | string; fieldCurrentValue: null | string; fieldUnit: null | string }; checks: { order: number; code: string; checkStatus: string; message: string; checkedAtUtc: null | string }[]; viewer: null | { canDecide: boolean; decideBlockedReason: null | string; canApprove: boolean; approveBlockedReason: null | string; canResubmit: boolean; canCancel: boolean; returnToType: null | string; returnTo: null | string; returnToLabel: null | string; stage: null | string; decidedAs: null | string }; returnCandidates: { email: string; displayName: string; relation: string; isYou: boolean }[] };
  };
  getMyNotifications: {
    input: { limit: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; unreadCount: number; items: { notificationId: number; topic: string; requestId: null | number; requestRef: null | string; title: string; body: string; createdAtUtc: null | string; isRead: boolean }[] };
  };
  getRequestFormOptions: {
    input: Record<string, never>;
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; canSubmit: boolean; isAdmin: boolean; allowedValues: { fieldCode: string; value: string; order: number }[]; blockedFields: { fieldCode: string; reason: string }[] };
  };
  getEquipmentRequests: {
    input: { equipmentId: number };
    output: { ok: boolean; status: string; error: null | string; errorCode: null | number; userId: null | string; timing: { connectMs: number; queryMs: number; totalMs: number }; totalCount: number; rows: { requestId: number; requestRef: string; requestStatus: string; isOpen: boolean; equipmentId: null | number; functionalLocation: null | string; fieldCode: null | string; fieldLabel: null | string; sourceLabel: string; requestedAtUtc: null | string; otherOpenRequestsSameField: number }[] };
  };
  whoAmI: {
    input: Record<string, never>;
    output: { tokenKind: 'jwt' | 'opaque' | 'missing'; claimNames: string[]; emailClaim: null | string; email: null | string; claims: { [k: string]: string }; tokenCheck: { mode: 'report' | 'enforce'; anchor: 'pinned' | 'request' | 'none'; endpoint: null | string; requestEndpoint: string; pinMatchesRequest: null | false | true; configProblem: null | string; verdict: string; header: null | { alg: null | string; kid: null | string; typ: null | string }; expiresInSec: null | number; lifetimeSec: null | number; jwks: null | { status: null | number; ms: null | number; keyCount: number; kids: string[]; algs: string[]; kinds: string[]; fromCache: boolean; ageSec: number; stale: boolean; error: null | string }; tamper: null | { verdict: string; rejected: boolean } } };
  };
  sqlPing: {
    input: Record<string, never>;
    output: { ok: boolean; step: 'token' | 'connect' | 'identity' | 'transaction' | 'done'; connectedAs: null | string; database: null | string; serverTimeUtc: null | string; connectMs: null | number; queryMs: null | number; totalMs: number; transaction: null | { rowsBefore: null | number; rowsInsideTransaction: null | number; rowsAfterRollback: null | number; rolledBack: boolean }; error: null | { number: null | number; message: string; hint: null | string } };
  };
  storageProbe: {
    input: Record<string, never>;
    output: { ok: boolean; step: 'token' | 'done' | 'create' | 'append' | 'flush' | 'read' | 'delete'; path: string; httpStatus: null | number; readBackMatches: null | false | true; totalMs: number; error: null | string };
  };
  oxygptProbe: {
    input: { mode: string; prompt: string };
    output: { ok: boolean; mode: null | 'dns' | 'models' | 'text' | 'agent'; category: null | 'NOT_REGISTERED' | 'NOT_AUTHENTICATED' | 'NOT_ADMIN' | 'BAD_INPUT' | 'NOT_CONFIGURED' | 'NO_SECRET' | 'IDENTITY_ERROR' | 'DNS' | 'NETWORK' | 'TIMEOUT' | 'TLS' | 'REDIRECT' | 'HTTP_401' | 'HTTP_403' | 'HTTP_429' | 'HTTP_OTHER' | 'BAD_RESPONSE' | 'AGENT_NOT_LISTED' | 'AGENT_NO_TASK' | 'AGENT_WAITING' | 'AGENT_FAILED'; host: string; httpStatus: null | number; route: null | string; totalMs: number; dns: null | { addressCount: number; scope: 'PRIVATE' | 'PUBLIC' | 'MIXED' }; models: null | { count: number; ids: string[]; configuredListed: null | false | true }; reply: null | { text: string; truncated: boolean; model: null | string; promptTokens: null | number; completionTokens: null | number }; agent: null | { steps: { step: 'create' | 'delete' | 'models' | 'settings' | 'start' | 'poll' | 'collect'; ok: boolean; httpStatus: null | number; ms: number; count: number }[]; polls: number; config: null | { tools: number; skills: number; filters: number; features: string[]; terminal: boolean; systemPrompt: boolean; approvalMode: null | string }; toolCalls: null | { count: number; names: string[] }; chatDeleted: null | false | true; chatId: null | string }; errorCode: null | string; error: null | string };
  };
};
