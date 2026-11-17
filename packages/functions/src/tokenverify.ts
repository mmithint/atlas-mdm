/**
 * Verifying the invocation token (spike S8, decision D-19; contract FINAL PLAN/01 section 6.8 step 1).
 *
 * `ctx.accessToken` is a JWT. Measured on the deployed app (S8, 17 Nov): in Fabric hosting it is an Entra-style
 * token signed with RS256 (`iss` is `https://sts.windows.net/<tenant>/`), and the key set at
 * `<endpoint>/.well-known/jwks.json` holds RSA keys with no `alg` field. ES256 is what the self-hosted Rayfin
 * service signs with (rayfin guide, `Auth__AsymmetricKeys__Algorithm`), so both are accepted. This module checks,
 * with Node's own `crypto` and no extra dependency:
 *
 *   1. the header says `RS256` or `ES256` and names a key (`kid`) - nothing else is accepted, so `none`, `HS256`,
 *      `PS256` and the other variants are refused. Each algorithm may only be checked with its own key type
 *      (RS256 with an RSA key of at least 2048 bits, ES256 with a P-256 key), so a token cannot make us use a
 *      public key as an HMAC secret or as the wrong kind of key (the "algorithm confusion" attacks);
 *   2. the signature verifies against that key from the key set;
 *   3. `exp` is present and not past (and `nbf`, if present, is not in the future), within a small clock skew;
 *   4. pins on `iss`, `aud` and the `sub` scope (everything before `/users/<id>`). Because the signing keys are
 *      the identity provider's, the signature alone says "the provider issued this", not "issued for this app":
 *      the three pins are what tie a token to THIS app, so `enforce` requires all of them.
 *
 * WHY THE KEY ENDPOINT IS PINNED, NOT READ FROM THE REQUEST. In production `ctx.baseUrl` and `ctx.accessToken`
 * arrive together in one request header. Anyone able to forge the token could forge the endpoint beside it and
 * point us at their own key set, so keys fetched from `ctx.baseUrl` prove nothing. The endpoint therefore lives
 * in `config.ts` (`TOKEN_CHECK.rayfinEndpoint`). Until it is pinned the check can only run in `report` mode
 * (learn what the platform does, change nothing); `enforce` refuses to run without a pin.
 *
 * `enforce` fails closed: no keys, bad token, unknown key -> the caller is NOT_AUTHENTICATED. The key set is
 * cached (TTL, serve-stale when a refresh fails, throttled refresh when an unknown `kid` shows up) so a key
 * rotation heals itself without a request storm.
 *
 * Nothing here returns or logs a token. Only reason codes are logged.
 */
import { constants, createPublicKey, verify as verifySignature, type JsonWebKey } from 'node:crypto';

import { TOKEN_CHECK, type TokenCheckConfig, type TokenCheckMode } from './config.js';

export const JWKS_PATH = '/.well-known/jwks.json';

export type Rejection =
  | 'MISSING'
  | 'MALFORMED'
  | 'ALG_NOT_ALLOWED'
  | 'NO_KID'
  | 'KEY_NOT_FOUND'
  | 'BAD_SIGNATURE'
  | 'NO_EXPIRY'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'WRONG_ISSUER'
  | 'WRONG_AUDIENCE'
  | 'WRONG_SCOPE'
  | 'KEYS_UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'INTERNAL_ERROR';

// ---------------------------------------------------------------------------
// Reading a token (no trust yet)
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

const B64URL = /^[A-Za-z0-9_-]+$/;

export interface ParsedJwt {
  header: JsonObject;
  claims: JsonObject;
  /** `<header>.<payload>` exactly as sent: the bytes that were signed. */
  signingInput: string;
  signature: Buffer;
}

function decodeJsonObject(part: string): JsonObject | null {
  if (!B64URL.test(part)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
  } catch {
    return null;
  }
}

