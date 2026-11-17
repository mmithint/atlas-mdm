/**
 * Who is calling a function (spike S1).
 *
 * `ctx.accessToken` is the invocation's Rayfin token. This module reads the
 * claims (the fields inside the token, such as the caller's e-mail) so the spike
 * can show which claim names exist and which one carries the e-mail.
 *
 * This module only READS a token's payload; it does not check the signature. The
 * signature is checked before any function reads the payload, at the handler
 * boundary in `function_app.ts`: `trustedAccessToken(ctx)` (tokenverify.ts, spike S8,
 * decision D-19) returns the token only when it verifies, else null, and null
 * becomes NOT_AUTHENTICATED below. Pass `callerId` nothing but such a token.
 * The token itself is never returned or logged.
 */

export type TokenKind = 'jwt' | 'opaque' | 'missing';

export interface DecodedToken {
  kind: TokenKind;
  claims: Record<string, unknown>;
}

/** Claims that may carry the caller's e-mail, in the order they are tried. */
export const EMAIL_CLAIMS = [
  'email',
  'preferred_username',
  'upn',
  'unique_name',
] as const;

/**
 * Claims whose values the spike may return. Everything else is reported by
 * name only, so the response cannot carry anything sensitive by accident.
 */
export const SAFE_CLAIMS = [
  'email',
  'preferred_username',
  'upn',
  'unique_name',
  'name',
  'oid',
  'sub',
  'tid',
  'iss',
  'aud',
  'azp',
  'appid',
  'idp',
  'scp',
  'roles',
] as const;

const MAX_VALUE_LENGTH = 200;

/** Reads the payload of a JWT. Anything that is not a readable JWT is `opaque`. */
export function decodeToken(token: string | null | undefined): DecodedToken {
  if (!token) return { kind: 'missing', claims: {} };

  const parts = token.split('.');
  if (parts.length !== 3) return { kind: 'opaque', claims: {} };

  try {
    const json = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(json);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { kind: 'opaque', claims: {} };
    }
    return { kind: 'jwt', claims: payload as Record<string, unknown> };
  } catch {
    return { kind: 'opaque', claims: {} };
  }
}

/** The first e-mail-looking claim, with the name of the claim it came from. */
export function pickCallerEmail(
  claims: Record<string, unknown>
): { claim: string; value: string } | null {
  for (const claim of EMAIL_CLAIMS) {
    const value = claims[claim];
    if (typeof value === 'string' && value.includes('@')) {
      return { claim, value };
    }
  }
  return null;
}

/**
 * The per-user id at the end of the token's `sub` (`…/users/<id>`), lower case, or
 * `null` when `sub` is missing, does not end that way, or the id is not a GUID.
 * Contract: FINAL PLAN/01 section 6.8 step 1 ("accept only a GUID; lower-case it").
 * The id is looked up in `app.principal_identity`; it is never used as an e-mail.
 */
export function userIdFromSub(sub: unknown): string | null {
  if (typeof sub !== 'string') return null;
  const match = /\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
    sub.trim()
  );
  return match?.[1] ? match[1].toLowerCase() : null;
}

export type CallerId =
  | { status: 'OK'; id: string }
  | { status: 'NOT_AUTHENTICATED' };

/**
 * Who is calling, as the id the database can map to a person. Anything that is not
 * a readable token with a GUID user id is `NOT_AUTHENTICATED` and nothing else runs.
 * The payload is decoded here, not signature-checked: the caller (function_app.ts)
 * has already run the token through `trustedAccessToken` (D-19), which is where an
 * unsigned, forged or expired token is turned away.
 */
export function callerId(accessToken: string | null | undefined): CallerId {
  const decoded = decodeToken(accessToken);
  const id = decoded.kind === 'jwt' ? userIdFromSub(decoded.claims['sub']) : null;
  return id ? { status: 'OK', id } : { status: 'NOT_AUTHENTICATED' };
}

/** The allow-listed claims as short strings (arrays joined by a space). */
export function safeClaimValues(
  claims: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SAFE_CLAIMS) {
    const value = claims[name];
    if (value === undefined || value === null) continue;
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    out[name] =
      text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
  }
  return out;
}
