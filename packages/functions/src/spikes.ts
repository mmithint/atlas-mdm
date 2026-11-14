/**
 * APP-0 spikes, as plain functions. `function_app.ts` registers them.
 * Both are removed in APP-10 together with the `#/spikes` page.
 *
 * S1 `whoAmI`   can a function learn who is calling?     (answers Q-495)
 * S2 `sqlPing`  can a function reach the ATLAS database as the app identity,
 *               run a transaction, and roll it back?
 *
 * Nothing here returns a token or a secret.
 */
import sql from 'mssql';
import type { ConnectionPool, Request as SqlRequest } from 'mssql';

import {
  decodeToken,
  pickCallerEmail,
  safeClaimValues,
  type TokenKind,
} from './identity.js';
import { describeSqlError, openPool, type SqlErrorInfo } from './sql.js';

const elapsed = (since: number): number => Math.round(performance.now() - since);

// ---------------------------------------------------------------------------
// S1 whoAmI
// ---------------------------------------------------------------------------

export interface WhoAmIResult {
  /** `jwt` = readable claims; `opaque` = a token we cannot read; `missing`. */
  tokenKind: TokenKind;
  /** Every claim name found in the token (names only). */
  claimNames: string[];
  /** The claim the e-mail was taken from, if any. */
  emailClaim: string | null;
  /** The caller's e-mail, if a claim carried one. */
  email: string | null;
  /** Values of the allow-listed claims only. */
  claims: Record<string, string>;
}

export function whoAmI(accessToken: string | null | undefined): WhoAmIResult {
  const decoded = decodeToken(accessToken);
  const picked = pickCallerEmail(decoded.claims);
  const claimNames = Object.keys(decoded.claims).sort();

  // Names only: a claim value can be personal data.
  console.log(`whoAmI: token=${decoded.kind} claims=${claimNames.join(',')}`);

  return {
    tokenKind: decoded.kind,
    claimNames,
    emailClaim: picked?.claim ?? null,
    email: picked?.value ?? null,
    claims: safeClaimValues(decoded.claims),
  };
}

// ---------------------------------------------------------------------------
// S2 sqlPing
// ---------------------------------------------------------------------------

export interface SpikeTransaction {
  rowsBefore: number | null;
  rowsInsideTransaction: number | null;
  rowsAfterRollback: number | null;
  rolledBack: boolean;
}

export interface SqlPingResult {
  /** True only when the connection, the queries and a verified rollback all worked. */
  ok: boolean;
  /** The last step reached. `done` means every step ran. */
  step: 'token' | 'connect' | 'identity' | 'transaction' | 'done';
  /** `SUSER_SNAME()`: the database login this connection runs as. */
  connectedAs: string | null;
  /** `DB_NAME()`: the database the connection landed in. */
  database: string | null;
  serverTimeUtc: string | null;
  connectMs: number | null;
  /** Round trip of one trivial query. */
  queryMs: number | null;
  totalMs: number;
  transaction: SpikeTransaction | null;
  error: SqlErrorInfo | null;
}

export async function sqlPing(getToken: () => string): Promise<SqlPingResult> {
  const started = performance.now();
  const result: SqlPingResult = {
    ok: false,
    step: 'token',
    connectedAs: null,
    database: null,
    serverTimeUtc: null,
    connectMs: null,
    queryMs: null,
    totalMs: 0,
    transaction: null,
    error: null,
  };

  let token: string | undefined;
  let pool: ConnectionPool | undefined;

  try {
    token = getToken();

    result.step = 'connect';
    const connectStart = performance.now();
    pool = await openPool(token);
    result.connectMs = elapsed(connectStart);

    result.step = 'identity';
    const queryStart = performance.now();
    const who = await pool.request().query<{
      connected_as: string | null;
      database_name: string | null;
      server_time_utc: string | null;
    }>(
      `SELECT SUSER_SNAME() AS connected_as,
              DB_NAME() AS database_name,
              CONVERT(varchar(33), SYSUTCDATETIME(), 126) AS server_time_utc`
    );
    result.queryMs = elapsed(queryStart);
    const row = who.recordset[0];
    result.connectedAs = row?.connected_as ?? null;
    result.database = row?.database_name ?? null;
    result.serverTimeUtc = row?.server_time_utc ?? null;

    result.step = 'transaction';
    const tx = await rolledBackTransaction(pool);
    result.transaction = tx;

    if (!tx.rolledBack || tx.rowsAfterRollback !== tx.rowsBefore) {
      result.error = {
        number: null,
        message: 'The rollback did not return dev.spike to its starting row count.',
        hint: null,
      };
    } else {
      result.step = 'done';
      result.ok = true;
    }
  } catch (err) {
    result.error = describeSqlError(err, token);
  } finally {
    if (pool) await pool.close().catch(() => undefined);
    result.totalMs = elapsed(started);
  }

  console.log(
    `sqlPing: ok=${result.ok} step=${result.step} totalMs=${result.totalMs}`
  );
  return result;
}

/** Two inserts inside a transaction that is always rolled back. */
async function rolledBackTransaction(pool: ConnectionPool): Promise<SpikeTransaction> {
  const rowsBefore = await countSpikeRows(new sql.Request(pool));

  const tx = new sql.Transaction(pool);
  await tx.begin();

  let rowsInside: number | null = null;
  let rolledBack = false;
  try {
    for (const note of ['sqlPing step 1', 'sqlPing step 2']) {
      await new sql.Request(tx)
        .input('note', sql.NVarChar(100), note)
        .query('INSERT INTO dev.spike (note) VALUES (@note)');
    }
    rowsInside = await countSpikeRows(new sql.Request(tx));
  } finally {
    try {
      await tx.rollback();
      rolledBack = true;
    } catch {
      rolledBack = false;
    }
  }

  const rowsAfterRollback = await countSpikeRows(new sql.Request(pool));
  return {
    rowsBefore,
    rowsInsideTransaction: rowsInside,
    rowsAfterRollback,
    rolledBack,
  };
}

/** Takes a ready request (on the pool, or inside the open transaction). */
async function countSpikeRows(request: SqlRequest): Promise<number> {
  const res = await request.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM dev.spike'
  );
  return res.recordset[0]?.n ?? 0;
}
