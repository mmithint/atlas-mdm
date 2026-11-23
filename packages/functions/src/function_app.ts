import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';

import {
  runEquipmentDetail,
  runEquipmentSearch,
  type EquipmentDetailResult,
  type EquipmentSearchResult,
} from './equipment.js';
import { runOxygptProbe, SECRET_API_KEY, SECRET_MODEL_ID, type OxygptProbeResult } from './oxygpt.js';
import { loadMyProfile, type MyProfile } from './profile.js';
import {
  runEquipmentRequests,
  runMyNotifications,
  runRequestDetail,
  runRequestFormOptions,
  runRequestQueue,
  type EquipmentRequestsResult,
  type MyNotificationsResult,
  type RequestDetailResult,
  type RequestFormOptionsResult,
  type RequestQueueResult,
} from './request-reads.js';
import {
  runBulkApprove,
  runCancelRequest,
  runCreateRequest,
  runDecideRequest,
  runRequestChecks,
  runRequestEvidence,
  runResubmitRequest,
  type BulkApproveResult,
  type CancelRequestResult,
  type CreateRequestResult,
  type DecideRequestResult,
  type RequestChecksResult,
  type RequestEvidenceResult,
  type ResubmitRequestResult,
} from './requests.js';
import {
  sqlPing,
  whoAmI,
  type SqlPingResult,
  type WhoAmIResult,
} from './spikes.js';
import {
  runDeleteSavedView,
  runListSavedViews,
  runSaveView,
  type DeleteSavedViewResult,
  type ListSavedViewsResult,
  type SaveViewResult,
} from './saved-views.js';
import { storageProbe, type StorageProbeResult } from './storage.js';
import { tokenCheckReport, trustedAccessToken } from './tokenverify.js';

const udf = new UserDataFunctions();

// Rayfin's type generation reads each handler inline (an arrow function written
// inside `udf.func`), so handlers stay here and delegate to the modules.
// Every business rule lives in a T-SQL procedure; functions only resolve the
// caller, validate input and call one procedure.
//
// WHO IS CALLING (D-19, 01 section 6.8): a handler that acts for a person passes
// `await trustedAccessToken(ctx)` to its module, never `ctx.accessToken`. That call
// checks the token's signature (tokenverify.ts); a token that fails comes back as
// null and the module answers NOT_AUTHENTICATED. tokenverify.spec.ts fails if a
// handler here skips it.

