import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

// The pretend OxyGPT, built only from what the client's script `oxy_agent.py` reads and writes (tools/oxygpt_fake.mjs).
// Nothing here calls a real service; every key, agent and tool name is made up.
import { createFakeOxygpt, FAKE_AGENT, FAKE_KEY } from '../../../tools/oxygpt_fake.mjs';
import { OXYGPT } from './config.js';
import { runOxygptProbe, type OxygptSettings } from './oxygpt.js';
import {
  agentReplyText,
  collectTurn,
  discoverAgent,
  summarizeDefaults,
  type AgentCall,
  type AgentEnv,
  type AgentTurn,
} from './oxygpt-agent.js';
import { emptyProfile, type MyProfile } from './profile.js';

const BASE = 'https://oxygpt.example.test';
const admin: MyProfile = { ...emptyProfile('OK', 'id', 'tester@example.test', 'Tester'), canManageAdmin: true };
const viewer: MyProfile = { ...emptyProfile('OK', 'id', 'tester@example.test', 'Tester'), canView: true };

const SETTINGS: OxygptSettings = {
  ...OXYGPT,
  baseUrl: BASE,
  maxPromptChars: 50,
  maxReplyChars: 20,
  agentStepTimeoutMs: 5_000,
  agentStartTimeoutMs: 5_000,
  agentTotalMs: 60_000,
  agentCleanupMs: 5_000,
  agentPollMs: 1_000,
};

/** A clock that only moves when the code sleeps or a request takes its (pretend) time. */
function fakeEnv(): AgentEnv & { advance(ms: number): void; time(): number } {
  let t = 0;
  let n = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    newId: () => `id-${(n += 1)}`,
    advance: (ms: number) => {
      t += ms;
    },
    time: () => t,
  };
}

type Wrap = (url: string, init: RequestInit & { headers: Record<string, string> }, next: () => Promise<Response>) => Promise<Response>;

function setup(
  parts: { scenario?: string; fake?: Record<string, unknown>; key?: string; prompt?: string; profile?: MyProfile; wrap?: Wrap; settings?: Partial<OxygptSettings>; agentId?: string } = {}
) {
  const fake = createFakeOxygpt({ scenario: parts.scenario ?? 'ok', ...parts.fake });
  const env = fakeEnv();
  const seen: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    seen.push({ url, init });
    env.advance(50);
    const next = () => fake.fetchFn(url, init) as Promise<Response>;
    return parts.wrap ? parts.wrap(url, init, next) : next();
  });
  const profile = vi.fn(async () => parts.profile ?? admin);
  const getKey = vi.fn(() => parts.key ?? FAKE_KEY);
  const getModelId = vi.fn(() => parts.agentId ?? FAKE_AGENT);
  const promise = runOxygptProbe({ mode: 'agent', prompt: parts.prompt ?? '' }, 'token', () => 'sql', getKey, getModelId, {
    fetchFn: fetchFn as unknown as typeof fetch,
    profile,
    settings: { ...SETTINGS, ...parts.settings },
    env,
  });
  return { promise, fake, env, seen, fetchFn, profile, getKey, getModelId };
}

const failureOf = (code: string): Error =>
  Object.assign(new Error('fetch failed'), { name: 'TypeError', cause: Object.assign(new Error(code), { code }) });

afterEach(() => vi.restoreAllMocks());

