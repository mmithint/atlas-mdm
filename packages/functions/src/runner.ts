/**
 * The shared runner of the functions that act for a person (APP-3 write path, APP-4 reads;
 * FINAL PLAN/01 section 2.2 and 6.8). Moved out of requests.ts in APP-4 so that the request reads
 * (request-reads.ts) use the very same identity step, connection handling and answer envelope as the
 * writes. Behaviour is unchanged by the move.
 *
 * Every function built on `act` does the same four things and nothing else:
 *   1. checks its inputs: types, sizes, a short list of allowed words. No business rule lives here;
 *   2. finds out who is calling: the user id in the verified invocation token, then
 *      app.usp_identity_resolve turns it into the person's e-mail. The BROWSER NEVER SUPPLIES IDENTITY;
 *   3. runs ONE business procedure on one connection;
 *   4. hands the answer back as typed data.
 *
 * Answers carry their failures, they are never thrown: the platform replaces the message of a thrown error
 * with "InternalError ..." (found 15 Nov, see equipment.ts). Every answer starts with the same envelope:
 *   ok         true when the procedure ran and did what was asked
 *   status     OK | INVALID (an input is wrong, nothing was sent) | NOT_AUTHENTICATED | NOT_REGISTERED (the sign-in
 *              is not linked to a person yet: `userId` is returned so the screen can show it) | REFUSED (a procedure
 *              refused with its own message, error numbers 50xxx; `errorCode` is the number) | FAILED (anything
 *              else: connection, permission, bug; the text names the cause)
 *   error      the reason, in plain English, or null
 *   errorCode  the procedure's refusal number when status is REFUSED, else null
 *   userId     the caller's own user id from the token (no e-mail), null when unreadable
 *   timing     milliseconds measured inside the function
 *
 * Names and counts only in the log: an e-mail address, a value or a reason can be client data.
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

import { callerId } from './identity.js';
import { describeSqlError, openPool } from './sql.js';

export interface Timing {
  connectMs: number;
  queryMs: number;
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Input checks (types, sizes, words; never business rules)
// ---------------------------------------------------------------------------

export class InputError extends Error {}

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function text(label: string, value: unknown, max: number, required = false): string {
  if (typeof value !== 'string') throw new InputError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new InputError(`${label} is longer than ${max} characters.`);
  if (required && trimmed === '') throw new InputError(`${label} is required.`);
  return trimmed;
}

export function word(label: string, value: unknown, allowed: readonly string[]): string {
  const upper = text(label, value, 24, true).toUpperCase();
  if (!allowed.includes(upper)) throw new InputError(`${label} must be one of ${allowed.join(', ')}.`);
  return upper;
}

export function whole(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InputError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export const requestIdOf = (value: unknown): number => whole('The request number', value, 1, MAX_SAFE);

export const orNull = (value: string): string | null => (value === '' ? null : value);

export const FIELD_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

// ---------------------------------------------------------------------------
// The shared runner: who is calling, one connection, errors as data
// ---------------------------------------------------------------------------

export interface Envelope {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
}

export const elapsed = (since: number): number => Math.round(performance.now() - since);

/** A procedure's own refusal: THROW numbers 50000 to 59999 (db/procs, "Refusal numbers"). */
export const isRefusal = (n: number | null): n is number => n !== null && n >= 50_000 && n < 60_000;

export function envelope(
  status: string,
  started: number,
  error: string | null,
  errorCode: number | null,
  userId: string | null,
  connectMs = 0,
  queryMs = 0
): Envelope {
  return { ok: status === 'OK', status, error, errorCode, userId, timing: { connectMs, queryMs, totalMs: elapsed(started) } };
}

/** The answer for an input that was refused before anything was sent. */
export function invalid<P extends object>(err: unknown, started: number, empty: P): Envelope & P {
  const message = err instanceof InputError ? err.message : 'The request could not be read.';
  return { ...envelope('INVALID', started, message, null, null), ...empty };
}

/**
 * Runs `work` as the caller. `empty` is the payload every failure answer carries, so the answer's shape never
 * changes. `verb` completes "Could not ..." for failures that are not a procedure's refusal.
 */
export async function act<P extends object>(
  name: string,
  verb: string,
  accessToken: string | null | undefined,
  getSqlToken: () => string,
  empty: P,
  work: (pool: ConnectionPool, actorEmail: string) => Promise<P>
): Promise<Envelope & P> {
  const started = performance.now();
  const caller = callerId(accessToken);
  if (caller.status !== 'OK') {
    return { ...envelope('NOT_AUTHENTICATED', started, 'You are not signed in.', null, null), ...empty };
  }

  let token: string | undefined;
  let pool: ConnectionPool | undefined;
  try {
    token = getSqlToken();
    const connectStart = performance.now();
    pool = await openPool(token);
    const connectMs = elapsed(connectStart);

    // FINAL PLAN/01 section 6.8: the token's user id -> the person's e-mail; no row = not registered.
    const who = await pool
      .request()
      .input('external_id', sql.NVarChar(64), caller.id)
      .execute<{ user_email: string }>('app.usp_identity_resolve');
    const email = who.recordset?.[0]?.user_email;
    if (!email) {
      console.log(`${name}: NOT_REGISTERED`);
      return {
        ...envelope(
          'NOT_REGISTERED',
          started,
          'Your sign-in is not linked to a person yet. Send the id shown on the screen to an admin.',
          null,
          caller.id,
          connectMs
        ),
        ...empty,
      };
    }

    const queryStart = performance.now();
    const value = await work(pool, email);
    const done = envelope('OK', started, null, null, caller.id, connectMs, elapsed(queryStart));
    console.log(`${name}: OK totalMs=${done.timing.totalMs}`);
    return { ...done, ...value };
  } catch (err) {
    const info = describeSqlError(err, token);
    if (isRefusal(info.number)) {
      console.log(`${name}: REFUSED ${info.number}`);
      return { ...envelope('REFUSED', started, info.message, info.number, caller.id), ...empty };
    }
    const message = `Could not ${verb} (${info.number ?? 'no error number'}): ${info.message}${info.hint ? ` ${info.hint}` : ''}`;
    console.error(`${name}: FAILED ${info.number ?? 'no number'}: ${info.message}`);
    return { ...envelope('FAILED', started, message, info.number, caller.id), ...empty };
  } finally {
    if (pool) await pool.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Small readers for what the procedures return
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>;

export const str = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
export const on = (v: unknown): boolean => v === true || v === 1 || v === '1';

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