// APP-2: who is signed in and what may they do. Reads only (profile.ts).
udf.func(
  'getMyProfile',
  async (
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<MyProfile> => loadMyProfile(await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

// APP-2, read path C (D-17): the connector cannot read views, so the equipment screens read
// through these two functions. Plain text and number parameters on purpose (the documented
// shape); equipment.ts checks them, the procedures hold the search rules. Reads only.
udf.func(
  'searchEquipment',
  async (
    mode: string,
    searchColumn: string,
    searchText: string,
    facility: string,
    sortColumn: string,
    sortDirection: string,
    offset: number,
    pageSize: number,
    filtersJson: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<EquipmentSearchResult> =>
    runEquipmentSearch(
      { mode, searchColumn, searchText, facility, sortColumn, sortDirection, offset, pageSize, filtersJson },
      await trustedAccessToken(ctx),
      () => ctx.Tokens.Sql
    ),
  []
);

udf.func(
  'getEquipmentDetail',
  async (
    equipmentId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<EquipmentDetailResult> =>
    runEquipmentDetail(equipmentId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

// APP-3, the request write path (FINAL PLAN/01 section 2.2). Plain text and number parameters on purpose;
// requests.ts checks them. No function takes an e-mail address: the caller is identified from the token
// (01 section 6.8) and the procedure receives the e-mail as @actor_email / @requested_by. Every failure
// comes back inside the answer (status, error), never thrown.
udf.func(
  'createChangeRequest',
  async (
    source: string,
    entityType: string,
    equipmentId: number,
    functionalLocation: string,
    fieldCode: string,
    oldValue: string,
    newValue: string,
    reason: string,
    comment: string,
    evidenceJson: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<CreateRequestResult> =>
    runCreateRequest(
      { source, entityType, equipmentId, functionalLocation, fieldCode, oldValue, newValue, reason, comment, evidenceJson },
      await trustedAccessToken(ctx),
      () => ctx.Tokens.Sql
    ),
  []
);

udf.func(
  'decideRequest',
  async (
    requestId: number,
    decision: string,
    comment: string,
    expectedStatus: string,
    returnTo: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<DecideRequestResult> =>
    runDecideRequest({ requestId, decision, comment, expectedStatus, returnTo }, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'bulkApprove',
  async (
    requestIds: string,
    comment: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<BulkApproveResult> =>
    runBulkApprove({ requestIds, comment }, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'resubmitRequest',
  async (
    requestId: number,
    newValue: string,
    comment: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<ResubmitRequestResult> =>
    runResubmitRequest({ requestId, newValue, comment }, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'cancelRequest',
  async (
    requestId: number,
    comment: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<CancelRequestResult> =>
    runCancelRequest({ requestId, comment }, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'getRequestChecks',
  async (
    requestId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<RequestChecksResult> => runRequestChecks(requestId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'getRequestEvidence',
  async (
    requestId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<RequestEvidenceResult> => runRequestEvidence(requestId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

// APP-4, the request screens' reads (read path C, D-17; request-reads.ts). Reads only. They take the caller from the
// verified token like the writes do, because "my queue", "what may I decide" and "my notifications" depend on who is
// asking; the procedures behind them hold every rule (which request is in which tab, who may decide).
udf.func(
  'getRequestQueue',
  async (
    tab: string,
    profitCenter: string,
    fieldCode: string,
    ruleId: string,
    minAgeHours: number,
    noteOnly: number,
    offset: number,
    pageSize: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<RequestQueueResult> =>
    runRequestQueue(
      { tab, profitCenter, fieldCode, ruleId, minAgeHours, noteOnly, offset, pageSize },
      await trustedAccessToken(ctx),
      () => ctx.Tokens.Sql
    ),
  []
);

udf.func(
  'getRequestDetail',
  async (
    requestId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<RequestDetailResult> => runRequestDetail(requestId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'getMyNotifications',
  async (
    limit: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<MyNotificationsResult> => runMyNotifications(limit, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'getRequestFormOptions',
  async (
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<RequestFormOptionsResult> => runRequestFormOptions(await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'getEquipmentRequests',
  async (
    equipmentId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<EquipmentRequestsResult> => runEquipmentRequests(equipmentId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

// APP-0 spikes. Removed in APP-10 together with the `#/spikes` page.

// S1: which claims does the invocation token carry? (Q-495)
// S8: does the token's signature verify against the Rayfin service's published keys? (`tokenCheck` in the answer)
// This spike reads the raw token on purpose, to show what the platform sends; no other handler may.
udf.func(
  'whoAmI',
  async (ctx: RayfinContext): Promise<WhoAmIResult> => whoAmI(ctx.accessToken, await tokenCheckReport(ctx)),
  []
);

// S2: can a function reach the ATLAS database as the app identity?
udf.func(
  'sqlPing',
  async (
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<SqlPingResult> => sqlPing(() => ctx.Tokens.Sql),
  []
);

// S4: can a function write a file to the lakehouse Files area through OneLake as the
// app identity? (Rayfin's own storage is not enabled in the Fabric service; see storage.ts.)
udf.func(
  'storageProbe',
  async (
    ctx: RayfinContext<Record<string, any>, AudienceType.Storage>
  ): Promise<StorageProbeResult> => storageProbe(() => ctx.Tokens.Storage),
  []
);

// S5: can a deployed function reach OxyGPT (the client's AI service) and get an answer? Admin only: it spends a shared
// key and, in `text` and `agent` mode, forwards free text (oxygpt.ts, oxygpt-agent.ts). The key is the secret OXY_GPT_API_KEY and the agent's ID is
// OXYGPT_AGENT_MODEL_ID, the names the project team gave them in Fabric. They are read by name: `ctx.Secrets` is typed
// only for names that `npx rayfin secret set` has put in secrets.generated.ts (nothing there yet), and it resolves a
// name from the delivered secret bag first and from the environment second, so both ways of setting a value work.
// A missing value is reported as NO_SECRET or NOT_CONFIGURED, not thrown.
udf.func(
  'oxygptProbe',
  async (
    mode: string,
    prompt: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<OxygptProbeResult> =>
    runOxygptProbe(
      { mode, prompt },
      await trustedAccessToken(ctx),
      () => ctx.Tokens.Sql,
      () => (ctx.Secrets as Readonly<Record<string, string>>)[SECRET_API_KEY] ?? '',
      () => (ctx.Secrets as Readonly<Record<string, string>>)[SECRET_MODEL_ID] ?? ''
    ),
  []
);

// Saved filters (saved views): one person's named filter settings per screen, in app.saved_view, so they
// follow the person to any device (saved-views.ts). The owner is always the verified caller.
udf.func(
  'listSavedViews',
  async (
    screenCode: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<ListSavedViewsResult> => runListSavedViews(screenCode, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'saveView',
  async (
    screenCode: string,
    viewName: string,
    definitionJson: string,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<SaveViewResult> =>
    runSaveView({ screenCode, viewName, definitionJson }, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);

udf.func(
  'deleteSavedView',
  async (
    savedViewId: number,
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<DeleteSavedViewResult> => runDeleteSavedView(savedViewId, await trustedAccessToken(ctx), () => ctx.Tokens.Sql),
  []
);