describe('agent mode: the whole saved-chat flow', () => {
  it('runs the seven steps in the script\'s order, answers, and leaves no chat behind', async () => {
    const { promise, fake } = setup();
    const result = await promise;

    expect(result).toMatchObject({
      ok: true,
      mode: 'agent',
      category: null,
      error: null,
      reply: { text: 'pong', truncated: false, model: FAKE_AGENT, promptTokens: null, completionTokens: null },
    });
    expect(result.agent?.steps.map((s) => [s.step, s.ok, s.httpStatus, s.count])).toEqual([
      ['models', true, 200, 1],
      ['settings', true, 200, 1],
      ['create', true, 200, 1],
      ['start', true, 200, 1],
      ['poll', true, 200, 3], // two "still running" answers, then "finished"
      ['collect', true, 200, 1],
      ['delete', true, 200, 1],
    ]);
    expect(result.agent).toMatchObject({ polls: 3, chatDeleted: true, chatId: null, toolCalls: { count: 1, names: ['sap_search'] } });
    expect(fake.chats.size).toBe(0);
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/models',
      'GET /api/v1/users/user/settings',
      'POST /api/v1/chats/new',
      'POST /api/chat/completions',
      'GET /api/tasks/chat/chat-1',
      'GET /api/tasks/chat/chat-1',
      'GET /api/tasks/chat/chat-1',
      'GET /api/v1/chats/chat-1',
      'DELETE /api/v1/chats/chat-1',
    ]);
  });

  it('sends what the script sends: the agent\'s own settings, stream, chat and session ids, and the user message', async () => {
    const { promise, fake } = setup({ prompt: '  Say pong  ' });
    await promise;

    const [created, started] = fake.requests;
    expect(created.body).toEqual({ chat: { title: 'ATLAS connection test', models: [FAKE_AGENT], history: { messages: {}, currentId: null } } });
    expect(started.body).toMatchObject({
      tool_ids: ['sap_search', 'dmp_search'], // `direct_server:` tools are dropped, as in the script
      skill_ids: ['skill_nameplate'],
      filter_ids: ['filter_redact'],
      features: { web_search: true, image_generation: false, code_interpreter: false, memory: false },
      terminal_id: 'terminal-1',
      messages: [{ role: 'system', content: 'You are a test assistant.' }],
      params: { tool_approval_mode: 'auto' },
      model: FAKE_AGENT,
      stream: true,
      chat_id: 'chat-1',
      parent_id: null,
      user_message: { role: 'user', content: 'Say pong', parentId: null, models: [FAKE_AGENT] },
    });
    const body = started.body as { id: string; session_id: string; user_message: { id: string } };
    expect(body.session_id).toMatch(/^agent-api:/);
    expect(new Set([body.id, body.user_message.id, body.session_id]).size).toBe(3);
  });

  it('asks for "pong" when the question is empty', async () => {
    const { promise, fake } = setup();
    await promise;
    expect((fake.requests[1]!.body as { user_message: { content: string } }).user_message.content).toBe('Reply with the single word: pong');
  });

  it('signs every request with the key, refuses redirects, sets a time limit, and sends JSON only where there is a body', async () => {
    const { promise, seen } = setup();
    await promise;
    expect(seen.length).toBe(9);
    for (const { url, init } of seen) {
      expect(url.startsWith(`${BASE}/`)).toBe(true);
      expect(init.headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(seen.filter((s) => s.init.headers['Content-Type']).map((s) => s.init.method)).toEqual(['POST', 'POST']);
  });

  it('pauses between polls instead of asking in a tight loop', async () => {
    const { promise, env } = setup();
    await promise;
    // 9 requests x 50 ms of pretend work + 2 pauses of 1 s
    expect(env.time()).toBe(9 * 50 + 2 * 1_000);
  });

  it('honours text that an outlet filter changed (the saved message has originalContent)', async () => {
    const result = await setup({ scenario: 'filtered' }).promise;
    expect(result).toMatchObject({ ok: true, reply: { text: '[redacted]' } });
  });

  it('cuts a long answer and says so', async () => {
    const result = await setup({ fake: { answer: 'x'.repeat(100) } }).promise;
    expect(result.reply).toMatchObject({ text: 'x'.repeat(20), truncated: true });
  });
});

