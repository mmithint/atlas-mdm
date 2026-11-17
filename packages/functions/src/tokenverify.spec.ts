import { createHmac, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { TOKEN_CHECK, type TokenCheckConfig } from './config.js';
import {
  configProblem,
  createKeyStore,
  createTokenChecker,
  parseJwt,
  subScopeOf,
  tamperPayload,
  verifySignedToken,
  type Jwk,
  type JwkSet,
  type TokenInput,
} from './tokenverify.js';

// ---- synthetic keys and tokens: everything here is made up on the spot -----------------------------------------

const GUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ID = '11111111-2222-3333-4444-555555555555';
const SCOPE = '/eid1/c/pub/t/TENANT/a/APP/workspaces/WS/projects/PROJ';
const SUB = `${SCOPE}/users/${ID}`;
const NOW = 1_800_000_000; // seconds

interface TestKey {
  privateKey: KeyObject;
  set: JwkSet;
}

/**
 * `RS256` (the default) is what the deployed app's token uses, so the default key is a 2048-bit RSA key and its JWK
 * has no `alg` field, like the key set measured in S8. `ES256` is the self-hosted Rayfin service's algorithm.
 */
function makeKey(kid = 'k1', alg: 'RS256' | 'ES256' = 'RS256', modulusLength = 2048): TestKey {
  if (alg === 'ES256') {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    return { privateKey, set: { keys: [{ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid, x: jwk.x, y: jwk.y }] } };
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, set: { keys: [{ kty: 'RSA', use: 'sig', kid, n: jwk.n, e: jwk.e }] } };
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/** Signs with whatever the key is: ECDSA in the 64-byte JWS form (or DER), RSA PKCS#1 v1.5. The header says what it says. */
function signToken(
  key: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = { alg: key.asymmetricKeyType === 'ec' ? 'ES256' : 'RS256', kid: 'k1', typ: 'JWT' },
  encoding: 'ieee-p1363' | 'der' = 'ieee-p1363'
): string {
  const input = `${b64(header)}.${b64(claims)}`;
  const data = Buffer.from(input);
  const signature = key.asymmetricKeyType === 'ec' ? sign('sha256', data, { key, dsaEncoding: encoding }) : sign('sha256', data, key);
  return `${input}.${signature.toString('base64url')}`;
}

const goodClaims = { sub: SUB, iss: 'https://rayfin.example.test', aud: 'atlas', iat: NOW - 60, exp: NOW + 3_000 };
const OPTIONS = { nowSec: NOW };

// ---- the pure check --------------------------------------------------------------------------------------------

describe('verifySignedToken', () => {
  const key = makeKey();

  it('accepts a token signed by a key in the set', () => {
    const verdict = verifySignedToken(signToken(key.privateKey, goodClaims), key.set, OPTIONS);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.kid).toBe('k1');
  });

  it('refuses a token whose payload was changed after signing', () => {
    const token = signToken(key.privateKey, goodClaims);
    const altered = tamperPayload(token) as string;
    expect(altered).not.toBe(token);
    expect(verifySignedToken(altered, key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('refuses a token signed by another key that claims the same key id', () => {
    const other = makeKey('k1');
    expect(verifySignedToken(signToken(other.privateKey, goodClaims), key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('accepts a key set shaped like the one the platform publishes (extra fields, other keys, no alg)', () => {
    const extra = makeKey('other');
    const set: JwkSet = {
      keys: [
        { ...extra.set.keys[0]!, x5t: 'thumbprint', x5c: ['MIIC...'], issuer: 'https://login.example.test/' } as JwkSet['keys'][number],
        ...key.set.keys.map((k) => ({ ...k, x5t: 'thumbprint', x5c: ['MIIC...'] }) as JwkSet['keys'][number]),
      ],
    };
    expect(verifySignedToken(signToken(key.privateKey, goodClaims), set, OPTIONS).ok).toBe(true);
  });

  describe('the algorithm is pinned to RS256 and ES256', () => {
    it('refuses an unsigned token (alg none), with or without a signature part', () => {
      const unsigned = `${b64({ alg: 'none', kid: 'k1' })}.${b64(goodClaims)}.`;
      expect(verifySignedToken(unsigned, key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'ALG_NOT_ALLOWED' });
      expect(verifySignedToken(`${unsigned}c2ln`, key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'ALG_NOT_ALLOWED' });
    });

    it('refuses HS256 signed with the PUBLIC key as the secret (the classic confusion attack), in JWK and PEM form', () => {
      const input = `${b64({ alg: 'HS256', kid: 'k1' })}.${b64(goodClaims)}`;
      const pem = createPublicKey(key.privateKey).export({ type: 'spki', format: 'pem' }).toString();
      for (const secret of [JSON.stringify(key.set.keys[0]), pem, key.set.keys[0]!.n!]) {
        const mac = createHmac('sha256', secret).update(input).digest('base64url');
        expect(verifySignedToken(`${input}.${mac}`, key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'ALG_NOT_ALLOWED' });
      }
    });

    it('refuses every other algorithm, including RSA-PSS and the longer hashes, and lower-case spellings', () => {
      for (const alg of ['rs256', 'RS384', 'RS512', 'PS256', 'PS384', 'ES384', 'ES512', 'es256', 'HS256', 'EdDSA', '', 256, null]) {
        const token = signToken(key.privateKey, goodClaims, { alg, kid: 'k1' });
        expect(verifySignedToken(token, key.set, OPTIONS), String(alg)).toMatchObject({ ok: false, reason: 'ALG_NOT_ALLOWED' });
      }
      expect(verifySignedToken(signToken(key.privateKey, goodClaims, { kid: 'k1' }), key.set, OPTIONS)).toMatchObject({ reason: 'ALG_NOT_ALLOWED' });
    });
  });

  describe('RS256 signature', () => {
    const good = signToken(key.privateKey, goodClaims);
    const [h = '', p = ''] = good.split('.');

    it('refuses a signature of the wrong length, an empty one, and one made over other bytes', () => {
      const sig = good.split('.')[2] as string;
      expect(verifySignedToken(`${h}.${p}.${sig.slice(0, -4)}`, key.set, OPTIONS)).toMatchObject({ reason: 'BAD_SIGNATURE' });
      expect(verifySignedToken(`${h}.${p}.`, key.set, OPTIONS)).toMatchObject({ reason: 'BAD_SIGNATURE' });
      const other = signToken(key.privateKey, { ...goodClaims, sub: `${SCOPE}/users/99999999-2222-3333-4444-555555555555` });
      expect(verifySignedToken(`${h}.${p}.${other.split('.')[2]}`, key.set, OPTIONS)).toMatchObject({ reason: 'BAD_SIGNATURE' });
    });

    it('refuses an RSA key smaller than 2048 bits, even though the key set lists it', () => {
      const small = makeKey('k1', 'RS256', 1024);
      expect(verifySignedToken(signToken(small.privateKey, goodClaims), small.set, OPTIONS)).toMatchObject({ ok: false, reason: 'KEY_NOT_FOUND' });
    });
  });

  describe('ES256 (what the self-hosted Rayfin service signs with)', () => {
    const ec = makeKey('k1', 'ES256');

    it('accepts a token signed by a key in the set, and refuses a changed payload', () => {
      const token = signToken(ec.privateKey, goodClaims);
      expect(verifySignedToken(token, ec.set, OPTIONS).ok).toBe(true);
      expect(verifySignedToken(tamperPayload(token) as string, ec.set, OPTIONS)).toMatchObject({ reason: 'BAD_SIGNATURE' });
    });

    it('refuses a signature in DER form: a JWS signature is the raw 64 bytes', () => {
      const token = signToken(ec.privateKey, goodClaims, undefined, 'der');
      expect(verifySignedToken(token, ec.set, OPTIONS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('refuses a token signed by another key that claims the same key id', () => {
      expect(verifySignedToken(signToken(makeKey('k1', 'ES256').privateKey, goodClaims), ec.set, OPTIONS)).toMatchObject({ reason: 'BAD_SIGNATURE' });
    });

    it('ignores an EC key on another curve, marked for another algorithm or use, or without its point', () => {
      const base = ec.set.keys[0]!;
      const { x: _x, ...noX } = base;
      const variants: Jwk[] = [{ ...base, crv: 'P-384' }, { ...base, alg: 'RS256' }, { ...base, use: 'enc' }, noX];
      for (const variant of variants) {
        expect(verifySignedToken(signToken(ec.privateKey, goodClaims), { keys: [variant] }, OPTIONS)).toMatchObject({ reason: 'KEY_NOT_FOUND' });
      }
    });
  });

  describe('the algorithm and the key type must match', () => {
    it('an ES256 token cannot be checked with an RSA key, nor an RS256 token with an EC key', () => {
      const ec = makeKey('k1', 'ES256');
      expect(verifySignedToken(signToken(key.privateKey, goodClaims, { alg: 'ES256', kid: 'k1' }), key.set, OPTIONS)).toMatchObject({ reason: 'KEY_NOT_FOUND' });
      expect(verifySignedToken(signToken(ec.privateKey, goodClaims, { alg: 'RS256', kid: 'k1' }), ec.set, OPTIONS)).toMatchObject({ reason: 'KEY_NOT_FOUND' });
    });
  });

  describe('the key', () => {
    it('refuses a token without a key id, or with one the set does not hold', () => {
      expect(verifySignedToken(signToken(key.privateKey, goodClaims, { alg: 'RS256' }), key.set, OPTIONS)).toMatchObject({ reason: 'NO_KID' });
      expect(verifySignedToken(signToken(key.privateKey, goodClaims, { alg: 'RS256', kid: '' }), key.set, OPTIONS)).toMatchObject({ reason: 'NO_KID' });
      expect(verifySignedToken(signToken(key.privateKey, goodClaims, { alg: 'RS256', kid: 'nope' }), key.set, OPTIONS)).toMatchObject({ reason: 'KEY_NOT_FOUND' });
    });

    it('ignores keys of the wrong type, algorithm or use, or without their numbers', () => {
      const base = key.set.keys[0]!;
      const { n: _n, ...noModulus } = base;
      const { e: _e, ...noExponent } = base;
      const variants: Jwk[] = [{ ...base, kty: 'EC' }, { ...base, kty: 'oct' }, { ...base, alg: 'ES256' }, { ...base, use: 'enc' }, noModulus, noExponent];
      for (const variant of variants) {
        expect(verifySignedToken(signToken(key.privateKey, goodClaims), { keys: [variant] }, OPTIONS)).toMatchObject({ reason: 'KEY_NOT_FOUND' });
      }
    });

    it('accepts a key that declares alg RS256 or use sig, as some key sets do', () => {
      const base = key.set.keys[0]!;
      const set: JwkSet = { keys: [{ ...base, alg: 'RS256', use: 'sig' }] };
      expect(verifySignedToken(signToken(key.privateKey, goodClaims), set, OPTIONS).ok).toBe(true);
    });

    it('treats unusable key material as no key', () => {
      const set: JwkSet = { keys: [{ ...key.set.keys[0]!, n: 'AAAA', e: 'AAAA' }] };
      expect(verifySignedToken(signToken(key.privateKey, goodClaims), set, OPTIONS)).toMatchObject({ ok: false });
    });
  });

  describe('shape', () => {
    it.each([
      ['not three parts', 'a.b'],
      ['four parts', 'a.b.c.d'],
      ['characters outside base64url', 'a+b.c/d.e=='],
      ['a header that is not JSON', `${Buffer.from('nope').toString('base64url')}.${b64({})}.AAAA`],
      ['a payload that is an array', `${b64({ alg: 'ES256', kid: 'k1' })}.${b64([1])}.AAAA`],
      ['nothing', ''],
    ])('refuses %s as malformed', (_label, token) => {
      expect(verifySignedToken(token, key.set, OPTIONS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    });

    it('parseJwt returns the signed bytes and the decoded parts', () => {
      const token = signToken(key.privateKey, goodClaims);
      const parsed = parseJwt(token);
      expect(parsed?.claims['sub']).toBe(SUB);
      expect(parsed?.signingInput).toBe(token.slice(0, token.lastIndexOf('.')));
      expect(parsed?.signature.length).toBe(256); // RS256 with a 2048-bit key
    });
  });

  describe('time', () => {
    it('requires exp', () => {
      const { exp: _exp, ...noExp } = goodClaims;
      expect(verifySignedToken(signToken(key.privateKey, noExp), key.set, OPTIONS)).toMatchObject({ reason: 'NO_EXPIRY' });
      expect(verifySignedToken(signToken(key.privateKey, { ...goodClaims, exp: '9999999999' }), key.set, OPTIONS)).toMatchObject({ reason: 'NO_EXPIRY' });
    });

    it('refuses an expired token but allows 60 seconds of clock difference', () => {
      expect(verifySignedToken(signToken(key.privateKey, { ...goodClaims, exp: NOW - 61 }), key.set, OPTIONS)).toMatchObject({ reason: 'EXPIRED' });
      expect(verifySignedToken(signToken(key.privateKey, { ...goodClaims, exp: NOW - 30 }), key.set, OPTIONS).ok).toBe(true);
    });

    it('refuses a token that is not valid yet (nbf), allowing the same difference', () => {
      expect(verifySignedToken(signToken(key.privateKey, { ...goodClaims, nbf: NOW + 120 }), key.set, OPTIONS)).toMatchObject({ reason: 'NOT_YET_VALID' });
      expect(verifySignedToken(signToken(key.privateKey, { ...goodClaims, nbf: NOW + 30 }), key.set, OPTIONS).ok).toBe(true);
    });
  });

  describe('pins', () => {
    const token = signToken(key.privateKey, goodClaims);

    it('accepts a token that matches every pin', () => {
      expect(verifySignedToken(token, key.set, { ...OPTIONS, issuer: goodClaims.iss, audience: 'atlas', subScope: SCOPE }).ok).toBe(true);
    });

    it('refuses a wrong issuer, audience or scope', () => {
      expect(verifySignedToken(token, key.set, { ...OPTIONS, issuer: 'https://elsewhere.example.test' })).toMatchObject({ reason: 'WRONG_ISSUER' });
      expect(verifySignedToken(token, key.set, { ...OPTIONS, audience: 'other' })).toMatchObject({ reason: 'WRONG_AUDIENCE' });
      expect(verifySignedToken(token, key.set, { ...OPTIONS, subScope: `${SCOPE}-other` })).toMatchObject({ reason: 'WRONG_SCOPE' });
    });

    it('finds the audience inside a list and compares the scope without regard to letter case', () => {
      const listed = signToken(key.privateKey, { ...goodClaims, aud: ['x', 'atlas'] });
      expect(verifySignedToken(listed, key.set, { ...OPTIONS, audience: 'atlas' }).ok).toBe(true);
      expect(verifySignedToken(token, key.set, { ...OPTIONS, subScope: SCOPE.toUpperCase() }).ok).toBe(true);
    });

    it('refuses when a pin is set and the claim is missing or not a user path', () => {
      const bare = signToken(key.privateKey, { exp: goodClaims.exp });
      expect(verifySignedToken(bare, key.set, { ...OPTIONS, issuer: 'x' })).toMatchObject({ reason: 'WRONG_ISSUER' });
      expect(verifySignedToken(bare, key.set, { ...OPTIONS, audience: 'x' })).toMatchObject({ reason: 'WRONG_AUDIENCE' });
      expect(verifySignedToken(bare, key.set, { ...OPTIONS, subScope: SCOPE })).toMatchObject({ reason: 'WRONG_SCOPE' });
    });
  });
});

describe('subScopeOf', () => {
  it('is the part of sub before /users/<guid>', () => {
    expect(subScopeOf(SUB)).toBe(SCOPE);
  });
  it.each([[undefined], [42], [''], ['/eid1/users/alice'], [`${SUB}/extra`]])('is null for %s', (sub) => {
    expect(subScopeOf(sub)).toBeNull();
  });
});

// ---- the key set -----------------------------------------------------------------------------------------------

const ENDPOINT = 'https://rayfin.example.test/webapi/items/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function jwksResponse(set: JwkSet, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(set), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('createKeyStore', () => {
  const key = makeKey();

  it('asks <endpoint>/.well-known/jwks.json with the Rayfin client headers', async () => {
    const fetchFn = vi.fn(async () => jwksResponse(key.set));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch });
    const got = await store.get({ endpoint: `${ENDPOINT}/`, publishableKey: 'pk-test' });

    expect(got.keys).toEqual(key.set);
    expect(got.info).toMatchObject({ status: 200, keyCount: 1, kids: ['k1'], algs: [''], kinds: ['RSA'], fromCache: false, stale: false, error: null });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${ENDPOINT}/.well-known/jwks.json`);
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'X-Publishable-Key': 'pk-test',
      'x-ms-workload-resource-moniker': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  it('answers from memory inside the TTL and downloads again after it', async () => {
    const c = clock();
    const fetchFn = vi.fn(async () => jwksResponse(key.set));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch, nowMs: c.now, ttlMs: 600_000 });
    const source = { endpoint: ENDPOINT, publishableKey: 'pk' };

    await store.get(source);
    c.advance(599_000);
    expect((await store.get(source)).info.fromCache).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    c.advance(2_000);
    expect((await store.get(source)).info.fromCache).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('lets callers that arrive together share one download', async () => {
    const fetchFn = vi.fn(async () => jwksResponse(key.set));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch });
    const source = { endpoint: ENDPOINT, publishableKey: 'pk' };
    const all = await Promise.all([store.get(source), store.get(source), store.get(source)]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(all.every((r) => r.keys !== null)).toBe(true);
  });

  it('with no keys yet, reports the failure and does not retry before the retry delay', async () => {
    const c = clock();
    const fetchFn = vi.fn(async () => new Response('nope', { status: 503 }));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch, nowMs: c.now, retryAfterMs: 30_000 });
    const source = { endpoint: ENDPOINT, publishableKey: 'pk' };

    const first = await store.get(source);
    expect(first.keys).toBeNull();
    expect(first.info).toMatchObject({ status: 503, error: 'Error: HTTP 503' });

    c.advance(10_000);
    expect((await store.get(source)).keys).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    c.advance(25_000);
    await store.get(source);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps using the old keys, marked stale, when a refresh fails', async () => {
    const c = clock();
    let fail = false;
    const fetchFn = vi.fn(async () => (fail ? new Response('x', { status: 500 }) : jwksResponse(key.set)));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch, nowMs: c.now, ttlMs: 600_000, retryAfterMs: 30_000 });
    const source = { endpoint: ENDPOINT, publishableKey: 'pk' };

    await store.get(source);
    fail = true;
    c.advance(700_000);
    const later = await store.get(source);
    expect(later.keys).toEqual(key.set);
    expect(later.info).toMatchObject({ stale: true, error: 'Error: HTTP 500' });
  });

  it('refuses an answer that is not a key set, and a network error, without throwing', async () => {
    const odd = createKeyStore({ fetchFn: (async () => new Response('{"hello":1}', { status: 200 })) as unknown as typeof fetch });
    expect((await odd.get({ endpoint: ENDPOINT, publishableKey: 'pk' })).info.error).toContain('not a key set');

    const html = createKeyStore({ fetchFn: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch });
    expect((await html.get({ endpoint: ENDPOINT, publishableKey: 'pk' })).keys).toBeNull();

    const down = createKeyStore({ fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    expect((await down.get({ endpoint: ENDPOINT, publishableKey: 'pk' })).info.error).toContain('fetch failed');
  });

  it('describes each key by its type, and carries the RSA numbers through', async () => {
    const ec = makeKey('e1', 'ES256');
    const set: JwkSet = { keys: [...key.set.keys, ...ec.set.keys] };
    const store = createKeyStore({ fetchFn: (async () => jwksResponse(set)) as unknown as typeof fetch });
    const got = await store.get({ endpoint: ENDPOINT, publishableKey: 'pk' });
    expect(got.info).toMatchObject({ kids: ['k1', 'e1'], algs: ['', 'ES256'], kinds: ['RSA', 'EC/P-256'] });
    expect(got.keys?.keys[0]).toMatchObject({ kty: 'RSA', n: key.set.keys[0]!.n, e: key.set.keys[0]!.e });
  });

  it('honours a refresh request, but not more often than the retry delay', async () => {
    const c = clock();
    const fetchFn = vi.fn(async () => jwksResponse(key.set));
    const store = createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch, nowMs: c.now, retryAfterMs: 30_000 });
    const source = { endpoint: ENDPOINT, publishableKey: 'pk' };

    await store.get(source);
    await store.get(source, { refresh: true }); // too soon
    expect(fetchFn).toHaveBeenCalledTimes(1);
    c.advance(31_000);
    await store.get(source, { refresh: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// ---- the checker as the functions use it ----------------------------------------------------------------------

const PINNED: TokenCheckConfig = { mode: 'enforce', rayfinEndpoint: ENDPOINT, issuer: goodClaims.iss, audience: goodClaims.aud, subScope: SCOPE };

function setup(config: TokenCheckConfig, set: JwkSet, extra: { fetchFn?: typeof fetch } = {}) {
  const fetchFn = vi.fn(extra.fetchFn ?? (async () => jwksResponse(set)));
  const log = vi.fn();
  const c = clock();
  const checker = createTokenChecker({
    config,
    keys: createKeyStore({ fetchFn: fetchFn as unknown as typeof fetch, nowMs: c.now }),
    nowSec: () => NOW,
    log,
  });
  return { checker, fetchFn, log, c };
}

const input = (accessToken: string, baseUrl = ENDPOINT): TokenInput => ({ accessToken, baseUrl, publishableKey: 'pk-test' });

describe('createTokenChecker', () => {
  const key = makeKey();
  const good = signToken(key.privateKey, goodClaims);

  it('enforce: returns the token when it verifies', async () => {
    const { checker } = setup(PINNED, key.set);
    expect(await checker.trusted(input(good))).toBe(good);
  });

  it('enforce: returns null for a forged, expired, empty or out-of-scope token, and logs only a reason code', async () => {
    const { checker, log } = setup(PINNED, key.set);
    const forged = signToken(makeKey().privateKey, goodClaims);
    const expired = signToken(key.privateKey, { ...goodClaims, exp: NOW - 600 });
    const elsewhere = signToken(key.privateKey, { ...goodClaims, sub: `/eid1/c/pub/t/OTHER/users/${ID}` });

    for (const token of [forged, expired, elsewhere, '', 'garbage']) {
      expect(await checker.trusted(input(token))).toBeNull();
    }
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('REJECTED BAD_SIGNATURE');
    expect(logged).toContain('REJECTED EXPIRED');
    expect(logged).toContain('REJECTED WRONG_SCOPE');
    expect(logged).not.toContain(good);
    expect(logged).not.toContain(ID);
  });

  it('enforce: fetches keys from the PINNED endpoint and ignores the endpoint named in the request', async () => {
    const { checker, fetchFn } = setup(PINNED, key.set);
    await checker.trusted(input(good, 'https://attacker.example.test/'));
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url.startsWith(ENDPOINT)).toBe(true);
    expect(url).not.toContain('attacker');
  });

  it('enforce: a token signed by the attacker is refused even when the request names the attacker\'s key endpoint', async () => {
    const attacker = makeKey();
    const forged = signToken(attacker.privateKey, goodClaims);
    const fetchFn = async (url: string | URL | Request) =>
      String(url).includes('attacker') ? jwksResponse(attacker.set) : jwksResponse(key.set);
    const { checker } = setup(PINNED, key.set, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(await checker.trusted(input(forged, 'https://attacker.example.test/'))).toBeNull();
  });

  it('enforce: with no keys obtainable, fails closed', async () => {
    const { checker } = setup(PINNED, key.set, { fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    const result = await checker.run(input(good));
    expect(result.verdict).toBe('KEYS_UNAVAILABLE');
    expect(await checker.trusted(input(good))).toBeNull();
  });

  it('enforce: without a pinned endpoint or any one of the three claim pins it refuses everything and never uses the request\'s endpoint', async () => {
    for (const config of [
      { ...PINNED, rayfinEndpoint: '' },
      { ...PINNED, rayfinEndpoint: 'http://rayfin.example.test' },
      { ...PINNED, issuer: '' },
      { ...PINNED, audience: '' },
      { ...PINNED, subScope: '' },
    ]) {
      const { checker, fetchFn } = setup(config, key.set);
      expect((await checker.run(input(good))).verdict).toBe('NOT_CONFIGURED');
      expect(await checker.trusted(input(good))).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('heals a key rotation: an unknown key id triggers one more download', async () => {
    const rotated = makeKey('k2');
    let current: JwkSet = key.set;
    const { checker, fetchFn, c } = setup(PINNED, key.set, { fetchFn: (async () => jwksResponse(current)) as unknown as typeof fetch });

    expect(await checker.trusted(input(good))).toBe(good); // keys cached
    current = rotated.set; // the service rotates
    c.advance(31_000);
    const token = signToken(rotated.privateKey, goodClaims, { alg: 'RS256', kid: 'k2' });
    expect(await checker.trusted(input(token))).toBe(token);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not download again for every token with an unknown key id', async () => {
    const { checker, fetchFn } = setup(PINNED, key.set);
    await checker.trusted(input(good));
    const stray = signToken(key.privateKey, goodClaims, { alg: 'RS256', kid: 'nope' });
    for (let i = 0; i < 5; i += 1) expect(await checker.trusted(input(stray))).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('report mode: accepts the token whatever the check says, and logs what enforce would do', async () => {
    const { checker, log } = setup({ ...PINNED, mode: 'report' }, key.set);
    const forged = signToken(makeKey().privateKey, goodClaims);
    expect(await checker.trusted(input(forged))).toBe(forged);
    expect(await checker.trusted(input(good))).toBe(good);
    const logged = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('report mode, would reject: BAD_SIGNATURE');
    expect(logged).toContain('VALID (report mode)');
  });

  it('report mode with nothing pinned: learns from the request\'s https endpoint, nothing else', async () => {
    const config: TokenCheckConfig = { mode: 'report', rayfinEndpoint: '', issuer: '', audience: '', subScope: '' };
    const { checker, fetchFn } = setup(config, key.set);
    const result = await checker.run(input(good));
    expect(result).toMatchObject({ verdict: 'VALID', anchor: 'request', endpoint: ENDPOINT });
    expect(String((fetchFn.mock.calls[0] as unknown[])[0]).startsWith(ENDPOINT)).toBe(true);

    const plain = setup(config, key.set);
    expect((await plain.checker.run(input(good, 'http://rayfin.example.test'))).verdict).toBe('NOT_CONFIGURED');
  });

  it('never throws: an internal failure is a refusal in enforce mode', async () => {
    const broken = createTokenChecker({
      config: PINNED,
      keys: { get: async () => { throw new Error('boom'); } },
      nowSec: () => NOW,
      log: () => undefined,
    });
    expect((await broken.run(input(good))).verdict).toBe('INTERNAL_ERROR');
    expect(await broken.trusted(input(good))).toBeNull();
  });

  describe('report (the S8 spike answer)', () => {
    it('shows reason codes, key ids and timings, proves the check refuses a tampered token, and never carries the token', async () => {
      const { checker } = setup({ ...PINNED, mode: 'report' }, key.set);
      const report = await checker.report(input(good));

      expect(report).toMatchObject({
        mode: 'report',
        anchor: 'pinned',
        endpoint: ENDPOINT,
        requestEndpoint: ENDPOINT,
        pinMatchesRequest: true,
        configProblem: null,
        verdict: 'VALID',
        header: { alg: 'RS256', kid: 'k1', typ: 'JWT' },
        lifetimeSec: 3_060,
        expiresInSec: 3_000,
        tamper: { verdict: 'BAD_SIGNATURE', rejected: true },
      });
      expect(report.jwks).toMatchObject({ status: 200, keyCount: 1, kids: ['k1'], kinds: ['RSA'] });

      const text = JSON.stringify(report);
      expect(text).not.toContain(good);
      expect(text).not.toContain(good.split('.')[2] as string);
      expect(text).not.toContain(ID);
    });

    it('a token shaped like the platform\'s (RS256, Entra-style claims, a day-long life) passes all three pins', async () => {
      const tid = '00000000-0000-4000-8000-00000000000a';
      const scope = '/eid1/c/pub/t/FAKETENANT/a/FAKEAPP/workspaces/00000000-0000-4000-8000-0000000000b1/projects/00000000-0000-4000-8000-0000000000c2';
      const claims = {
        sub: `${scope}/users/${ID}`,
        tid,
        iss: `https://sts.windows.net/${tid}/`,
        aud: '00000000-0000-4000-8000-0000000000d3',
        appid: '00000000-0000-4000-8000-0000000000d3',
        iat: NOW - 1_200,
        nbf: NOW - 1_200,
        exp: NOW - 1_200 + 86_700,
      };
      const token = signToken(key.privateKey, claims);
      const config: TokenCheckConfig = { mode: 'report', rayfinEndpoint: ENDPOINT, issuer: claims.iss, audience: claims.aud, subScope: scope };

      const report = await setup(config, key.set).checker.report(input(token));
      expect(report).toMatchObject({ verdict: 'VALID', anchor: 'pinned', pinMatchesRequest: true, lifetimeSec: 86_700, tamper: { rejected: true } });
      expect(await setup({ ...config, mode: 'enforce' }, key.set).checker.trusted(input(token))).toBe(token);

      // the same token, but one pin names another tenant, app or project: refused
      for (const wrong of [{ issuer: 'https://sts.windows.net/other/' }, { audience: 'other' }, { subScope: `${scope}-2` }]) {
        expect(await setup({ ...config, ...wrong, mode: 'enforce' }, key.set).checker.trusted(input(token))).toBeNull();
      }
    });

    it('says why enforce could not run, and what to pin', async () => {
      const config: TokenCheckConfig = { mode: 'enforce', rayfinEndpoint: '', issuer: '', audience: '', subScope: '' };
      const { checker } = setup(config, key.set);
      const report = await checker.report(input(good));
      expect(report).toMatchObject({ verdict: 'NOT_CONFIGURED', requestEndpoint: ENDPOINT, pinMatchesRequest: null });
      expect(report.configProblem).toContain('pinned');
    });

    it('flags a pin that differs from the endpoint the request names', async () => {
      const { checker } = setup({ ...PINNED, mode: 'report', rayfinEndpoint: 'https://pinned.example.test' }, key.set);
      expect((await checker.report(input(good))).pinMatchesRequest).toBe(false);
    });
  });
});

// ---- the shipped configuration and the handler rule -----------------------------------------------------------

describe('the shipped configuration', () => {
  it('can run in its mode (enforce is only allowed with a pinned endpoint and all three claim pins)', () => {
    expect(configProblem(TOKEN_CHECK)).toBeNull();
  });

  it('configProblem names what is missing for enforce', () => {
    expect(configProblem({ mode: 'report', rayfinEndpoint: '', issuer: '', audience: '', subScope: '' })).toBeNull();
    expect(configProblem({ mode: 'enforce', rayfinEndpoint: '', issuer: 'x', audience: 'x', subScope: 'x' })).toContain('rayfinEndpoint');
    expect(configProblem({ mode: 'enforce', rayfinEndpoint: ENDPOINT, issuer: '', audience: 'x', subScope: 'x' })).toContain('issuer');
    expect(configProblem({ mode: 'enforce', rayfinEndpoint: ENDPOINT, issuer: 'x', audience: ' ', subScope: 'x' })).toContain('audience');
    expect(configProblem({ mode: 'enforce', rayfinEndpoint: ENDPOINT, issuer: 'x', audience: 'x', subScope: '' })).toContain('subScope');
    expect(configProblem({ mode: 'enforce', rayfinEndpoint: ENDPOINT, issuer: '', audience: '', subScope: '' })).toContain('issuer, audience, subScope');
    expect(configProblem(PINNED)).toBeNull();
  });

  // Typing a pin wrongly in `enforce` locks everyone out, so the shipped values are checked for shape here, offline.
  const pinned = TOKEN_CHECK.rayfinEndpoint !== '';
  const guid = new RegExp(`^${GUID_PATTERN}$`, 'i');

  it.skipIf(!pinned)('the pins are well formed: https endpoint, issuer URL, audience id, and a scope that is not a whole sub', () => {
    expect(new URL(TOKEN_CHECK.rayfinEndpoint).protocol).toBe('https:');
    expect(TOKEN_CHECK.rayfinEndpoint).not.toMatch(/\/$|\s/);
    expect(new URL(TOKEN_CHECK.issuer).protocol).toBe('https:');
    expect(TOKEN_CHECK.audience).toMatch(guid);
    expect(TOKEN_CHECK.subScope).not.toMatch(/\/users\//);
    expect(TOKEN_CHECK.subScope).not.toMatch(/\s|\/$/);
    // a scope is what is left of a user's `sub` once `/users/<id>` is taken off
    expect(subScopeOf(`${TOKEN_CHECK.subScope}/users/${ID}`)).toBe(TOKEN_CHECK.subScope);
  });

  it.skipIf(!pinned)('the endpoint and the scope name the same workspace and project (a mixed-up paste shows here)', () => {
    const endpoint = TOKEN_CHECK.rayfinEndpoint;
    const workspace = /\/workspaces\/([0-9a-f-]{36})\//i.exec(endpoint)?.[1];
    const project = /\/appbackends\/([0-9a-f-]{36})\//i.exec(endpoint)?.[1];
    expect(workspace).toMatch(guid);
    expect(project).toMatch(guid);
    expect(TOKEN_CHECK.subScope.toLowerCase()).toContain(`/workspaces/${workspace?.toLowerCase()}/projects/${project?.toLowerCase()}`);
  });

  it('when some pin is set, all of them are (a half-filled config is a typo)', () => {
    const set = [TOKEN_CHECK.rayfinEndpoint, TOKEN_CHECK.issuer, TOKEN_CHECK.audience, TOKEN_CHECK.subScope].map((v) => v !== '');
    expect(new Set(set).size).toBe(1);
  });
});

describe('function_app.ts', () => {
  const source = readFileSync(new URL('./function_app.ts', import.meta.url), 'utf8');
  // One chunk per `udf.func(` registration, keyed by the function name.
  const handlers = source
    .split(/\nudf\.func\(\s*\n?\s*'/)
    .slice(1)
    .map((chunk) => ({ name: chunk.slice(0, chunk.indexOf("'")), body: chunk }));

  it('registers the handlers it is expected to check', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(13);
  });

  it('no handler but the S1/S8 spike reads the raw ctx.accessToken', () => {
    const raw = handlers.filter((h) => h.body.replace(/\/\/.*$/gm, '').includes('ctx.accessToken')).map((h) => h.name);
    expect(raw).toEqual(['whoAmI']);
  });

  it('every handler that runs as a person passes the verified token on', () => {
    const acting = handlers.filter((h) => /\b(run[A-Z]\w+|loadMyProfile)\(/.test(h.body));
    expect(acting.length).toBeGreaterThanOrEqual(10);
    for (const handler of acting) {
      expect(handler.body, handler.name).toContain('await trustedAccessToken(ctx)');
    }
  });
});
