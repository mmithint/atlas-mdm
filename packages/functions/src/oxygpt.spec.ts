import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OXYGPT } from './config.js';
import {
  classifyFailure,
  isPrivateAddress,
  modelIdsOf,
  replyTextOf,
  runOxygptProbe,
  SECRET_API_KEY,
  SECRET_MODEL_ID,
  type OxygptDeps,
  type OxygptSettings,
} from './oxygpt.js';
import { emptyProfile, type MyProfile } from './profile.js';

// Everything here is made up on the spot: a fake key, fake model IDs, a fake host. No real service is called.
const KEY = 'sk-test-0123456789abcdef-NOT-A-REAL-KEY';
const MODEL = 'Test-Agent-1'; // what the secret OXYGPT_AGENT_MODEL_ID holds in these tests
const FALLBACK_MODEL = 'Fallback-Agent'; // what config.ts holds in these tests
const BASE = 'https://oxygpt.example.test';
const TOKEN = 'verified-token-stand-in';

const SETTINGS: OxygptSettings = {
  baseUrl: `${BASE}/`,
  modelId: FALLBACK_MODEL,
  listTimeoutMs: 1_000,
  textTimeoutMs: 1_000,
  maxPromptChars: 50,
  maxReplyChars: 20,
  agentStepTimeoutMs: 1_000,
  agentStartTimeoutMs: 1_000,
  agentTotalMs: 10_000,
  agentCleanupMs: 1_000,
  agentPollMs: 10,
};

const admin: MyProfile = { ...emptyProfile('OK', 'id', 'tester@example.test', 'Tester'), canManageAdmin: true };
const viewer: MyProfile = { ...emptyProfile('OK', 'id', 'tester@example.test', 'Tester'), canView: true };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const completion = (content: unknown, extra: Record<string, unknown> = {}): Response =>
  json({ choices: [{ message: { content } }], ...extra });

const failure = (code: string, name = 'TypeError', message = 'fetch failed'): Error =>
  Object.assign(new Error(message), { name, cause: Object.assign(new Error(code), { code }) });

function run(
  input: { mode: string; prompt?: string },
  parts: Partial<OxygptDeps> & { key?: () => string; model?: () => string; token?: string | null } = {}
) {
  const fetchFn = vi.fn(parts.fetchFn ?? (async () => json({ data: [] })));
  const lookupFn = vi.fn(parts.lookupFn ?? (async () => [{ address: '203.0.113.7' }]));
  const profile = vi.fn(parts.profile ?? (async () => admin));
  const getKey = vi.fn(parts.key ?? (() => KEY));
  const getModelId = vi.fn(parts.model ?? (() => MODEL));
  const getSql = vi.fn(() => 'sql-token');
  const promise = runOxygptProbe(
    { mode: input.mode, prompt: input.prompt ?? '' },
    parts.token === undefined ? TOKEN : parts.token,
    getSql,
    getKey,
    getModelId,
    { fetchFn: fetchFn as unknown as typeof fetch, lookupFn, profile, settings: parts.settings ?? SETTINGS }
  );
  return { promise, fetchFn, lookupFn, profile, getKey, getModelId };
}

const calls = (fetchFn: ReturnType<typeof vi.fn>) =>
  fetchFn.mock.calls as unknown as [string, RequestInit & { headers: Record<string, string> }][];

afterEach(() => vi.restoreAllMocks());

