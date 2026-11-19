// A pretend OxyGPT, for trying the agent flow on a laptop with no VPN and no Fabric (spike S5, 19 Nov 2026).
//
// What it is: a small server that answers the seven requests the client's reference script `oxy_agent.py` makes
// (GET /api/models, GET /api/v1/users/user/settings, POST /api/v1/chats/new, POST /api/chat/completions,
// GET /api/tasks/chat/{id}, GET /api/v1/chats/{id}, DELETE /api/v1/chats/{id}) in the shapes that script reads.
//
// What it is NOT: the real service. It encodes how the script is written, not how OxyGPT behaves. Passing against it
// proves our code does what the script does; it does not prove the real service answers the same way. Everything in it
// is made up (fake key, fake agent, fake tool names). It never contacts the network beyond localhost.
//
// Use:
//   node tools/oxygpt_fake.mjs probe [--scenario ok]     run our probe (packages/functions/dist) against it, print the result
//   node tools/oxygpt_fake.mjs serve [--port 8787]       start the server, so the client's own script can be pointed at it:
//       $env:OXYGPT_API_KEY = "fake-key-for-local-tests"
//       python TeamsFolder/oxy_agent.py "Test-Agent-1" "Reply with pong" --base-url http://127.0.0.1:8787
//   node tools/oxygpt_fake.mjs scenarios                 list the scenarios
//
// `probe` needs the functions package built first: `npm run -w @rayfin-app/functions build`.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const FAKE_KEY = 'fake-key-for-local-tests';
export const FAKE_AGENT = 'Test-Agent-1';

/** What each scenario makes the fake do. The first is the normal case; the rest are the ways the real flow can go wrong. */
export const SCENARIOS = {
  ok: 'the agent works: runs one tool, answers "pong"',
  approval: 'a tool waits for a person to approve it (the turn never completes by itself)',
  error: 'the saved assistant message holds an error',
  unfinished: 'the background task ends but the message is not marked done',
  filtered: 'an outlet filter changed the text (the saved message has originalContent)',
  notListed: 'the key cannot see the agent (it is not in /api/models)',
  noTask: 'starting the turn returns no task_ids',
  noSettings: 'the user-settings endpoint does not exist (404), as a gateway that exposes fewer routes might do',
  html: 'every route answers a sign-in web page instead of JSON',
  deleteFails: 'the chat cannot be deleted',
  neverFinishes: 'the background task never ends',
};