describe('agent mode: where it can fail, what it says, and what it cleans up', () => {
  it('names an agent this key cannot see, before creating any chat', async () => {
    const { promise, fake } = setup({ scenario: 'notListed' });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'AGENT_NOT_LISTED' });
    expect(result.error).toContain('List models');
    expect(result.agent?.steps).toHaveLength(1);
    expect(fake.calls.map((c) => c.path)).toEqual(['/api/models']);
    expect(result.agent).toMatchObject({ chatDeleted: null, chatId: null });
  });

  it('reports which step an unexpected status came from (a gateway that hides the settings route)', async () => {
    const result = await setup({ scenario: 'noSettings' }).promise;
    expect(result).toMatchObject({ ok: false, category: 'HTTP_OTHER', httpStatus: 404 });
    expect(result.error).toContain('Step "settings"');
    expect(result.agent?.steps.at(-1)).toMatchObject({ step: 'settings', ok: false, httpStatus: 404 });
  });

  it('treats a web page instead of JSON as BAD_RESPONSE, like the script\'s "non-JSON response"', async () => {
    const result = await setup({ scenario: 'html' }).promise;
    expect(result).toMatchObject({ ok: false, category: 'BAD_RESPONSE', httpStatus: 200 });
    expect(result.error).toContain('text/html');
    expect(result.error).toContain('Step "models"');
  });

  it('puts a refused key in HTTP_401 at the first step and makes nothing else', async () => {
    const { promise, fake } = setup({ key: 'some-other-key' });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'HTTP_401', httpStatus: 401 });
    expect(fake.calls).toHaveLength(1);
  });

  it('treats a redirect as a finding and does not follow it', async () => {
    const wrap: Wrap = async () => new Response(null, { status: 302, headers: { location: 'https://login.example.test/' } });
    const { promise, fetchFn } = setup({ wrap });
    expect(await promise).toMatchObject({ ok: false, category: 'REDIRECT', httpStatus: 302 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports a name that does not resolve as DNS, with the low-level code (what S5 saw on 18 Nov)', async () => {
    const wrap: Wrap = async () => {
      throw failureOf('ENOTFOUND');
    };
    const result = await setup({ wrap }).promise;
    expect(result).toMatchObject({ ok: false, category: 'DNS', errorCode: 'ENOTFOUND' });
    expect(result.agent?.steps).toEqual([{ step: 'models', ok: false, httpStatus: null, ms: 50, count: 1 }]);
  });

  it('says when starting the turn returns no task, and deletes the chat it made', async () => {
    const { promise, fake } = setup({ scenario: 'noTask' });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'AGENT_NO_TASK' });
    expect(result.agent).toMatchObject({ chatDeleted: true, chatId: null });
    expect(fake.chats.size).toBe(0);
  });

  it('keeps the chat while a tool waits for a person, names the tool, and says which chat to open', async () => {
    const { promise, fake } = setup({ scenario: 'approval' });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'AGENT_WAITING' });
    expect(result.error).toContain('sap_search');
    expect(result.agent).toMatchObject({ chatDeleted: false, chatId: 'chat-1' });
    expect(fake.chats.size).toBe(1);
    expect(fake.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it.each([
    ['error', 'The model refused to answer.'],
    ['unfinished', 'without a completed assistant message'],
  ])('reports an agent that failed (%s) and deletes the chat', async (scenario, text) => {
    const { promise, fake } = setup({ scenario });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'AGENT_FAILED' });
    expect(result.error).toContain(text);
    expect(result.agent?.chatDeleted).toBe(true);
    expect(fake.chats.size).toBe(0);
  });

  it('still passes when only the clean-up fails, but says which chat is left in the account', async () => {
    const result = await setup({ scenario: 'deleteFails' }).promise;
    expect(result).toMatchObject({ ok: true, reply: { text: 'pong' } });
    expect(result.agent).toMatchObject({ chatDeleted: false, chatId: 'chat-1' });
    expect(result.agent?.steps.at(-1)).toMatchObject({ step: 'delete', ok: false, httpStatus: 500 });
  });

  it('gives up before Fabric\'s 250 s limit when the agent never finishes, and still deletes the chat', async () => {
    const { promise, fake, env } = setup({ scenario: 'neverFinishes', settings: { ...OXYGPT, baseUrl: BASE, maxPromptChars: 50, maxReplyChars: 20 } });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'TIMEOUT' });
    expect(result.error).toContain('Step "poll"');
    expect(result.error).toContain('had not finished after 205 s'); // the wait ends at total (220 s) minus the clean-up reserve (15 s)
    expect(result.agent).toMatchObject({ chatDeleted: true, chatId: null });
    expect(fake.chats.size).toBe(0);
    // with the shipped limits: the wait ends at 205 s and the delete still fits under 220 s, far below Fabric's 250 s
    expect(result.totalMs).toBeLessThanOrEqual(OXYGPT.agentTotalMs);
    expect(env.time()).toBeLessThan(250_000);
    expect(result.agent!.steps.find((s) => s.step === 'poll')!.count).toBeGreaterThan(100);
  });

  it('puts a connection that drops mid-wait in a category, and still removes the chat', async () => {
    const wrap: Wrap = async (url, _init, next) => {
      if (url.includes('/api/tasks/chat/')) throw failureOf('ECONNRESET');
      return next();
    };
    const { promise, fake } = setup({ wrap });
    const result = await promise;
    expect(result).toMatchObject({ ok: false, category: 'NETWORK', errorCode: 'ECONNRESET' });
    expect(result.error).toContain('Step "poll"');
    expect(result.agent?.chatDeleted).toBe(true);
    expect(fake.chats.size).toBe(0);
  });

  it('reports a chat it could not remove when the connection is gone for good', async () => {
    const wrap: Wrap = async (url, _init, next) => {
      if (url.includes('/api/tasks/chat/') || url.includes('/api/v1/chats/chat-1')) throw failureOf('ECONNRESET');
      return next();
    };
    const result = await setup({ wrap }).promise;
    expect(result).toMatchObject({ ok: false, category: 'NETWORK' });
    expect(result.agent).toMatchObject({ chatDeleted: false, chatId: 'chat-1' });
  });
});

