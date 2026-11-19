/**
 * Spike S5: can a deployed Rayfin function reach OxyGPT, the client's internal AI service, and get an answer?
 * (APP-4 era; removed in APP-10 with the other spikes. The real caller is `extractNameplate`, APP-7.)
 *
 * Why this exists: a laptop on the client VPN can reach OxyGPT, but a Fabric function runs in Microsoft's cloud
 * and cannot join a VPN. Nothing in the documents says whether `ai-dev.oxy.com` is visible from there, so this
 * probe measures it, one layer at a time, and names the layer that fails:
 *
 *   dns      Does the host name resolve from the Fabric runtime, and to a private or a public address?
 *            (A private address, 10.x or 192.168.x, means Fabric cannot reach it however the code is written.)
 *   models   Can it open a TLS connection, authenticate with the key, and list the models? Returns the model IDs,
 *            so the exact agent ID can be copied from the deployed app when the laptop has no VPN yet.
 *   text     Can it send a question and read an answer? The question is typed on the spikes page.
 *   agent    Can it run the whole saved-chat flow of the client's reference script (`oxy_agent.py`: create a chat,
 *            start the agent, poll until it is done, read the saved answer, delete the chat) and did the agent's
 *            tools run? Added 19 Nov; the flow itself is in `oxygpt-agent.ts`. Needs everything `text` needs.
 *
 * Rules kept from the client's Secure guide (4.4, 4.7, 4.8) and from D-19:
 *   - The caller is a verified Admin. The probe spends one shared key and, in `text` mode, forwards free text,
 *     so it is not open to every registered person (decided with the project lead, 18 Nov).
 *   - The browser chooses only `mode` and the question. The address is fixed in `config.ts`; the key and the agent's
 *     ID are the secrets `OXY_GPT_API_KEY` and `OXYGPT_AGENT_MODEL_ID` (set in Fabric by the project team); none can
 *     be changed from the page.
 *   - TLS verification is never switched off; redirects are not followed (a sign-in page is a finding, not a path).
 *   - The key, the question and the answer are never logged. The log line holds the mode, the outcome category,
 *     the HTTP status and the time. The answer goes back only to the Admin who asked (capped), nowhere else.
 *   - Failures come back as data (`category`, `error`), never thrown, so the browser sees the cause.
 */
import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';

import { OXYGPT } from './config.js';
import {
  AgentFailure,
  agentReport,
  realEnv,
  runAgentTurn,
  type AgentEnv,
  type AgentHttp,
  type AgentReport,
} from './oxygpt-agent.js';
import { loadMyProfile, type MyProfile } from './profile.js';

export type OxygptMode = 'dns' | 'models' | 'text' | 'agent';

export type OxygptCategory =
  | 'NOT_AUTHENTICATED' // the token did not verify (D-19)
  | 'NOT_REGISTERED' // a valid token, but no admin has linked it to a person
  | 'NOT_ADMIN' // registered, but not an Admin
  | 'BAD_INPUT' // unknown mode, or a question that is too long
  | 'NOT_CONFIGURED' // base URL or model ID missing in config.ts
  | 'NO_SECRET' // OXY_GPT_API_KEY was not delivered to the function
  | 'IDENTITY_ERROR' // the database could not be asked who the caller is
  | 'DNS' // the host name did not resolve
  | 'NETWORK' // connection refused, reset or unreachable
  | 'TIMEOUT' // no answer in time
  | 'TLS' // certificate not trusted or wrong host
  | 'REDIRECT' // the server answered with a redirect (often a sign-in page)
  | 'HTTP_401' // the key was refused
  | 'HTTP_403' // the key may not do this (model or agent not allowed)
  | 'HTTP_429' // rate limited
  | 'HTTP_OTHER' // any other error status
  | 'BAD_RESPONSE' // 200, but not the JSON shape the guide documents
  | 'AGENT_NOT_LISTED' // `agent` mode: the agent's ID is not among the models this key can use
  | 'AGENT_NO_TASK' // `agent` mode: the turn was accepted but no background task came back
  | 'AGENT_WAITING' // `agent` mode: a tool is waiting for a person to approve it (the chat is kept)
  | 'AGENT_FAILED'; // `agent` mode: the saved message holds an error, is not done, or is missing