describe('who may run it', () => {
  it.each([
    ['an unverified token', emptyProfile('NOT_AUTHENTICATED', null), 'NOT_AUTHENTICATED'],
    ['an unregistered person', emptyProfile('NOT_REGISTERED', 'id'), 'NOT_REGISTERED'],
    ['a registered person who is not an Admin', viewer, 'NOT_ADMIN'],
  ] as const)('refuses %s before any key is read or any request is made', async (_label, who, category) => {
    const { promise, fetchFn, lookupFn, getKey, getModelId } = run({ mode: 'text', prompt: 'hello' }, { profile: async () => who });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(lookupFn).not.toHaveBeenCalled();
    expect(getKey).not.toHaveBeenCalled();
    expect(getModelId).not.toHaveBeenCalled();
  });

  it('passes the token and the SQL token getter on to the profile lookup', async () => {
    const { promise, profile } = run({ mode: 'dns' });
    await promise;
    expect(profile).toHaveBeenCalledTimes(1);
    expect(profile.mock.calls[0]?.[0]).toBe(TOKEN);
  });

  it('reports a database failure while resolving the caller, and goes no further', async () => {
    const { promise, fetchFn } = run({ mode: 'text' }, { profile: async () => { throw new Error('Could not load your profile (4060): x'); } });
    expect(await promise).toMatchObject({ ok: false, category: 'IDENTITY_ERROR' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('input and setup', () => {
  it('refuses an unknown mode, and a question over the limit', async () => {
    expect(await run({ mode: 'image' }).promise).toMatchObject({ ok: false, category: 'BAD_INPUT', mode: null });
    const long = await run({ mode: 'text', prompt: 'x'.repeat(51) }).promise;
    expect(long).toMatchObject({ ok: false, category: 'BAD_INPUT', mode: 'text' });
  });

  it('refuses an address that is not https, whatever the page asked', async () => {
    const { promise, fetchFn } = run({ mode: 'models' }, { settings: { ...SETTINGS, baseUrl: 'http://oxygpt.example.test' } });
    expect(await promise).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('says what to do when the secret is missing or unreadable, and makes no request', async () => {
    for (const key of [() => '', () => { throw new Error('secret not supplied'); }]) {
      const { promise, fetchFn } = run({ mode: 'models' }, { key });
      const result = await promise;
      expect(result).toMatchObject({ ok: false, category: 'NO_SECRET' });
      expect(result.error).toContain('OXY_GPT_API_KEY');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('asks for the agent ID when neither the secret nor config.ts has one (text only)', async () => {
    const { promise, fetchFn } = run({ mode: 'text' }, { model: () => '', settings: { ...SETTINGS, modelId: '' } });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    expect(result.error).toContain('OXYGPT_AGENT_MODEL_ID');
    expect(result.error).toContain('List models');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses the agent ID from the secret when both are set, and the config.ts value only as a fallback', async () => {
    const answer = async () => completion('pong');
    const bodyModel = (f: ReturnType<typeof vi.fn>) => JSON.parse(calls(f)[0]![1].body as string).model as string;

    const secret = run({ mode: 'text' }, { fetchFn: answer });
    await secret.promise;
    expect(bodyModel(secret.fetchFn)).toBe(MODEL);

    for (const model of [() => '', () => '   ', () => { throw new Error('secret not supplied'); }]) {
      const fallback = run({ mode: 'text' }, { fetchFn: answer, model });
      expect(await fallback.promise).toMatchObject({ ok: true });
      expect(bodyModel(fallback.fetchFn)).toBe(FALLBACK_MODEL);
    }
  });

  it('trims the secret values it reads, so a pasted trailing space or newline does not break the sign-in', async () => {
    const { promise, fetchFn } = run({ mode: 'models' }, { key: () => `  ${KEY}
`, model: () => `${MODEL} `, fetchFn: async () => json({ data: [{ id: MODEL }] }) });
    const result = await promise;
    expect(calls(fetchFn)[0]![1].headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(result.models?.configuredListed).toBe(true);
  });

  it('reads the two secrets under the names the team set in Fabric', () => {
    expect(SECRET_API_KEY).toBe('OXY_GPT_API_KEY');
    expect(SECRET_MODEL_ID).toBe('OXYGPT_AGENT_MODEL_ID');
    const app = readFileSync(new URL('./function_app.ts', import.meta.url), 'utf8');
    expect(app).toContain("[SECRET_API_KEY]");
    expect(app).toContain("[SECRET_MODEL_ID]");
  });
});

describe('dns', () => {
  it('reports a public address as reachable in principle, and never reads the key', async () => {
    const { promise, getKey, getModelId, fetchFn } = run({ mode: 'dns' });
    const result = await promise;
    expect(result).toMatchObject({ ok: true, mode: 'dns', host: 'oxygpt.example.test', dns: { addressCount: 1, scope: 'PUBLIC' } });
    expect(getKey).not.toHaveBeenCalled();
    expect(getModelId).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('203.0.113.7');
  });

  it('flags a private address: Fabric cannot reach it', async () => {
    const result = await run({ mode: 'dns' }, { lookupFn: async () => [{ address: '10.20.30.40' }] }).promise;
    expect(result).toMatchObject({ ok: true, dns: { scope: 'PRIVATE' } });
  });

  it('flags a mix of private and public addresses', async () => {
    const result = await run({ mode: 'dns' }, { lookupFn: async () => [{ address: '10.0.0.1' }, { address: '203.0.113.7' }] }).promise;
    expect(result.dns).toEqual({ addressCount: 2, scope: 'MIXED' });
  });

  it('reports a name that does not resolve as DNS', async () => {
    const result = await run({ mode: 'dns' }, { lookupFn: async () => { throw failure('ENOTFOUND', 'Error', 'getaddrinfo ENOTFOUND'); } }).promise;
    expect(result).toMatchObject({ ok: false, category: 'DNS', errorCode: 'ENOTFOUND' });
  });
});

describe('models', () => {
  it('lists the models with a bearer key, no redirects and a time limit, and says whether the configured one is there', async () => {
    const { promise, fetchFn } = run({ mode: 'models' }, { fetchFn: async () => json({ data: [{ id: 'General-LLM' }, { id: MODEL }, { name: 'no id' }] }) });
    const result = await promise;
    expect(result).toMatchObject({ ok: true, mode: 'models', httpStatus: 200, route: '/api/models', models: { count: 2, ids: ['General-LLM', MODEL], configuredListed: true } });

    const [url, init] = calls(fetchFn)[0]!;
    expect(url).toBe(`${BASE}/api/models`);
    expect(init.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports the configured model as missing when the key cannot see it, and null when none is configured yet', async () => {
    const list = async () => json({ data: [{ id: 'General-LLM' }] });
    expect((await run({ mode: 'models' }, { fetchFn: list }).promise).models?.configuredListed).toBe(false);
    expect((await run({ mode: 'models' }, { fetchFn: list, model: () => '', settings: { ...SETTINGS, modelId: '' } }).promise).models?.configuredListed).toBeNull();
  });

  it('caps the list it returns', async () => {
    const data = Array.from({ length: 250 }, (_, i) => ({ id: `model-${i}` }));
    const result = await run({ mode: 'models' }, { fetchFn: async () => json({ data }) }).promise;
    expect(result.models?.count).toBe(250);
    expect(result.models?.ids).toHaveLength(100);
  });

  it('tries the next route only after a 404, in the order of the client guide', async () => {
    const answers = [json({}, 404), json({}, 404), json({ data: [{ id: 'a' }] })];
    const { promise, fetchFn } = run({ mode: 'models' }, { fetchFn: async () => answers.shift()! });
    const result = await promise;
    expect(calls(fetchFn).map((c) => c[0].slice(BASE.length))).toEqual(['/api/models', '/v1/models', '/api/v1/models']);
    expect(result).toMatchObject({ ok: true, route: '/api/v1/models' });
  });

  it('does not try another route after a 401', async () => {
    const { promise, fetchFn } = run({ mode: 'models' }, { fetchFn: async () => json({ detail: 'Invalid token' }, 401) });
    const result = await promise;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, category: 'HTTP_401', httpStatus: 401 });
    expect(result.error).toContain('Invalid token');
  });

  it.each([
    [403, 'HTTP_403'],
    [429, 'HTTP_429'],
    [500, 'HTTP_OTHER'],
  ] as const)('puts status %i in category %s', async (status, category) => {
    const result = await run({ mode: 'models' }, { fetchFn: async () => json({}, status) }).promise;
    expect(result).toMatchObject({ ok: false, category, httpStatus: status });
  });

  it('treats a redirect as a finding and does not follow it', async () => {
    const { promise, fetchFn } = run({ mode: 'models' }, { fetchFn: async () => new Response(null, { status: 302, headers: { location: 'https://login.example.test/' } }) });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'REDIRECT', httpStatus: 302 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('calls a 200 that is not a model list BAD_RESPONSE (a sign-in page would look like this)', async () => {
    const html = new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const result = await run({ mode: 'models' }, { fetchFn: async () => html }).promise;
    expect(result).toMatchObject({ ok: false, category: 'BAD_RESPONSE', httpStatus: 200 });
    expect(result.error).toContain('text/html');
  });
});

describe('text', () => {
  it('sends the model and the question in the documented shape and returns the answer', async () => {
    const { promise, fetchFn } = run(
      { mode: 'text', prompt: '  What is a heater treater?  ' },
      { fetchFn: async () => completion('A vessel.', { model: MODEL, usage: { prompt_tokens: 12, completion_tokens: 3 } }) }
    );
    const result = await promise;
    expect(result).toMatchObject({
      ok: true,
      mode: 'text',
      httpStatus: 200,
      route: '/api/chat/completions',
      reply: { text: 'A vessel.', truncated: false, model: MODEL, promptTokens: 12, completionTokens: 3 },
    });

    const [url, init] = calls(fetchFn)[0]!;
    expect(url).toBe(`${BASE}/api/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What is a heater treater?' }] }],
    });
  });

  it('asks for "pong" when the question is empty', async () => {
    const { promise, fetchFn } = run({ mode: 'text', prompt: '   ' }, { fetchFn: async () => completion('pong') });
    await promise;
    expect(JSON.parse(calls(fetchFn)[0]![1].body as string).messages[0].content[0].text).toBe('Reply with the single word: pong');
  });

  it('cuts a long answer and says so', async () => {
    const result = await run({ mode: 'text' }, { fetchFn: async () => completion('x'.repeat(100)) }).promise;
    expect(result.reply).toMatchObject({ text: 'x'.repeat(20), truncated: true });
  });

  it('reads an answer given as a list of text parts', async () => {
    const result = await run({ mode: 'text' }, { fetchFn: async () => completion([{ type: 'text', text: 'po' }, { type: 'text', text: 'ng' }]) }).promise;
    expect(result.reply?.text).toBe('pong');
  });

  it('reports a 403 with the service\'s own reason', async () => {
    const result = await run({ mode: 'text' }, { fetchFn: async () => json({ detail: 'Model not found' }, 403) }).promise;
    expect(result).toMatchObject({ ok: false, category: 'HTTP_403', reply: null });
    expect(result.error).toContain('Model not found');
  });

  it.each([
    ['no choices', { choices: [] }],
    ['empty text', { choices: [{ message: { content: '  ' } }] }],
    ['no message', { choices: [{}] }],
    ['not an object', 'text'],
  ])('calls %s BAD_RESPONSE', async (_label, body) => {
    const result = await run({ mode: 'text' }, { fetchFn: async () => json(body) }).promise;
    expect(result).toMatchObject({ ok: false, category: 'BAD_RESPONSE' });
  });
});

describe('failures reach the right category', () => {
  const asFetch = (err: Error) => async () => { throw err; };

  it.each([
    ['a DNS failure', failure('ENOTFOUND'), 'DNS'],
    ['a lookup that is retried later', failure('EAI_AGAIN'), 'DNS'],
    ['an untrusted certificate chain', failure('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'TLS'],
    ['a self-signed certificate', failure('SELF_SIGNED_CERT_IN_CHAIN'), 'TLS'],
    ['an expired certificate', failure('CERT_HAS_EXPIRED'), 'TLS'],
    ['a host name that does not match the certificate', failure('ERR_TLS_CERT_ALTNAME_INVALID'), 'TLS'],
    ['a connect timeout', failure('UND_ERR_CONNECT_TIMEOUT'), 'TIMEOUT'],
    ['a timeout signal', Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }), 'TIMEOUT'],
    ['a refused connection', failure('ECONNREFUSED'), 'NETWORK'],
    ['an unreachable network', failure('ENETUNREACH'), 'NETWORK'],
    ['an unknown failure', new Error('boom'), 'NETWORK'],
  ] as const)('%s is %s', async (_label, err, category) => {
    for (const mode of ['models', 'text']) {
      const result = await run({ mode }, { fetchFn: asFetch(err) }).promise;
      expect(result, `${mode}`).toMatchObject({ ok: false, category });
    }
  });

  it('records the low-level code and a plain-words message for a timeout', async () => {
    const result = await run({ mode: 'text' }, { fetchFn: asFetch(Object.assign(new Error('t'), { name: 'TimeoutError' })) }).promise;
    expect(result.error).toBe('No answer within 1 s.');
  });

  it('classifyFailure finds a code several levels down', () => {
    const deep = Object.assign(new Error('a'), { cause: Object.assign(new Error('b'), { cause: Object.assign(new Error('c'), { code: 'ENOTFOUND' }) }) });
    expect(classifyFailure(deep)).toEqual({ category: 'DNS', code: 'ENOTFOUND' });
    expect(classifyFailure('plain text')).toEqual({ category: 'NETWORK', code: null });
  });
});

describe('the key, the question and the answer stay out of what is returned and logged', () => {
  it('never returns the key, even when the service echoes it in an error', async () => {
    const result = await run({ mode: 'models' }, { fetchFn: async () => json({ detail: `Bad token ${KEY} given` }, 401) }).promise;
    const text = JSON.stringify(result);
    expect(text).not.toContain(KEY);
    expect(result.error).toContain('[key]');
  });

  it('logs the mode, outcome, status and time only', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run({ mode: 'text', prompt: 'SECRET QUESTION' }, { fetchFn: async () => completion('SECRET ANSWER') }).promise;
    await run({ mode: 'models' }, { fetchFn: async () => json({ detail: KEY }, 401) }).promise;

    const logged = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('oxygptProbe: mode=text ok=true category=none status=200');
    expect(logged).toContain('oxygptProbe: mode=models ok=false category=HTTP_401 status=401');
    for (const secret of [KEY, 'SECRET QUESTION', 'SECRET ANSWER', TOKEN]) expect(logged).not.toContain(secret);
  });

  it('a result built from a real OXYGPT configuration carries only the documented fields', async () => {
    const result = await run({ mode: 'dns' }).promise;
    expect(Object.keys(result).sort()).toEqual(
      ['agent', 'category', 'dns', 'error', 'errorCode', 'host', 'httpStatus', 'mode', 'models', 'ok', 'reply', 'route', 'totalMs'].sort()
    );
  });
});

describe('helpers', () => {
  it.each([
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['127.0.0.1', true],
    ['169.254.10.10', true],
    ['100.64.0.1', true],
    ['100.128.0.1', false],
    ['203.0.113.7', false],
    ['8.8.8.8', false],
    ['::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.5', true],
    ['2606:4700::1111', false],
  ])('isPrivateAddress(%s) is %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  it('modelIdsOf reads the three shapes and nothing else', () => {
    expect(modelIdsOf({ data: [{ id: 'a' }, 'b'] })).toEqual(['a', 'b']);
    expect(modelIdsOf({ models: [{ id: 'c' }] })).toEqual(['c']);
    expect(modelIdsOf([{ id: 'd' }])).toEqual(['d']);
    expect(modelIdsOf({ hello: 1 })).toBeNull();
    expect(modelIdsOf('x')).toBeNull();
  });

  it('replyTextOf reads a string, a list of parts, and refuses the rest', () => {
    expect(replyTextOf({ choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    expect(replyTextOf({ choices: [{ message: { content: [{ text: 'h' }, { text: 'i' }] } }] })).toBe('hi');
    expect(replyTextOf({ choices: [{ message: { content: [] } }] })).toBeNull();
    expect(replyTextOf(null)).toBeNull();
  });
});

describe('the shipped configuration and the source', () => {
  it('points at one of the two addresses the client\'s guide names, over https, with no path and no trailing slash', () => {
    // ai-dev.oxy.com is what every API example uses; chat.oxy.com is the address the guide gives for the web page.
    // S5 (18 Nov) found ai-dev.oxy.com unreachable from Fabric and tries chat.oxy.com. Once Ops AI names the real
    // address for a cloud caller, put it here and in this list.
    expect(['https://ai-dev.oxy.com', 'https://chat.oxy.com']).toContain(OXYGPT.baseUrl);
    expect(new URL(OXYGPT.baseUrl).pathname).toBe('/');
  });

  it('keeps the wait below the 250 s limit Fabric puts on a function', () => {
    expect(OXYGPT.textTimeoutMs).toBeLessThan(250_000);
    expect(OXYGPT.listTimeoutMs).toBeLessThan(OXYGPT.textTimeoutMs);
    // the agent flow (oxygpt-agent.spec.ts checks it against the shipped numbers too)
    expect(OXYGPT.agentTotalMs).toBeLessThan(250_000);
  });

  it('holds no secret and does not switch TLS verification off', () => {
    const source = readFileSync(new URL('./oxygpt.ts', import.meta.url), 'utf8');
    const config = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
    for (const text of [source, config]) {
      expect(text).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False/);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    }
    // the key is read from the secret by the caller, never written in the module
    expect(source).not.toMatch(/OXY_GPT_API_KEY['"]\s*[:=]\s*['"]/);
  });
});