describe('agent mode: the rules it shares with the other modes', () => {
  it('refuses anyone who is not an Admin before any key is read or request is made', async () => {
    const { promise, fetchFn, getKey, getModelId } = setup({ profile: viewer });
    expect(await promise).toMatchObject({ ok: false, category: 'NOT_ADMIN', agent: null });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(getKey).not.toHaveBeenCalled();
    expect(getModelId).not.toHaveBeenCalled();
  });

  it('asks for the secret and for the agent\'s ID instead of guessing, and makes no request', async () => {
    const noKey = setup({ key: '' });
    expect(await noKey.promise).toMatchObject({ ok: false, category: 'NO_SECRET' });
    expect(noKey.fetchFn).not.toHaveBeenCalled();

    const noAgent = setup({ agentId: '', settings: { modelId: '' } });
    const result = await noAgent.promise;
    expect(result).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    expect(result.error).toContain('OXYGPT_AGENT_MODEL_ID');
    expect(noAgent.fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a question over the limit and an address that is not https', async () => {
    const long = setup({ prompt: 'x'.repeat(51) });
    expect(await long.promise).toMatchObject({ ok: false, category: 'BAD_INPUT', mode: 'agent' });
    expect(long.fetchFn).not.toHaveBeenCalled();

    const plain = setup({ settings: { baseUrl: 'http://oxygpt.example.test' } });
    expect(await plain.promise).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    expect(plain.fetchFn).not.toHaveBeenCalled();
  });

  it('never returns or logs the key, the question or the answer', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // the service echoes the key in an error: it must come back scrubbed
    const echo: Wrap = async () => new Response(JSON.stringify({ detail: `Bad token ${FAKE_KEY} given` }), { status: 401, headers: { 'content-type': 'application/json' } });
    const failed = await setup({ wrap: echo }).promise;
    expect(JSON.stringify(failed)).not.toContain(FAKE_KEY);
    expect(failed.error).toContain('[key]');

    await setup({ prompt: 'SECRET QUESTION' }).promise;
    const logged = [...log.mock.calls, ...err.mock.calls].map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('oxygptProbe: mode=agent ok=true category=none status=200');
    expect(logged).toContain('oxygptProbe: mode=agent ok=false category=HTTP_401 status=401');
    for (const secret of [FAKE_KEY, 'SECRET QUESTION', 'pong', 'sap_search', 'You are a test assistant']) expect(logged).not.toContain(secret);
  });

  it('shows the agent\'s configuration as counts and names only, never the prompt text', async () => {
    const result = await setup().promise;
    expect(result.agent?.config).toEqual({
      tools: 2,
      skills: 1,
      filters: 1,
      features: ['web_search'],
      terminal: true,
      systemPrompt: true,
      approvalMode: 'auto',
    });
    expect(JSON.stringify(result)).not.toContain('You are a test assistant');
  });
});

