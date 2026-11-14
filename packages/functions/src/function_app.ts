import {
  AudienceType,
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';

import {
  sqlPing,
  whoAmI,
  type SqlPingResult,
  type WhoAmIResult,
} from './spikes.js';

const udf = new UserDataFunctions();

// Rayfin's type generation reads each handler inline (an arrow function written
// inside `udf.func`), so handlers stay here and delegate to the modules.
// Every business rule lives in a T-SQL procedure; functions only resolve the
// caller, validate input and call one procedure.

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
