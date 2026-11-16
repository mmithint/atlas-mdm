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
import { loadMyProfile, type MyProfile } from './profile.js';
import {
  sqlPing,
  whoAmI,
  type SqlPingResult,
  type WhoAmIResult,
} from './spikes.js';
import { storageProbe, type StorageProbeResult } from './storage.js';

const udf = new UserDataFunctions();

// Rayfin's type generation reads each handler inline (an arrow function written
// inside `udf.func`), so handlers stay here and delegate to the modules.
// Every business rule lives in a T-SQL procedure; functions only resolve the
// caller, validate input and call one procedure.

// APP-2: who is signed in and what may they do. Reads only (profile.ts).
udf.func(
  'getMyProfile',
  async (
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<MyProfile> => loadMyProfile(ctx.accessToken, () => ctx.Tokens.Sql),
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
    ctx: RayfinContext<Record<string, any>, AudienceType.Sql>
  ): Promise<EquipmentSearchResult> =>
    runEquipmentSearch(
      { mode, searchColumn, searchText, facility, sortColumn, sortDirection, offset, pageSize },
      ctx.accessToken,
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
    runEquipmentDetail(equipmentId, ctx.accessToken, () => ctx.Tokens.Sql),
  []
);

// APP-0 spikes. Removed in APP-10 together with the `#/spikes` page.

// S1: which claims does the invocation token carry? (Q-495)
udf.func(
  'whoAmI',
  async (ctx: RayfinContext): Promise<WhoAmIResult> => whoAmI(ctx.accessToken),
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