/** Splits and decodes a compact JWT. `null` when it is not three well-formed parts. */
export function parseJwt(token: string): ParsedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h = '', p = '', s = ''] = parts;
  const header = decodeJsonObject(h);
  const claims = decodeJsonObject(p);
  // An empty signature part is allowed through so an unsigned (`alg: none`) token is refused as such.
  if (!header || !claims || (s !== '' && !B64URL.test(s))) return null;
  return { header, claims, signingInput: `${h}.${p}`, signature: Buffer.from(s, 'base64url') };
}

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SUB_USER_SUFFIX = new RegExp(`/users/${GUID}$`, 'i');

/** `sub` without its trailing `/users/<id>`: the tenant, app, workspace and project the user belongs to. */
export function subScopeOf(sub: unknown): string | null {
  if (typeof sub !== 'string') return null;
  const text = sub.trim();
  const match = SUB_USER_SUFFIX.exec(text);
  return match ? text.slice(0, match.index) : null;
}

// ---------------------------------------------------------------------------
// The check itself (pure: keys and the clock are passed in)
// ---------------------------------------------------------------------------

export interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  /** RSA public key: modulus and exponent. */
  n?: string;
  e?: string;
  /** EC public key: curve and point. */
  crv?: string;
  x?: string;
  y?: string;
}

export interface JwkSet {
  keys: Jwk[];
}

export interface VerifyOptions {
  /** Now, in whole seconds since 1970. */
  nowSec: number;
  /** Tolerated clock difference in seconds (default 60). */
  skewSec?: number;
  issuer?: string;
  audience?: string;
  subScope?: string;
}

export type TokenVerdict =
  | { ok: true; kid: string; header: JsonObject; claims: JsonObject }
  | { ok: false; reason: Rejection; header: JsonObject | null; claims: JsonObject | null };

const DEFAULT_SKEW_SEC = 60;

/** The only algorithms accepted. Each is checked against its own kind of key and no other. */
type Algorithm = 'RS256' | 'ES256';

const isAlgorithm = (value: unknown): value is Algorithm => value === 'RS256' || value === 'ES256';

/** An RSA key smaller than this is not trusted to check a signature, whatever the key set says. */
const MIN_RSA_BITS = 2048;

/** Whether a key of the set may be used for `alg`: right key type, not marked for another algorithm or use. */
function usableFor(k: Jwk, alg: Algorithm): boolean {
  if (k.use !== undefined && k.use !== 'sig') return false;
  if (k.alg !== undefined && k.alg !== alg) return false;
  return alg === 'RS256'
    ? k.kty === 'RSA' && typeof k.n === 'string' && typeof k.e === 'string'
    : k.kty === 'EC' && k.crv === 'P-256' && typeof k.x === 'string' && typeof k.y === 'string';
}

function findKey(set: JwkSet, kid: string, alg: Algorithm): Jwk | undefined {
  return set.keys.find((k) => k.kid === kid && usableFor(k, alg));
}

/**
 * Whether the signature is right: `true` / `false`, or `null` when the key itself cannot be used (it will not
 * load, or an RSA key is too small). Throws only on malformed key material; the caller treats that as `null`.
 */
function signatureMatches(alg: Algorithm, jwk: Jwk, parsed: ParsedJwt): boolean | null {
  const data = Buffer.from(parsed.signingInput, 'utf8');
  if (alg === 'RS256') {
    const publicKey = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e } as JsonWebKey, format: 'jwk' });
    const bits = publicKey.asymmetricKeyDetails?.modulusLength ?? 0;
    if (bits < MIN_RSA_BITS) return null;
    // A JWS RS256 signature is exactly as long as the modulus (RSASSA-PKCS1-v1_5).
    return (
      parsed.signature.length === Math.ceil(bits / 8) &&
      verifySignature('sha256', data, { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, parsed.signature)
    );
  }
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } as JsonWebKey, format: 'jwk' });
  // A JWS ES256 signature is the raw 64 bytes R||S (IEEE P1363), not the DER form Node expects by default.
  return parsed.signature.length === 64 && verifySignature('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, parsed.signature);
}