/** A stand-in for one request: answers by path, like the service would. */
const answers = (table: Record<string, unknown>): AgentCall => async (_step, _method, path) => {
  if (!(path in table)) throw new Error(`unexpected request ${path}`);
  return table[path];
};
const model = (meta: Record<string, unknown>) => ({ data: [{ id: 'A', info: { meta } }] });

describe('discoverAgent: the agent\'s own settings, as the script reads them', () => {
  const settings = '/api/v1/users/user/settings';

  it('falls back to the user\'s tools only when the agent lists none at all (missing or null), not when the list is empty', async () => {
    const ui = { tools: ['user_tool', 'direct_server:x'] };
    expect((await discoverAgent(answers({ '/api/models': model({}), [settings]: { ui } }), 'A')).tool_ids).toEqual(['user_tool']);
    expect((await discoverAgent(answers({ '/api/models': model({ toolIds: null }), [settings]: { ui } }), 'A')).tool_ids).toEqual(['user_tool']);
    expect((await discoverAgent(answers({ '/api/models': model({ toolIds: [] }), [settings]: { ui } }), 'A')).tool_ids).toEqual([]);
    expect((await discoverAgent(answers({ '/api/models': model({ toolIds: ['a', 7, 'direct_server:b'] }), [settings]: {} }), 'A')).tool_ids).toEqual(['a']);
  });

  it('switches a feature on only when the agent defaults it on and does not forbid it; memory is on unless the user turned it off', async () => {
    const meta = { defaultFeatureIds: ['web_search', 'image_generation', 'code_interpreter'], capabilities: { image_generation: false } };
    const d = await discoverAgent(answers({ '/api/models': model(meta), [settings]: { ui: {} } }), 'A');
    expect(d.features).toEqual({ web_search: true, image_generation: false, code_interpreter: true, memory: true });
    const off = await discoverAgent(answers({ '/api/models': model({}), [settings]: { ui: { memory: false } } }), 'A');
    expect(off.features).toEqual({ web_search: false, image_generation: false, code_interpreter: false, memory: false });
  });

  it('adds the terminal, the system prompt and the approval mode only when they exist', async () => {
    const bare = await discoverAgent(answers({ '/api/models': model({ terminalId: 't', capabilities: { terminal: false } }), [settings]: { ui: { system: '', params: {} } } }), 'A');
    expect(bare).not.toHaveProperty('terminal_id');
    expect(bare).not.toHaveProperty('messages');
    expect(bare).not.toHaveProperty('params');
    const full = await discoverAgent(answers({ '/api/models': model({ terminalId: 't' }), [settings]: { ui: { system: 'Be brief.', params: { tool_approval_mode: 'ask' } } } }), 'A');
    expect(full).toMatchObject({ terminal_id: 't', messages: [{ role: 'system', content: 'Be brief.' }], params: { tool_approval_mode: 'ask' } });
    // a settings answer of null is read as "no settings", as the script does with `or {}`
    expect((await discoverAgent(answers({ '/api/models': model({}), [settings]: null }), 'A')).tool_ids).toEqual([]);
  });

  it('fails with a category, not an exception, when the list has the wrong shape or the agent is missing', async () => {
    await expect(discoverAgent(answers({ '/api/models': { models: [] } }), 'A')).rejects.toMatchObject({ category: 'BAD_RESPONSE' });
    await expect(discoverAgent(answers({ '/api/models': { data: [{ id: 'B' }] } }), 'A')).rejects.toMatchObject({ category: 'AGENT_NOT_LISTED' });
  });

  it('summarizeDefaults keeps counts and names, not the prompt', () => {
    const summary = summarizeDefaults({
      tool_ids: ['a', 'b'],
      skill_ids: [],
      filter_ids: ['f'],
      features: { web_search: true, memory: false },
      messages: [{ role: 'system', content: 'PRIVATE PROMPT' }],
      params: { tool_approval_mode: { odd: 'shape' } },
    });
    expect(summary).toEqual({ tools: 2, skills: 0, filters: 1, features: ['web_search'], terminal: false, systemPrompt: true, approvalMode: 'set' });
    expect(JSON.stringify(summary)).not.toContain('PRIVATE PROMPT');
  });
});