export interface OxygptProbeResult {
  /** True only when the requested layer worked end to end. */
  ok: boolean;
  mode: OxygptMode | null;
  /** Why it did not work; null when ok. */
  category: OxygptCategory | null;
  /** The host the probe is aimed at (a name, not a secret). */
  host: string;
  /** HTTP status of the last request made, or null if none was made. */
  httpStatus: number | null;
  /** The path that answered (models mode tries the three routes the Getting Started guide tries). */
  route: string | null;
  totalMs: number;
  /** `dns` mode: how many addresses, and whether they are private (not reachable from Fabric) or public. */
  dns: { addressCount: number; scope: 'PRIVATE' | 'PUBLIC' | 'MIXED' } | null;
  /** `models` mode: how many models, the first IDs as printed, and whether the configured one is among them. */
  models: { count: number; ids: string[]; configuredListed: boolean | null } | null;
  /** `text` and `agent` mode: the answer (capped) and the token counts the service reports (`agent`: none reported). */
  reply: { text: string; truncated: boolean; model: string | null; promptTokens: number | null; completionTokens: number | null } | null;
  /** `agent` mode: the steps of the saved-chat flow with their statuses and times, which tools ran, and whether the chat was removed. */
  agent: AgentReport | null;
  /** The low-level error code (ENOTFOUND, ETIMEDOUT, CERT_HAS_EXPIRED, …) when there was one. */
  errorCode: string | null;
  /** What went wrong, in words, with the key removed; null when ok. */
  error: string | null;
}

/** The settings the probe reads; the tests pass their own. */
export interface OxygptSettings {
  baseUrl: string;
  modelId: string;
  listTimeoutMs: number;
  textTimeoutMs: number;
  maxPromptChars: number;
  maxReplyChars: number;
  /** `agent` mode: each short request of the flow. */
  agentStepTimeoutMs: number;
  /** `agent` mode: the request that starts the turn. */
  agentStartTimeoutMs: number;
  /** `agent` mode: the whole call, counted from the first line of the function. Must stay under Fabric's 250 s. */
  agentTotalMs: number;
  /** `agent` mode: the part of the total kept back for deleting the chat. */
  agentCleanupMs: number;
  /** `agent` mode: the pause between two polls. */
  agentPollMs: number;
}

export interface OxygptDeps {
  fetchFn: typeof fetch;
  lookupFn: (host: string) => Promise<{ address: string }[]>;
  profile: (accessToken: string | null | undefined, getSqlToken: () => string) => Promise<MyProfile>;
  settings: OxygptSettings;
  /** The clock, the pause and the id source of `agent` mode (the tests replace them). */
  env: AgentEnv;
}

export interface OxygptProbeInput {
  mode: string;
  prompt: string;
}

/** The three routes the client's Getting Started guide tries, in its order; the next is tried only after a 404. */
const MODEL_ROUTES = ['/api/models', '/v1/models', '/api/v1/models'] as const;
const CHAT_ROUTE = '/api/chat/completions';
const DEFAULT_PROMPT = 'Reply with the single word: pong';
const MAX_ERROR = 300;
const MAX_MODEL_IDS = 100;
const MAX_ID_LENGTH = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The error code buried in a fetch failure (`TypeError: fetch failed` carries it in `cause`). */
function errorCodeOf(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (isRecord(current) || current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && code !== '') return code;
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return null;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NODATA', 'EAI_NONAME']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const TLS_CODE = /^(CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|ERR_TLS_|ERR_SSL|HOSTNAME_MISMATCH|EPROTO)/;

/** Puts a failed call into one category. Exported for the tests. */
export function classifyFailure(err: unknown): { category: OxygptCategory; code: string | null } {
  const code = errorCodeOf(err);
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError' || (code !== null && TIMEOUT_CODES.has(code))) {
    return { category: 'TIMEOUT', code };
  }
  if (code !== null && DNS_CODES.has(code)) return { category: 'DNS', code };
  if (code !== null && TLS_CODE.test(code)) return { category: 'TLS', code };
  return { category: 'NETWORK', code };
}

