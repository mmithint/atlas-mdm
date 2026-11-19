/**
 * Calling an OxyGPT agent the way the client's own reference script does.
 *
 * Source: `TeamsFolder/oxy_agent.py` in the project folder (received from the client's Ops AI team on 18 Nov 2026,
 * "Call an OxyGPT workspace agent using its saved-chat API"). This is a port of that script, step for step. The
 * endpoints, the request bodies and the checks are the script's; nothing here was learned from the live service.
 *
 * Why it is not one `POST /api/chat/completions` that waits for the answer (what `text` mode in `oxygpt.ts` does):
 * an agent runs tools (SAP search, drawings search) and can take minutes, and a Fabric function is stopped at 250 s.
 * In the saved-chat flow the server does the work in the background, so every request here is short:
 *
 *   models    GET    /api/models                   find the agent, read its tools, skills, filters and features
 *   settings  GET    /api/v1/users/user/settings   the key owner's own settings (system prompt, memory, approval mode)
 *   create    POST   /api/v1/chats/new             a saved chat in the key owner's OxyGPT account
 *   start     POST   /api/chat/completions         with `stream: true`, `chat_id`, `session_id`: returns `task_ids` at once
 *   poll      GET    /api/tasks/chat/{chat}        repeated until none of our `task_ids` is still running
 *   collect   GET    /api/v1/chats/{chat}          the saved assistant message: text, tool calls, `done`, `error`
 *   delete    DELETE /api/v1/chats/{chat}          remove the chat (it holds the question and whatever the tools returned)
 *
 * The pieces are separate functions (`discoverAgent`, `createChat`, `startTurn`, `turnFinished`, `collectTurn`,
 * `deleteChat`) so the real caller (`extractNameplate`, APP-7) can start a turn in one function call and check on it
 * from another, which is the asynchronous pattern the client's Secure guide asks for (4.9). `runAgentTurn` runs all of
 * them in one call, inside a time budget, and is what the S5 probe uses.
 *
 * What the probe changes compared with the script (on purpose):
 *   - Every failure is a category plus words (`AgentFailure`), never an exception that loses where it happened.
 *   - A time budget (the Fabric limit is 250 s): the wait for the agent ends early and the chat is still cleaned up.
 *   - The chat is deleted after every turn except one that waits for a person (the script keeps the chat after any
 *     failure so a human can read it; an unattended function cannot leave chats behind in someone's account).
 *   - The result carries names and counts only (which tools ran, how many), never what they returned.
 *
 * This module never reads a secret and never logs: the caller owns the key, the transport and the log line.
 */
import { randomUUID } from 'node:crypto';

import type { OxygptCategory } from './oxygpt.js';

export type AgentStepName = 'models' | 'settings' | 'create' | 'start' | 'poll' | 'collect' | 'delete';

export interface AgentStepRecord {
  step: AgentStepName;
  /** False for the request that failed. */
  ok: boolean;
  /** HTTP status of the last request of this step, or null when none was answered. */
  httpStatus: number | null;
  /** Milliseconds spent in this step (all polls together for `poll`). */
  ms: number;
  /** How many requests the step made (more than one only for `poll`). */
  count: number;
}

export interface AgentConfigSummary {
  tools: number;
  skills: number;
  filters: number;
  /** Names of the features switched on for this turn (`web_search`, `memory`, …). */
  features: string[];
  terminal: boolean;
  systemPrompt: boolean;
  approvalMode: string | null;
}

export interface AgentReport {
  steps: AgentStepRecord[];
  polls: number;
  config: AgentConfigSummary | null;
  /** The tools the agent called while answering: how many calls and which tools (names as the service reports them). */
  toolCalls: { count: number; names: string[] } | null;
  /** True when the chat was removed from the key owner's account; null when no chat was created. */
  chatDeleted: boolean | null;
  /** Set only while the chat still exists (delete failed, or a tool waits for approval): open or delete it in OxyGPT. */
  chatId: string | null;
}

export interface AgentAnswer {
  text: string;
  model: string | null;
  toolCount: number;
  toolNames: string[];
}