describe('collectTurn and the reply text, as the script reads the saved message', () => {
  const turn: AgentTurn = { chatId: 'c', assistantId: 'm', taskIds: ['t'] };
  const saved = (message: Record<string, unknown>) => answers({ '/api/v1/chats/c': { chat: { history: { messages: { m: message } } } } });
  const text = (value: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] });

  it('joins the assistant\'s text parts with a new line and ignores everything else', () => {
    const message = {
      content: 'fallback',
      output: [text('one'), { type: 'message', role: 'user', content: [{ type: 'output_text', text: 'no' }] }, { type: 'function_call' }, text('two'), { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '' }] }],
    };
    expect(agentReplyText(message)).toBe('one\ntwo');
  });

  it('uses the plain content when there is no output, or when a filter changed the text', () => {
    expect(agentReplyText({ content: 'plain' })).toBe('plain');
    expect(agentReplyText({ content: 'plain', output: [] })).toBe('plain');
    expect(agentReplyText({ content: 'filtered', originalContent: 'raw', output: [text('raw')] })).toBe('filtered');
    expect(agentReplyText({ content: 42 })).toBe('');
  });

  it('counts the tool calls and lists each tool once', async () => {
    const answer = await collectTurn(saved({ done: true, content: 'x', output: [{ type: 'function_call', name: 'sap_search' }, { type: 'function_call', name: 'sap_search' }, { type: 'function_call', name: 'dmp_search' }, { type: 'function_call' }] }), turn);
    expect(answer).toMatchObject({ toolCount: 4, toolNames: ['sap_search', 'dmp_search'] });
  });

  it('checks a pending tool first, then an error, then done, in the script\'s order', async () => {
    const pending = { type: 'function_call', name: 't', status: 'pending' };
    await expect(collectTurn(saved({ done: false, error: true, output: [pending] }), turn)).rejects.toMatchObject({ category: 'AGENT_WAITING' });
    await expect(collectTurn(saved({ done: false, error: { message: 'boom' } }), turn)).rejects.toMatchObject({ category: 'AGENT_FAILED', message: expect.stringContaining('boom') });
    await expect(collectTurn(saved({ done: false }), turn)).rejects.toMatchObject({ category: 'AGENT_FAILED' });
    await expect(collectTurn(answers({ '/api/v1/chats/c': { chat: { history: { messages: {} } } } }), turn)).rejects.toMatchObject({ category: 'AGENT_FAILED' });
  });
});

describe('the source', () => {
  const source = readFileSync(new URL('./oxygpt-agent.ts', import.meta.url), 'utf8');
  const probe = readFileSync(new URL('./oxygpt.ts', import.meta.url), 'utf8');

  it('holds no secret, does not switch TLS verification off and reads no secret or setting itself', () => {
    for (const text of [source, probe]) {
      expect(text).not.toMatch(/rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False/);
      expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    }
    expect(source).not.toMatch(/process\.env|ctx\.Secrets|console\./);
  });

  it('imports nothing at run time from oxygpt.ts, so the two files can never import each other in a loop', () => {
    const importsOfProbe = source.split('\n').filter((line) => /from '\.\/oxygpt\.js'/.test(line));
    expect(importsOfProbe.length).toBeGreaterThan(0);
    for (const line of importsOfProbe) expect(line.startsWith('import type')).toBe(true);
  });

  it('keeps every wait below the 250 s limit Fabric puts on a function, with room to delete the chat', () => {
    expect(OXYGPT.agentTotalMs).toBeLessThan(250_000);
    expect(OXYGPT.agentCleanupMs).toBeLessThan(OXYGPT.agentTotalMs);
    expect(OXYGPT.agentStepTimeoutMs + OXYGPT.agentCleanupMs).toBeLessThan(OXYGPT.agentTotalMs);
  });
});