const json = (body, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * One fake service. `handle({ method, path, headers, body })` returns `{ status, headers, body }`; `body` is already text.
 * `calls` lists every request seen (method and path), `chats` is what is currently saved.
 */
export function createFakeOxygpt({ scenario = 'ok', apiKey = FAKE_KEY, agentId = FAKE_AGENT, busyPolls = 2, answer = 'pong' } = {}) {
  if (!(scenario in SCENARIOS)) throw new Error(`Unknown scenario "${scenario}". Known: ${Object.keys(SCENARIOS).join(', ')}`);
  const chats = new Map(); // chat id -> { assistantId, taskId, pollsLeft, request }
  const calls = [];
  const requests = []; // parsed bodies of POSTs, for tests
  let counter = 0;
  const nextId = (prefix) => `${prefix}-${(counter += 1)}`;

  const agentEntry = {
    id: agentId,
    name: 'Test Agent',
    info: {
      meta: {
        toolIds: ['sap_search', 'dmp_search', 'direct_server:internal-only'],
        skillIds: ['skill_nameplate'],
        defaultFilterIds: ['filter_redact'],
        defaultFeatureIds: ['web_search'],
        capabilities: { web_search: true, terminal: true },
        terminalId: 'terminal-1',
      },
    },
  };

  const assistantMessage = (chat) => {
    const id = chat.assistantId;
    const base = { id, role: 'assistant', parentId: null };
    switch (scenario) {
      case 'approval':
        return { ...base, done: false, content: '', output: [{ type: 'function_call', name: 'sap_search', status: 'pending' }] };
      case 'error':
        return { ...base, done: true, content: '', error: { content: 'The model refused to answer.' } };
      case 'unfinished':
        return { ...base, done: false, content: '' };
      case 'filtered':
        return {
          ...base,
          done: true,
          content: '[redacted]',
          originalContent: answer,
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }],
        };
      default:
        return {
          ...base,
          done: true,
          model: agentId,
          content: answer,
          output: [
            { type: 'function_call', name: 'sap_search', status: 'completed' },
            { type: 'function_call_output', status: 'completed' },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] },
          ],
        };
    }
  };

  function handle({ method, path, headers = {}, body }) {
    calls.push({ method, path });
    if (headers['authorization'] !== `Bearer ${apiKey}`) return json({ detail: 'Not authenticated' }, 401);
    if (scenario === 'html') {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Sign in</body></html>' };
    }

    if (method === 'GET' && path === '/api/models') {
      return json({ data: scenario === 'notListed' ? [{ id: 'General-LLM' }] : [{ id: 'General-LLM' }, agentEntry] });
    }
    if (method === 'GET' && path === '/api/v1/users/user/settings') {
      if (scenario === 'noSettings') return json({ detail: 'Not Found' }, 404);
      return json({ ui: { memory: false, system: 'You are a test assistant.', params: { tool_approval_mode: 'auto' } } });
    }
    if (method === 'POST' && path === '/api/v1/chats/new') {
      const id = nextId('chat');
      chats.set(id, { assistantId: null, taskId: null, pollsLeft: 0, request: null });
      requests.push({ path, body });
      return json({ id, title: body?.chat?.title ?? '' });
    }
    if (method === 'POST' && path === '/api/chat/completions') {
      requests.push({ path, body });
      const chat = chats.get(body?.chat_id);
      if (!chat || !body?.id || !body?.user_message?.content || body.stream !== true) {
        return json({ detail: 'Bad request: chat_id, id, user_message and stream are required here' }, 400);
      }
      chat.assistantId = body.id;
      chat.request = body;
      chat.pollsLeft = busyPolls;
      if (scenario === 'noTask') return json({ status: true });
      chat.taskId = nextId('task');
      return json({ status: true, task_ids: [chat.taskId] });
    }
    const tasks = /^\/api\/tasks\/chat\/([^/]+)$/.exec(path);
    if (method === 'GET' && tasks) {
      const chat = chats.get(decodeURIComponent(tasks[1]));
      if (!chat) return json({ detail: 'Chat not found' }, 404);
      if (scenario === 'neverFinishes' || chat.pollsLeft > 0) {
        chat.pollsLeft -= 1;
        return json({ task_ids: [chat.taskId] });
      }
      return json({ task_ids: [] });
    }
    const one = /^\/api\/v1\/chats\/([^/]+)$/.exec(path);
    if (method === 'GET' && one) {
      const id = decodeURIComponent(one[1]);
      const chat = chats.get(id);
      if (!chat) return json({ detail: 'Chat not found' }, 404);
      return json({ id, chat: { history: { messages: { [chat.assistantId]: assistantMessage(chat) }, currentId: chat.assistantId } } });
    }
    if (method === 'DELETE' && one) {
      if (scenario === 'deleteFails') return json({ detail: 'Cannot delete' }, 500);
      return json(chats.delete(decodeURIComponent(one[1])));
    }
    return json({ detail: 'Not Found' }, 404);
  }

  /** The same service as a `fetch`, so tests can hand it to the code under test. Only the path and the headers are used. */
  const fetchFn = async (url, init = {}) => {
    const headers = Object.fromEntries([...new Headers(init.headers ?? {})].map(([k, v]) => [k.toLowerCase(), v]));
    const answerFor = handle({
      method: init.method ?? 'GET',
      path: new URL(url).pathname,
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return new Response(answerFor.body, { status: answerFor.status, headers: answerFor.headers });
  };

  return { handle, fetchFn, calls, chats, requests, agentId, apiKey };
}

/** The same service on a real local port (http, 127.0.0.1 only). */
export function startFakeServer(options = {}, port = 0) {
  const fake = createFakeOxygpt(options);
  const server = createServer((req, res) => {
    const parts = [];
    req.on('data', (part) => parts.push(part));
    req.on('end', () => {
      let body;
      const text = Buffer.concat(parts).toString('utf8');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'Invalid JSON' }));
          return;
        }
      }
      const answerFor = fake.handle({ method: req.method ?? 'GET', path: new URL(req.url ?? '/', 'http://x').pathname, headers: req.headers, body });
      res.writeHead(answerFor.status, answerFor.headers).end(answerFor.body);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ ...fake, server, port: server.address().port }));
  });
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const command = process.argv[2] ?? 'probe';
  if (command === 'scenarios') {
    for (const [name, text] of Object.entries(SCENARIOS)) console.log(`${name.padEnd(14)} ${text}`);
    return;
  }
  const scenario = option('scenario', 'ok');

  if (command === 'serve') {
    const fake = await startFakeServer({ scenario }, Number(option('port', '8787')));
    console.log(`Fake OxyGPT on http://127.0.0.1:${fake.port}  (scenario: ${scenario})`);
    console.log(`Key "${FAKE_KEY}", agent "${FAKE_AGENT}". Press Ctrl+C to stop. Requests are listed below.`);
    fake.server.on('request', (req) => console.log(`  ${req.method} ${req.url}`));
    return;
  }

  if (command === 'probe') {
    // Our own probe, as built for Fabric, against the fake over real HTTP. Only the host name is swapped on the way out
    // (the probe insists on https and a real name); the code under test is unchanged.
    const dist = (name) => import(new URL(`../packages/functions/dist/${name}.js`, import.meta.url).href);
    const { runOxygptProbe } = await dist('oxygpt');
    const { OXYGPT } = await dist('config');
    const { emptyProfile } = await dist('profile');

    const fake = await startFakeServer({ scenario });
    const FAKE_BASE = 'https://oxygpt.example.test';
    const fetchFn = (url, init) => fetch(String(url).replace(FAKE_BASE, `http://127.0.0.1:${fake.port}`), init);
    // A short wait, so the `neverFinishes` scenario can be tried in seconds instead of minutes.
    const settings = { ...OXYGPT, baseUrl: FAKE_BASE, agentTotalMs: Number(option('total-ms', '20000')), agentCleanupMs: 2_000, agentPollMs: 200 };
    const admin = { ...emptyProfile('OK', 'id', 'tester@example.test', 'Tester'), canManageAdmin: true };
    try {
      const result = await runOxygptProbe(
        { mode: option('mode', 'agent'), prompt: option('prompt', '') },
        'stand-in-token',
        () => 'stand-in-sql-token',
        () => FAKE_KEY,
        () => FAKE_AGENT,
        { fetchFn, settings, profile: async () => admin }
      );
      console.log(JSON.stringify(result, null, 2));
      console.log('\nRequests the fake service saw, in order:');
      for (const c of fake.calls) console.log(`  ${c.method.padEnd(6)} ${c.path}`);
      console.log(`\nChats still saved on the fake service: ${fake.chats.size}`);
    } finally {
      fake.server.close();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