export interface AgentRun {
  failure: AgentFailure | null;
  steps: AgentStepRecord[];
  polls: number;
  config: AgentConfigSummary | null;
  answer: AgentAnswer | null;
  chatDeleted: boolean | null;
  chatId: string | null;
}

/** One failed step, already put into the probe's category. Carries where it happened and what the server said. */
export class AgentFailure extends Error {
  readonly category: OxygptCategory;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  step: AgentStepName | null = null;

  constructor(category: OxygptCategory, message: string, detail: { httpStatus?: number | null; errorCode?: string | null } = {}) {
    super(message);
    this.name = 'AgentFailure';
    this.category = category;
    this.httpStatus = detail.httpStatus ?? null;
    this.errorCode = detail.errorCode ?? null;
  }
}

/** One request. Resolves with the parsed JSON of a 2xx answer; throws `AgentFailure` for everything else. */
export type AgentHttp = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: unknown,
  timeoutMs: number
) => Promise<{ status: number; json: unknown }>;

/** A request tagged with the step it belongs to, with the timeout and the step record handled by the caller. */
export type AgentCall = (step: AgentStepName, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<unknown>;

/** The clock and the id source, replaceable in tests. */
export interface AgentEnv {
  now(): number;
  sleep(ms: number): Promise<void>;
  newId(): string;
}

export const realEnv: AgentEnv = {
  now: () => performance.now(),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  newId: () => randomUUID(),
};

export interface AgentLimits {
  /** Each short request (models, settings, create, poll, collect). */
  stepTimeoutMs: number;
  /** The request that starts the turn (the script allows 30 s). */
  startTimeoutMs: number;
  /** A time on `AgentEnv.now()`'s clock after which the wait for the agent is given up. */
  deadline: number;
  /** The delete at the end. It runs even after the deadline, so the budget must leave room for it. */
  cleanupTimeoutMs: number;
  /** Pause between two polls. */
  pollMs: number;
}

/** What the agent's own saved settings add to every request (the script's `self.defaults`; wire names kept). */
export interface AgentDefaults {
  tool_ids: string[];
  skill_ids: string[];
  filter_ids: string[];
  features: Record<string, boolean>;
  terminal_id?: string;
  messages?: { role: 'system'; content: string }[];
  params?: { tool_approval_mode: unknown };
}

export interface AgentTurn {
  chatId: string;
  assistantId: string;
  taskIds: string[];
}

const MAX_NAME = 60;
const MAX_TOOL_NAMES = 20;
const MAX_ERROR_DETAIL = 200;
/** Features the script switches on only when the agent lists them as defaults and does not forbid them. */
const FEATURES = ['web_search', 'image_generation', 'code_interpreter'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const segment = (id: string): string => encodeURIComponent(id);

/** Step 1 and 2: find the agent and work out what its own settings add to a request (`OxyGPTAgent.__init__`). */
export async function discoverAgent(call: AgentCall, agentId: string): Promise<AgentDefaults> {
  const models = await call('models', 'GET', '/api/models');
  const list = isRecord(models) && Array.isArray(models['data']) ? (models['data'] as unknown[]) : null;
  if (list === null) {
    throw new AgentFailure('BAD_RESPONSE', 'The model list has no "data" list (the saved-chat flow reads data[].id and data[].info.meta).');
  }
  const model = list.find((entry) => isRecord(entry) && entry['id'] === agentId);
  if (!isRecord(model)) {
    throw new AgentFailure(
      'AGENT_NOT_LISTED',
      `The agent "${agentId.slice(0, MAX_NAME)}" is not among the ${list.length} models this key can use. Run "List models" and compare the IDs.`
    );
  }
  const meta = recordOf(recordOf(model['info'])['meta']);

  const settings = recordOf(await call('settings', 'GET', '/api/v1/users/user/settings'));
  const ui = recordOf(settings['ui']);

  // The script: `tools = meta.get("toolIds")`; only when that is missing or null does it fall back to the user's tools.
  const metaTools = meta['toolIds'];
  const tools = Array.isArray(metaTools) ? stringsOf(metaTools) : metaTools === undefined || metaTools === null ? stringsOf(ui['tools']) : [];

  const capabilities = recordOf(meta['capabilities']);
  const defaultFeatures = stringsOf(meta['defaultFeatureIds']);
  const features: Record<string, boolean> = {};
  for (const feature of FEATURES) {
    features[feature] = defaultFeatures.includes(feature) && (feature in capabilities ? Boolean(capabilities[feature]) : true);
  }
  features['memory'] = ui['memory'] !== false;

  const defaults: AgentDefaults = {
    tool_ids: tools.filter((tool) => !tool.startsWith('direct_server:')),
    skill_ids: stringsOf(meta['skillIds']),
    filter_ids: stringsOf(meta['defaultFilterIds']),
    features,
  };
  const terminalId = meta['terminalId'];
  if (typeof terminalId === 'string' && terminalId !== '' && ('terminal' in capabilities ? Boolean(capabilities['terminal']) : true)) {
    defaults.terminal_id = terminalId;
  }
  const system = ui['system'];
  if (typeof system === 'string' && system !== '') defaults.messages = [{ role: 'system', content: system }];
  const approvalMode = recordOf(ui['params'])['tool_approval_mode'];
  if (approvalMode !== undefined && approvalMode !== null) defaults.params = { tool_approval_mode: approvalMode };
  return defaults;
}

/** Counts and names only: what the probe may show about the agent's configuration (no prompt text, no tool arguments). */
export function summarizeDefaults(defaults: AgentDefaults): AgentConfigSummary {
  const mode = defaults.params?.tool_approval_mode;
  return {
    tools: defaults.tool_ids.length,
    skills: defaults.skill_ids.length,
    filters: defaults.filter_ids.length,
    features: Object.entries(defaults.features).flatMap(([name, on]) => (on ? [name] : [])),
    terminal: defaults.terminal_id !== undefined,
    systemPrompt: defaults.messages !== undefined,
    approvalMode: typeof mode === 'string' ? mode.slice(0, 40) : mode === undefined || mode === null ? null : 'set',
  };
}

/** Step 3: a saved chat for the turn (the script creates it lazily on the first `ask`). */
export async function createChat(call: AgentCall, agentId: string, title: string): Promise<string> {
  const created = await call('create', 'POST', '/api/v1/chats/new', {
    chat: { title, models: [agentId], history: { messages: {}, currentId: null } },
  });
  const id = isRecord(created) ? created['id'] : undefined;
  if (typeof id !== 'string' || id === '') throw new AgentFailure('BAD_RESPONSE', 'Creating the chat returned no chat id.');
  return id;
}

/** Step 4: start the turn. The server answers with background task ids and does the work on its own. */
export async function startTurn(
  call: AgentCall,
  env: AgentEnv,
  defaults: AgentDefaults,
  agentId: string,
  prompt: string,
  chat: { chatId: string; parentId: string | null }
): Promise<AgentTurn> {
  const assistantId = env.newId();
  const job = await call('start', 'POST', '/api/chat/completions', {
    ...defaults,
    model: agentId,
    stream: true,
    chat_id: chat.chatId,
    // A unique label selects the server's background saved-chat flow; it is not tied to the key or to a browser socket.
    session_id: `agent-api:${env.newId()}`,
    id: assistantId,
    parent_id: chat.parentId,
    user_message: { id: env.newId(), role: 'user', content: prompt, parentId: chat.parentId, models: [agentId] },
  });
  const taskIds = isRecord(job) ? stringsOf(job['task_ids']) : [];
  if (taskIds.length === 0) {
    throw new AgentFailure('AGENT_NO_TASK', 'OxyGPT did not return a background task for this turn (no task_ids in the answer).');
  }
  return { chatId: chat.chatId, assistantId, taskIds };
}

/** Step 5, one poll: true when none of the turn's tasks is still running (a task can run outlet filters after `done`). */
export async function turnFinished(call: AgentCall, turn: AgentTurn): Promise<boolean> {
  const active = await call('poll', 'GET', `/api/tasks/chat/${segment(turn.chatId)}`);
  const running = isRecord(active) && Array.isArray(active['task_ids']) ? stringsOf(active['task_ids']) : null;
  if (running === null) throw new AgentFailure('BAD_RESPONSE', 'The task list has no "task_ids" list.');
  return turn.taskIds.every((id) => !running.includes(id));
}

/** The text of the saved message, honouring text an outlet filter changed (the script's `reply_text`). */
export function agentReplyText(message: Record<string, unknown>): string {
  const output = message['output'];
  if ('originalContent' in message || !Array.isArray(output) || output.length === 0) {
    const content = message['content'];
    return typeof content === 'string' ? content : '';
  }
  return output
    .flatMap((item: unknown) =>
      isRecord(item) && item['type'] === 'message' && item['role'] === 'assistant' && Array.isArray(item['content'])
        ? (item['content'] as unknown[]).flatMap((part) =>
            isRecord(part) && part['type'] === 'output_text' && typeof part['text'] === 'string' && part['text'] !== '' ? [part['text']] : []
          )
        : []
    )
    .join('\n');
}

const toolCallsOf = (output: unknown[], pendingOnly: boolean): Record<string, unknown>[] =>
  output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item['type'] === 'function_call' && (!pendingOnly || item['status'] === 'pending')
  );

const namesOf = (calls: Record<string, unknown>[]): string[] => {
  const names: string[] = [];
  for (const entry of calls) {
    const name = entry['name'];
    if (typeof name === 'string' && name !== '' && !names.includes(name.slice(0, MAX_NAME))) names.push(name.slice(0, MAX_NAME));
  }
  return names.slice(0, MAX_TOOL_NAMES);
};

function errorDetail(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    for (const key of ['content', 'message', 'detail']) {
      const value = error[key];
      if (typeof value === 'string') return value;
    }
  }
  return '';
}