/** Verifies a compact JWT against a key set. Never throws. */
export function verifySignedToken(token: string, set: JwkSet, options: VerifyOptions): TokenVerdict {
  const parsed = parseJwt(token);
  if (!parsed) return { ok: false, reason: 'MALFORMED', header: null, claims: null };
  const { header, claims } = parsed;
  const fail = (reason: Rejection): TokenVerdict => ({ ok: false, reason, header, claims });

  const alg = header['alg'];
  if (!isAlgorithm(alg)) return fail('ALG_NOT_ALLOWED');
  const kid = header['kid'];
  if (typeof kid !== 'string' || kid === '') return fail('NO_KID');

  const jwk = findKey(set, kid, alg);
  if (!jwk) return fail('KEY_NOT_FOUND');

  let valid: boolean | null;
  try {
    valid = signatureMatches(alg, jwk, parsed);
  } catch {
    return fail('KEY_NOT_FOUND'); // the key material itself is unusable
  }
  if (valid === null) return fail('KEY_NOT_FOUND');
  if (!valid) return fail('BAD_SIGNATURE');

  const skew = options.skewSec ?? DEFAULT_SKEW_SEC;
  const exp = claims['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return fail('NO_EXPIRY');
  if (options.nowSec > exp + skew) return fail('EXPIRED');
  const nbf = claims['nbf'];
  if (typeof nbf === 'number' && Number.isFinite(nbf) && options.nowSec + skew < nbf) return fail('NOT_YET_VALID');

  if (options.issuer && claims['iss'] !== options.issuer) return fail('WRONG_ISSUER');
  if (options.audience) {
    const aud = claims['aud'];
    const audiences = Array.isArray(aud) ? aud : [aud];
    if (!audiences.includes(options.audience)) return fail('WRONG_AUDIENCE');
  }
  if (options.subScope) {
    const scope = subScopeOf(claims['sub']);
    if (scope === null || scope.toLowerCase() !== options.subScope.trim().toLowerCase()) return fail('WRONG_SCOPE');
  }
  return { ok: true, kid, header, claims };
}

/**
 * The same token with one claim added and the signature left alone. A working check must refuse it
 * (`BAD_SIGNATURE`); the spike runs this against the real key to prove the check is not vacuous.
 */
export function tamperPayload(token: string): string | null {
  const parsed = parseJwt(token);
  if (!parsed) return null;
  const [h = '', , s = ''] = token.split('.');
  const payload = Buffer.from(JSON.stringify({ ...parsed.claims, tamper_probe: 1 }), 'utf8').toString('base64url');
  return `${h}.${payload}.${s}`;
}

// ---------------------------------------------------------------------------
// The key set: fetched once, cached, refreshed with care
// ---------------------------------------------------------------------------

export interface KeySource {
  /** Base URL of the Rayfin service (no trailing path). */
  endpoint: string;
  /** Sent as `X-Publishable-Key`, as the Rayfin client does on every call. Public by design. */
  publishableKey: string;
}

export interface JwksInfo {
  /** HTTP status of the last download, `null` when it never got an answer. */
  status: number | null;
  /** Duration of the last download in ms. */
  ms: number | null;
  keyCount: number;
  kids: string[];
  /** The `alg` each key declares (`''` when it declares none, as the Fabric key set does). */
  algs: string[];
  /** The key type of each key: `RSA`, `EC/P-256`, ... Shows why a key that is listed in `kids` was not usable. */
  kinds: string[];
  /** True when this answer came from memory, not from a download made for this call. */
  fromCache: boolean;
  /** Seconds since the keys were downloaded. */
  ageSec: number;
  /** True when the keys are past their TTL and the refresh failed or was throttled. */
  stale: boolean;
  error: string | null;
}

export interface KeyStoreResult {
  keys: JwkSet | null;
  info: JwksInfo;
}

export interface KeyStore {
  get(source: KeySource, options?: { refresh?: boolean }): Promise<KeyStoreResult>;
}

export interface KeyStoreDeps {
  fetchFn?: typeof fetch;
  nowMs?: () => number;
  /** How long downloaded keys are used before a refresh (default 10 minutes). */
  ttlMs?: number;
  /** No second download sooner than this after an attempt, success or failure (default 30 s). */
  retryAfterMs?: number;
  timeoutMs?: number;
}

interface Entry {
  keys: JwkSet | null;
  fetchedAt: number;
  lastAttempt: number;
  lastStatus: number | null;
  lastMs: number | null;
  lastError: string | null;
  inflight: Promise<void> | null;
}

const GUID_GLOBAL = new RegExp(GUID, 'gi');

/** The Fabric item id at the end of the endpoint; the Rayfin client sends it as a header ("required for Fabric hosting"). */
function monikerOf(endpoint: string): string | null {
  const all = endpoint.match(GUID_GLOBAL);
  return all && all.length > 0 ? (all[all.length - 1] ?? null) : null;
}

function readKeySet(body: unknown): JwkSet | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as { keys?: unknown }).keys;
  if (!Array.isArray(raw)) return null;
  const keys: Jwk[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    keys.push({
      kty: text(o['kty']),
      kid: text(o['kid']),
      alg: text(o['alg']),
      use: text(o['use']),
      n: text(o['n']),
      e: text(o['e']),
      crv: text(o['crv']),
      x: text(o['x']),
      y: text(o['y']),
    });
  }
  return { keys };
}