/** True for an address that only exists inside a private network (so Fabric's cloud cannot reach it). */
export function isPrivateAddress(address: string): boolean {
  const text = address.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  const candidate = mapped?.[1] ?? text;
  if (isIPv4(candidate)) {
    const [a = 0, b = 0] = candidate.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return candidate === '::1' || candidate === '::' || /^f[cd]/.test(candidate) || /^fe[89ab]/.test(candidate);
}

function scrub(text: string, key: string): string {
  const cleaned = key ? text.split(key).join('[key]') : text;
  return cleaned.slice(0, MAX_ERROR);
}

function blank(mode: OxygptMode | null, host: string): OxygptProbeResult {
  return {
    ok: false,
    mode,
    category: null,
    host,
    httpStatus: null,
    route: null,
    totalMs: 0,
    dns: null,
    models: null,
    reply: null,
    agent: null,
    errorCode: null,
    error: null,
  };
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return '';
  }
}

/** The model IDs in whatever shape the service returns them (`{data:[{id}]}`, `{models:[…]}` or a bare list). */
export function modelIdsOf(body: unknown): string[] | null {
  const list = Array.isArray(body)
    ? body
    : isRecord(body)
      ? Array.isArray(body['data'])
        ? (body['data'] as unknown[])
        : Array.isArray(body['models'])
          ? (body['models'] as unknown[])
          : null
      : null;
  if (!list) return null;
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') ids.push(entry);
    else if (isRecord(entry) && typeof entry['id'] === 'string') ids.push(entry['id']);
  }
  return ids;
}

/** The answer text of a chat completion: `choices[0].message.content`, a string or a list of text parts. */
export function replyTextOf(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body['choices'])) return null;
  const first: unknown = body['choices'][0];
  const message = isRecord(first) ? first['message'] : null;
  const content = isRecord(message) ? message['content'] : null;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.flatMap((part: unknown) =>
      isRecord(part) && typeof part['text'] === 'string' ? [part['text']] : []
    );
    return parts.length > 0 ? parts.join('') : null;
  }
  return null;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Category for a response that is not 200. */
function categoryForStatus(status: number): OxygptCategory {
  if (status === 401) return 'HTTP_401';
  if (status === 403) return 'HTTP_403';
  if (status === 429) return 'HTTP_429';
  if (status >= 300 && status < 400) return 'REDIRECT';
  return 'HTTP_OTHER';
}

function hintForStatus(status: number): string {
  if (status === 401) return 'The key was refused (401): wrong, expired, or the secret was not delivered.';
  if (status === 403) return 'Forbidden (403): the key is valid but may not use this model or agent.';
  if (status === 429) return 'Too many requests (429): wait and try again.';
  if (status >= 300 && status < 400) return `The server redirected (${status}), often to a sign-in page; redirects are not followed.`;
  return `The service answered ${status}.`;
}

/** The short `detail` / `error.message` an error answer usually carries; nothing else of the body is kept. */
function errorDetailOf(raw: string): string {
  const body = parseJson(raw);
  if (isRecord(body)) {
    const detail = body['detail'];
    if (typeof detail === 'string') return detail;
    const error = body['error'];
    if (typeof error === 'string') return error;
    if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  }
  return '';
}

/** Reads a value that may be missing: a secret that was never delivered throws, which here means "empty". */
function readOrEmpty(read: () => string): string {
  try {
    return read().trim();
  } catch {
    return '';
  }
}