/** Step 6: read the saved message and check it, in the script's order: pending tool, error, `done`. */
export async function collectTurn(call: AgentCall, turn: AgentTurn): Promise<AgentAnswer> {
  const saved = await call('collect', 'GET', `/api/v1/chats/${segment(turn.chatId)}`);
  const messages = recordOf(recordOf(recordOf(saved)['chat'])['history'])['messages'];
  const message = isRecord(messages) ? messages[turn.assistantId] : undefined;
  if (!isRecord(message)) throw new AgentFailure('AGENT_FAILED', 'OxyGPT did not save an assistant message for this turn.');

  const output = Array.isArray(message['output']) ? (message['output'] as unknown[]) : [];
  const waiting = toolCallsOf(output, true);
  if (waiting.length > 0) {
    const names = namesOf(waiting);
    throw new AgentFailure(
      'AGENT_WAITING',
      `The agent is waiting for tool approval or input${names.length > 0 ? ` (${names.join(', ')})` : ''}. Open the saved chat in OxyGPT to respond, or ask Ops AI to switch tool approval off for API use.`
    );
  }
  if (message['error']) {
    const detail = errorDetail(message['error']).slice(0, MAX_ERROR_DETAIL);
    throw new AgentFailure('AGENT_FAILED', `OxyGPT reported an error in the saved assistant message${detail ? `: ${detail}` : ''}.`);
  }
  if (!message['done']) throw new AgentFailure('AGENT_FAILED', 'The task ended without a completed assistant message.');

  const calls = toolCallsOf(output, false);
  const model = message['model'];
  return {
    text: agentReplyText(message),
    model: typeof model === 'string' ? model.slice(0, 100) : null,
    toolCount: calls.length,
    toolNames: namesOf(calls),
  };
}