const kindOf = (k: Jwk): string => (k.kty && k.crv ? `${k.kty}/${k.crv}` : (k.kty ?? ''));

function describeFailure(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export function createKeyStore(deps: KeyStoreDeps = {}): KeyStore {
  const fetchFn = deps.fetchFn ?? fetch;
  const nowMs = deps.nowMs ?? Date.now;
  const ttlMs = deps.ttlMs ?? 10 * 60_000;
  const retryAfterMs = deps.retryAfterMs ?? 30_000;
  const timeoutMs = deps.timeoutMs ?? 5_000;
  const entries = new Map<string, Entry>();

  async function download(source: KeySource, entry: Entry): Promise<void> {
    const started = performance.now();
    const url = `${source.endpoint.trim().replace(/\/+$/, '')}${JWKS_PATH}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (source.publishableKey) headers['X-Publishable-Key'] = source.publishableKey;
    const moniker = monikerOf(source.endpoint);
    if (moniker) headers['x-ms-workload-resource-moniker'] = moniker;

    entry.lastStatus = null;
    try {
      const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      entry.lastStatus = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const keys = readKeySet(await res.json());
      if (!keys) throw new Error('the answer is not a key set');
      entry.keys = keys;
      entry.fetchedAt = nowMs();
      entry.lastError = null;
    } catch (err) {
      entry.lastError = describeFailure(err);
    } finally {
      entry.lastMs = Math.round(performance.now() - started);
    }
  }

  function snapshot(entry: Entry, fromCache: boolean): KeyStoreResult {
    const now = nowMs();
    const keys = entry.keys;
    return {
      keys,
      info: {
        status: entry.lastStatus,
        ms: entry.lastMs,
        keyCount: keys ? keys.keys.length : 0,
        kids: keys ? keys.keys.map((k) => k.kid ?? '') : [],
        algs: keys ? keys.keys.map((k) => k.alg ?? '') : [],
        kinds: keys ? keys.keys.map(kindOf) : [],
        fromCache,
        ageSec: keys ? Math.max(0, Math.round((now - entry.fetchedAt) / 1000)) : 0,
        stale: keys !== null && now - entry.fetchedAt >= ttlMs,
        error: entry.lastError,
      },
    };
  }

  return {
    async get(source, options = {}) {
      let entry = entries.get(source.endpoint);
      if (!entry) {
        entry = { keys: null, fetchedAt: 0, lastAttempt: Number.NEGATIVE_INFINITY, lastStatus: null, lastMs: null, lastError: null, inflight: null };
        entries.set(source.endpoint, entry);
      }
      if (entry.inflight) {
        await entry.inflight; // callers that arrive together share one download
        return snapshot(entry, false);
      }

      const now = nowMs();
      const expired = entry.keys === null || now - entry.fetchedAt >= ttlMs;
      const wanted = expired || options.refresh === true;
      // No download sooner than `retryAfterMs` after the last attempt, so an outage or a stream of tokens
      // with unknown key ids cannot turn every call into a slow download.
      const allowed = now - entry.lastAttempt >= retryAfterMs;
      if (!wanted || !allowed) return snapshot(entry, true);

      entry.lastAttempt = now;
      const pending = download(source, entry).finally(() => {
        entry.inflight = null;
      });
      entry.inflight = pending;
      await pending;
      return snapshot(entry, false);
    },
  };
}

// ---------------------------------------------------------------------------
// The check as the functions use it
// ---------------------------------------------------------------------------

/** The parts of the invocation context the check needs. `RayfinContext` has all three. */
export interface TokenInput {
  readonly accessToken: string;
  readonly baseUrl: string;
  readonly publishableKey: string;
}

export type Anchor = 'pinned' | 'request' | 'none';

export interface CheckResult {
  verdict: 'VALID' | Rejection;
  anchor: Anchor;
  endpoint: string | null;
  jwks: JwksInfo | null;
  header: JsonObject | null;
  claims: JsonObject | null;
  keys: JwkSet | null;
}

/** What the spike returns. Reason codes, key ids and timings only: never a token, never a claim value. */
export interface TokenCheckReport {
  mode: TokenCheckMode;
  anchor: Anchor;
  /** The endpoint the keys were (or would be) fetched from. */
  endpoint: string | null;
  /** `ctx.baseUrl` of this call: the value to pin in `config.ts`. */
  requestEndpoint: string;
  /** Whether the pinned endpoint equals `ctx.baseUrl` (`null` when nothing is pinned). */
  pinMatchesRequest: boolean | null;
  configProblem: string | null;
  verdict: string;
  header: { alg: string | null; kid: string | null; typ: string | null } | null;
  expiresInSec: number | null;
  lifetimeSec: number | null;
  jwks: JwksInfo | null;
  /** The same token with a claim added: must be refused (`BAD_SIGNATURE`). */
  tamper: { verdict: string; rejected: boolean } | null;
}

export interface TokenCheckerDeps {
  config: TokenCheckConfig;
  keys: KeyStore;
  nowSec: () => number;
  log: (message: string) => void;
}

export interface TokenChecker {
  run(input: TokenInput): Promise<CheckResult>;
  /** The token itself when it may be trusted, else `null` (always, in `report` mode: the token is passed on). */
  trusted(input: TokenInput): Promise<string | null>;
  report(input: TokenInput): Promise<TokenCheckReport>;
}

const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

const normalise = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Why this configuration cannot run in its mode, or `null`. `enforce` needs a pinned https endpoint and all three
 * claim pins: the keys belong to the identity provider, so only the pins tie a token to this app.
 */
export function configProblem(config: TokenCheckConfig): string | null {
  if (config.mode !== 'enforce') return null;
  if (!isHttps(config.rayfinEndpoint)) return 'enforce needs a pinned https rayfinEndpoint';
  const missing = (['issuer', 'audience', 'subScope'] as const).filter((name) => !config[name].trim());
  if (missing.length > 0) return `enforce needs ${missing.join(', ')} pinned`;
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function createTokenChecker(deps: TokenCheckerDeps): TokenChecker {
  const { config, keys: store, nowSec, log } = deps;

  async function run(input: TokenInput): Promise<CheckResult> {
    const result: CheckResult = { verdict: 'MISSING', anchor: 'none', endpoint: null, jwks: null, header: null, claims: null, keys: null };
    if (!input.accessToken) return result;
    if (configProblem(config)) return { ...result, verdict: 'NOT_CONFIGURED' };

    const pinned = config.rayfinEndpoint.trim();
    if (pinned) {
      result.anchor = 'pinned';
      result.endpoint = pinned;
    } else if (isHttps(input.baseUrl)) {
      // Only reachable in `report` mode (configProblem refuses `enforce` without a pin). Learning only.
      result.anchor = 'request';
      result.endpoint = input.baseUrl;
    } else {
      return { ...result, verdict: 'NOT_CONFIGURED' };
    }

    const source: KeySource = { endpoint: result.endpoint, publishableKey: input.publishableKey };
    let fetched = await store.get(source);
    if (!fetched.keys) return { ...result, verdict: 'KEYS_UNAVAILABLE', jwks: fetched.info };

    const options: VerifyOptions = {
      nowSec: nowSec(),
      issuer: config.issuer || undefined,
      audience: config.audience || undefined,
      subScope: config.subScope || undefined,
    };
    let verdict = verifySignedToken(input.accessToken, fetched.keys, options);
    if (!verdict.ok && verdict.reason === 'KEY_NOT_FOUND') {
      // A key rotation: look once more (the store throttles this) before refusing.
      const again = await store.get(source, { refresh: true });
      if (again.keys) {
        fetched = again;
        verdict = verifySignedToken(input.accessToken, again.keys, options);
      }
    }
    return {
      ...result,
      verdict: verdict.ok ? 'VALID' : verdict.reason,
      jwks: fetched.info,
      header: verdict.header,
      claims: verdict.claims,
      keys: fetched.keys,
    };
  }

  async function safeRun(input: TokenInput): Promise<CheckResult> {
    try {
      return await run(input);
    } catch {
      return { verdict: 'INTERNAL_ERROR', anchor: 'none', endpoint: null, jwks: null, header: null, claims: null, keys: null };
    }
  }

  return {
    run: safeRun,

    async trusted(input) {
      const result = await safeRun(input);
      if (result.verdict === 'VALID') {
        if (config.mode === 'report') log('tokenCheck: VALID (report mode)');
        return input.accessToken;
      }
      if (config.mode === 'enforce') {
        log(`tokenCheck: REJECTED ${result.verdict}`);
        return null;
      }
      log(`tokenCheck: report mode, would reject: ${result.verdict}`);
      return input.accessToken || null;
    },

    async report(input) {
      const result = await safeRun(input);
      const exp = num(result.claims?.['exp']);
      const iat = num(result.claims?.['iat']);

      let tamper: TokenCheckReport['tamper'] = null;
      const altered = input.accessToken ? tamperPayload(input.accessToken) : null;
      if (altered && result.keys) {
        const probe = verifySignedToken(altered, result.keys, { nowSec: nowSec() });
        tamper = probe.ok ? { verdict: 'ACCEPTED', rejected: false } : { verdict: probe.reason, rejected: probe.reason === 'BAD_SIGNATURE' };
      }

      const pin = config.rayfinEndpoint.trim();
      return {
        mode: config.mode,
        anchor: result.anchor,
        endpoint: result.endpoint,
        requestEndpoint: input.baseUrl,
        pinMatchesRequest: pin ? normalise(pin) === normalise(input.baseUrl) : null,
        configProblem: configProblem(config),
        verdict: result.verdict,
        header: result.header ? { alg: str(result.header['alg']), kid: str(result.header['kid']), typ: str(result.header['typ']) } : null,
        expiresInSec: exp === null ? null : Math.round(exp - nowSec()),
        lifetimeSec: exp !== null && iat !== null ? Math.round(exp - iat) : null,
        jwks: result.jwks,
        tamper,
      };
    },
  };
}

// The checker the deployed functions use: the shipped configuration, a key cache that lives as long as the
// function instance, the platform's `fetch`, and the function log.
const defaultChecker = createTokenChecker({
  config: TOKEN_CHECK,
  keys: createKeyStore(),
  nowSec: () => Math.floor(Date.now() / 1000),
  log: (message) => console.log(message),
});

/**
 * The invocation token if it is trusted, else `null`. Every function that acts for a person passes
 * `await trustedAccessToken(ctx)` to `callerId` (through its `run*` module), never `ctx.accessToken`;
 * `tokenverify.spec.ts` fails if a handler in `function_app.ts` breaks that rule.
 */
export const trustedAccessToken = (ctx: TokenInput): Promise<string | null> => defaultChecker.trusted(ctx);

/** Spike S8: what the check saw, for the Who-am-I card. */
export const tokenCheckReport = (ctx: TokenInput): Promise<TokenCheckReport> => defaultChecker.report(ctx);