/** The names the secrets carry in Fabric (the project team set them; `function_app.ts` reads them by these names). */
export const SECRET_API_KEY = 'OXY_GPT_API_KEY';
export const SECRET_MODEL_ID = 'OXYGPT_AGENT_MODEL_ID';

export async function runOxygptProbe(
  input: OxygptProbeInput,
  accessToken: string | null | undefined,
  getSqlToken: () => string,
  getKey: () => string,
  getModelId: () => string,
  overrides: Partial<OxygptDeps> = {}
): Promise<OxygptProbeResult> {
  const deps: OxygptDeps = {
    fetchFn: overrides.fetchFn ?? fetch,
    lookupFn: overrides.lookupFn ?? ((host) => lookup(host, { all: true })),
    profile: overrides.profile ?? loadMyProfile,
    settings: overrides.settings ?? OXYGPT,
    env: overrides.env ?? realEnv,
  };
  const { settings } = deps;
  const base = settings.baseUrl.replace(/\/+$/, '');
  const host = hostOf(base);
  const started = deps.env.now();
  const modeIsKnown = input.mode === 'dns' || input.mode === 'models' || input.mode === 'text' || input.mode === 'agent';
  const result = blank(modeIsKnown ? (input.mode as OxygptMode) : null, host);
  let key = '';

  const fail = (category: OxygptCategory, error: string): OxygptProbeResult => {
    result.category = category;
    result.error = scrub(error, key);
    return result;
  };

  try {
    // 1. Who is asking? Nothing below runs for anyone who is not a verified, registered Admin.
    let profile: MyProfile;
    try {
      profile = await deps.profile(accessToken, getSqlToken);
    } catch (err) {
      return fail('IDENTITY_ERROR', err instanceof Error ? err.message : String(err));
    }
    if (profile.status === 'NOT_AUTHENTICATED') return fail('NOT_AUTHENTICATED', 'You are not signed in.');
    if (profile.status === 'NOT_REGISTERED') return fail('NOT_REGISTERED', 'Your sign-in is not linked to a registered person.');
    if (!profile.canManageAdmin) return fail('NOT_ADMIN', 'Only an Admin may run the OxyGPT test.');

    // 2. What was asked, and is the probe set up for it?
    if (!modeIsKnown) return fail('BAD_INPUT', 'The mode must be dns, models, text or agent.');
    const mode = input.mode as OxygptMode;
    if (!host || !base.startsWith('https://')) return fail('NOT_CONFIGURED', 'OXYGPT.baseUrl in config.ts must be an https address.');

    const prompt = input.prompt.trim() === '' ? DEFAULT_PROMPT : input.prompt.trim();
    if ((mode === 'text' || mode === 'agent') && prompt.length > settings.maxPromptChars) {
      return fail('BAD_INPUT', `The question is ${prompt.length} characters; the limit is ${settings.maxPromptChars}.`);
    }

    // 3. dns: only the name lookup. No key is needed, and none is read.
    if (mode === 'dns') {
      try {
        const addresses = await Promise.race([
          deps.lookupFn(host),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error('Name lookup timed out'), { name: 'TimeoutError' })), settings.listTimeoutMs).unref();
          }),
        ]);
        const privateCount = addresses.filter((a) => isPrivateAddress(a.address)).length;
        result.dns = {
          addressCount: addresses.length,
          scope: privateCount === 0 ? 'PUBLIC' : privateCount === addresses.length ? 'PRIVATE' : 'MIXED',
        };
        if (addresses.length === 0) return fail('DNS', 'The name resolved to no address.');
        result.ok = true;
        return result;
      } catch (err) {
        const { category, code } = classifyFailure(err);
        result.errorCode = code;
        return fail(category, `Name lookup failed${code ? ` (${code})` : ''}.`);
      }
    }

    // 4. models, text and agent need the key. A missing secret is reported, never worked around.
    key = readOrEmpty(getKey);
    if (!key) {
      return fail('NO_SECRET', `The secret ${SECRET_API_KEY} was not delivered to the function. Check the name with npx rayfin secret list (or where the value was set in Fabric), then npx rayfin up.`);
    }
    // The agent's ID comes from the secret `OXYGPT_AGENT_MODEL_ID`; `config.ts` is only a fallback. It is not a secret.
    const modelId = readOrEmpty(getModelId) || settings.modelId;
    if ((mode === 'text' || mode === 'agent') && !modelId) {
      return fail('NOT_CONFIGURED', `No agent ID: the secret ${SECRET_MODEL_ID} is empty or missing, and OXYGPT.modelId in config.ts is empty. Run "List models" and copy the ID exactly as printed.`);
    }

    const call = async (path: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; raw: string; type: string } | null> => {
      try {
        const res = await deps.fetchFn(`${base}${path}`, {
          ...init,
          redirect: 'manual',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) },
          signal: AbortSignal.timeout(timeoutMs),
        });
        result.httpStatus = res.status;
        result.route = path;
        const raw = await res.text();
        return { status: res.status, raw, type: res.headers.get('content-type') ?? '' };
      } catch (err) {
        const { category, code } = classifyFailure(err);
        result.errorCode = code;
        const message = category === 'TIMEOUT' ? `No answer within ${Math.round(timeoutMs / 1000)} s.` : `The connection failed${code ? ` (${code})` : ''}.`;
        fail(category, message);
        return null;
      }
    };

    // 5a. agent: the saved-chat flow of the client's reference script (oxygpt-agent.ts). Every request goes through
    // this one transport, so the key, the no-redirect rule, the time limit and the failure categories are the same as above.
    if (mode === 'agent') {
      const agentHttp: AgentHttp = async (method, path, body, timeoutMs) => {
        let status: number;
        let type: string;
        let raw: string;
        try {
          const res = await deps.fetchFn(`${base}${path}`, {
            method,
            redirect: 'manual',
            headers: {
              Authorization: `Bearer ${key}`,
              Accept: 'application/json',
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
          });
          status = res.status;
          type = res.headers.get('content-type') ?? '';
          raw = await res.text();
        } catch (err) {
          const { category, code } = classifyFailure(err);
          const message = category === 'TIMEOUT' ? `No answer within ${Math.round(timeoutMs / 1000)} s.` : `The connection failed${code ? ` (${code})` : ''}.`;
          throw new AgentFailure(category, scrub(message, key), { errorCode: code });
        }
        result.httpStatus = status;
        if (status < 200 || status >= 300) {
          const detail = errorDetailOf(raw);
          throw new AgentFailure(categoryForStatus(status), scrub(`${hintForStatus(status)}${detail ? ` ${detail}` : ''}`, key), { httpStatus: status });
        }
        // The script insists on application/json: anything else is a sign-in page or a gateway, not the API.
        if ((type.split(';')[0] ?? '').trim().toLowerCase() !== 'application/json') {
          throw new AgentFailure('BAD_RESPONSE', `Status ${status} but the content type was "${type.slice(0, 60)}", not JSON. A sign-in page instead of the API would look like this.`, { httpStatus: status });
        }
        const json = parseJson(raw);
        if (json === undefined) throw new AgentFailure('BAD_RESPONSE', `Status ${status} with a JSON content type but a body that is not valid JSON.`, { httpStatus: status });
        return { status, json };
      };

      const run = await runAgentTurn(agentHttp, deps.env, {
        agentId: modelId,
        prompt,
        title: 'ATLAS connection test',
        limits: {
          stepTimeoutMs: settings.agentStepTimeoutMs,
          startTimeoutMs: settings.agentStartTimeoutMs,
          // The wait ends early enough to leave `agentCleanupMs` for deleting the chat before Fabric's own 250 s limit.
          deadline: started + settings.agentTotalMs - settings.agentCleanupMs,
          cleanupTimeoutMs: settings.agentCleanupMs,
          pollMs: settings.agentPollMs,
        },
      });
      result.agent = agentReport(run);
      if (run.failure) {
        result.errorCode = run.failure.errorCode;
        if (run.failure.httpStatus !== null) result.httpStatus = run.failure.httpStatus;
        const where = run.failure.step ? `Step "${run.failure.step}": ` : '';
        return fail(run.failure.category, `${where}${run.failure.message}`);
      }
      const answer = run.answer;
      if (answer === null || answer.text.trim() === '') {
        return fail('BAD_RESPONSE', 'The agent finished but returned no answer text.');
      }
      result.reply = {
        text: answer.text.slice(0, settings.maxReplyChars),
        truncated: answer.text.length > settings.maxReplyChars,
        model: answer.model,
        promptTokens: null,
        completionTokens: null,
      };
      result.ok = true;
      return result;
    }

    // 5b. models: list what this key may use.
    if (mode === 'models') {
      let answer: { status: number; raw: string; type: string } | null = null;
      for (const route of MODEL_ROUTES) {
        answer = await call(route, { method: 'GET' }, settings.listTimeoutMs);
        if (!answer || answer.status !== 404) break;
      }
      if (!answer) return result;
      if (answer.status !== 200) {
        const detail = errorDetailOf(answer.raw);
        return fail(categoryForStatus(answer.status), `${hintForStatus(answer.status)}${detail ? ` ${detail}` : ''}`);
      }
      const ids = modelIdsOf(parseJson(answer.raw));
      if (ids === null) {
        return fail('BAD_RESPONSE', `Status 200 but no model list (content type "${answer.type.slice(0, 60)}"). A sign-in page instead of the API would look like this.`);
      }
      result.models = {
        count: ids.length,
        ids: ids.slice(0, MAX_MODEL_IDS).map((id) => id.slice(0, MAX_ID_LENGTH)),
        configuredListed: modelId ? ids.includes(modelId) : null,
      };
      result.ok = true;
      return result;
    }

    // 6. text: one question, one answer.
    const answer = await call(
      CHAT_ROUTE,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }),
      },
      settings.textTimeoutMs
    );
    if (!answer) return result;
    if (answer.status !== 200) {
      const detail = errorDetailOf(answer.raw);
      return fail(categoryForStatus(answer.status), `${hintForStatus(answer.status)}${detail ? ` ${detail}` : ''}`);
    }
    const body = parseJson(answer.raw);
    const text = replyTextOf(body);
    if (text === null || text.trim() === '') {
      return fail('BAD_RESPONSE', `Status 200 but no answer text (content type "${answer.type.slice(0, 60)}").`);
    }
    const usage = isRecord(body) && isRecord(body['usage']) ? body['usage'] : {};
    const echoed = isRecord(body) && typeof body['model'] === 'string' ? body['model'].slice(0, MAX_ID_LENGTH) : null;
    result.reply = {
      text: text.slice(0, settings.maxReplyChars),
      truncated: text.length > settings.maxReplyChars,
      model: echoed,
      promptTokens: numberOrNull(usage['prompt_tokens']),
      completionTokens: numberOrNull(usage['completion_tokens']),
    };
    result.ok = true;
    return result;
  } catch (err) {
    // Anything not foreseen above: say so in words, without the key.
    return fail('NETWORK', err instanceof Error ? err.message : String(err));
  } finally {
    result.totalMs = Math.round(deps.env.now() - started);
    // Names and numbers only: never the key, the question or the answer.
    console.log(
      `oxygptProbe: mode=${result.mode ?? 'none'} ok=${result.ok} category=${result.category ?? 'none'} status=${result.httpStatus ?? 'none'} totalMs=${result.totalMs}`
    );
  }
}
