/**
 * Who is calling a function (spike S1).
 *
 * `ctx.accessToken` is the invocation's Rayfin token. This module reads the
 * claims (the fields inside the token, such as the caller's e-mail) so the spike
 * can show which claim names exist and which one carries the e-mail.
 *
 * Spike scope: the payload is decoded, not signature-checked. The decision on
 * how `identity.ts` is hardened for the request procedures is taken in APP-3
 * from the S1 result. The token itself is never returned or logged.
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