/** Step 7: remove the chat. True only when the service confirms with `true` (as the script requires). */
export async function deleteChat(call: AgentCall, chatId: string): Promise<boolean> {
  return (await call('delete', 'DELETE', `/api/v1/chats/${segment(chatId)}`)) === true;
}

export interface AgentRunParams {
  agentId: string;
  prompt: string;
  /** Shown in the key owner's chat list while the chat exists. */
  title: string;
  limits: AgentLimits;
}

/** The report the probe returns to the page: the run without the answer text and without the failure object. */
export function agentReport(run: AgentRun): AgentReport {
  return {
    steps: run.steps,
    polls: run.polls,
    config: run.config,
    toolCalls: run.answer ? { count: run.answer.toolCount, names: run.answer.toolNames } : null,
    chatDeleted: run.chatDeleted,
    chatId: run.chatId,
  };
}

/**
 * The whole turn in one call, inside the time budget in `limits`: discover, create, start, poll, collect, delete.
 * Never throws: a failure is in `run.failure`, with the steps done so far. The chat is deleted afterwards unless a tool
 * waits for a person (then `run.chatId` says which chat to open).
 */
export async function runAgentTurn(http: AgentHttp, env: AgentEnv, params: AgentRunParams): Promise<AgentRun> {
  const { agentId, prompt, title, limits } = params;
  const run: AgentRun = { failure: null, steps: [], polls: 0, config: null, answer: null, chatDeleted: null, chatId: null };
  const began = env.now();
  let chatId: string | null = null;

  const record = (step: AgentStepName, ok: boolean, httpStatus: number | null, ms: number): void => {
    const last = run.steps[run.steps.length - 1];
    if (step === 'poll' && last?.step === 'poll') {
      last.ok = ok;
      last.httpStatus = httpStatus;
      last.ms += ms;
      last.count += 1;
    } else {
      run.steps.push({ step, ok, httpStatus, ms, count: 1 });
    }
    if (step === 'poll') run.polls += 1;
  };

  const call: AgentCall = async (step, method, path, body) => {
    const startedAt = env.now();
    const cleanup = step === 'delete';
    const remaining = limits.deadline - startedAt;
    if (!cleanup && remaining <= 0) {
      const failure = new AgentFailure('TIMEOUT', `The time budget of this call ran out before the "${step}" step.`);
      failure.step = step;
      throw failure;
    }
    const own = step === 'start' ? limits.startTimeoutMs : cleanup ? limits.cleanupTimeoutMs : limits.stepTimeoutMs;
    const timeoutMs = cleanup ? own : Math.max(1, Math.min(own, Math.floor(remaining)));
    try {
      const answer = await http(method, path, body, timeoutMs);
      record(step, true, answer.status, Math.round(env.now() - startedAt));
      return answer.json;
    } catch (err) {
      const failure = err instanceof AgentFailure ? err : new AgentFailure('NETWORK', err instanceof Error ? err.message : String(err));
      failure.step = failure.step ?? step;
      record(step, false, failure.httpStatus, Math.round(env.now() - startedAt));
      throw failure;
    }
  };

  try {
    const defaults = await discoverAgent(call, agentId);
    run.config = summarizeDefaults(defaults);
    chatId = await createChat(call, agentId, title);
    const turn = await startTurn(call, env, defaults, agentId, prompt, { chatId, parentId: null });

    for (;;) {
      if (env.now() >= limits.deadline) {
        const failure = new AgentFailure(
          'TIMEOUT',
          `The agent had not finished after ${Math.round((env.now() - began) / 1000)} s. It may still be running on the OxyGPT side.`
        );
        failure.step = 'poll';
        throw failure;
      }
      if (await turnFinished(call, turn)) break;
      await env.sleep(Math.max(0, Math.min(limits.pollMs, limits.deadline - env.now())));
    }
    run.answer = await collectTurn(call, turn);
  } catch (err) {
    run.failure = err instanceof AgentFailure ? err : new AgentFailure('NETWORK', err instanceof Error ? err.message : String(err));
  }

  // Clean up the saved chat, whatever happened, except while a tool waits for a person to answer in it.
  if (chatId !== null) {
    if (run.failure?.category === 'AGENT_WAITING') {
      run.chatDeleted = false;
    } else {
      try {
        run.chatDeleted = await deleteChat(call, chatId);
      } catch {
        run.chatDeleted = false;
      }
    }
    run.chatId = run.chatDeleted ? null : chatId;
  }
  return run;
}
