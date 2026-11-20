import { useContext, useState } from 'react';

import { AuthContext } from '@/hooks/auth.context';
import { getRayfinClient } from '@/lib/rayfin-client';

import { unwrapRead } from '../equipment/equipment-api';
import {
  compareBrowserIdentity,
  type BrowserUser,
} from './browser-identity';
import { runPagingSpike } from './s7-paging';

/**
 * TEMPORARY (APP-0, removed in APP-10): buttons that call the spike
 * functions and show the raw result so it can be pasted back to Claude.
 * Results never contain tokens (see packages/functions/src/spikes.ts).
 */

type SpikeState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; text: string }
  | { status: 'failed'; text: string };

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 500 ? `${m.slice(0, 500)}…` : m;
}

async function runWhoAmI(browserUser: BrowserUser | null) {
  const result = await (await getRayfinClient()).functions.whoAmI.invoke();
  // `browserSession` is added here, in the browser: it is not part of the function's answer.
  return {
    ...result,
    browserSession: compareBrowserIdentity(browserUser, result.claims.sub),
  };
}

async function runSqlPing() {
  return (await getRayfinClient()).functions.sqlPing.invoke();
}

// S4: can a function write a file to the lakehouse Files area through OneLake?
async function runStorageProbe() {
  return (await getRayfinClient()).functions.storageProbe.invoke();
}

// S7 / latency gate (D-17): time the real read functions, page by page and one-off.
async function runReadTiming() {
  const { functions } = await getRayfinClient();
  const search = async (over: Partial<Parameters<typeof functions.searchEquipment.invoke>[0]>) =>
    unwrapRead(
      await functions.searchEquipment.invoke({
        mode: 'SORTED',
        searchColumn: 'equipmentTagNumber',
        searchText: '',
        facility: '',
        sortColumn: 'equipmentId',
        sortDirection: 'asc',
        offset: 0,
        pageSize: 50,
        filtersJson: '',
        ...over,
      })
    );

  // The heater the detail call asks about: the first one of the first page. Taken from a page that is
  // read anyway, so no extra call sits inside the detail timing (it used to, and overstated it).
  let firstHeaterId: number | undefined;

  return runPagingSpike({
    page: async (cursor, size) => {
      const offset = cursor ? Number(cursor) : 0;
      const answer = await search({ offset, pageSize: size });
      firstHeaterId ??= answer.rows[0]?.equipmentId;
      return {
        keys: answer.rows.map((row) => row.equipmentId),
        hasNext: answer.hasMore,
        endCursor: answer.hasMore ? String(offset + answer.rows.length) : null,
        serverMs: answer.timing.totalMs,
      };
    },
    filtered: async () => {
      const answer = await search({ searchText: 'SYN-TAG-1', sortColumn: 'equipmentTagNumber', sortDirection: 'desc' });
      return { rows: answer.rows.length, serverMs: answer.timing.totalMs };
    },
    bestMatch: async () => {
      const answer = await search({ mode: 'MATCH', searchText: 'SYN-TAG-000', pageSize: 100 });
      return { rows: answer.rows.length, serverMs: answer.timing.totalMs };
    },
    detail: async () => {
      const equipmentId = firstHeaterId;
      if (equipmentId === undefined) return { rows: 0, serverMs: null };
      try {
        const answer = unwrapRead(await functions.getEquipmentDetail.invoke({ equipmentId }));
        return { rows: answer.found ? 1 : 0, serverMs: answer.timing.totalMs };
      } catch (error) {
        // Say what this side sent, so a refusal can be traced to the browser or the platform.
        const said = error instanceof Error ? error.message : String(error);
        throw new Error(`${said} [the browser sent equipmentId as ${typeof equipmentId} ${String(equipmentId)}]`);
      }
    },
  });
}

// ---- APP-3 scratch card: the request write path, one call at a time -------------------------
// Removed with the rest of this page in APP-10. It creates and decides REAL requests on the synthetic stub as
// the signed-in person (the server finds out who from the token; nothing here sends an e-mail address).

/** The field the scratch request changes: Manufacturer is a plain text field every heater has. */
const SCRATCH_FIELD = 'MANUFACTURER';

async function runScratchCreate(heaterId: number) {
  const { functions } = await getRayfinClient();
  // The value the person "saw" comes from the same detail read the heater screen uses.
  const detail = unwrapRead(await functions.getEquipmentDetail.invoke({ equipmentId: heaterId }));
  if (!detail.found || detail.heater === null) return { ok: false, error: `Heater ${String(heaterId)} was not found.` };
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  return functions.createChangeRequest.invoke({
    source: 'MANUAL',
    entityType: 'EQUIPMENT',
    equipmentId: heaterId,
    functionalLocation: '',
    fieldCode: SCRATCH_FIELD,
    oldValue: detail.heater.manufacturer ?? '',
    newValue: `SCRATCH ${stamp}`,
    reason: 'APP-3 scratch call from the spikes page',
    comment: '',
    evidenceJson: '',
  });
}

function WritePathCard() {
  const [heaterId, setHeaterId] = useState('2');
  const [requestId, setRequestId] = useState('');
  const [decision, setDecision] = useState('APPROVE');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<SpikeState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const requestNumber = Number(requestId);
  const heaterNumber = Number(heaterId);

  const go = async (run: () => Promise<unknown>) => {
    setCopied(false);
    setState({ status: 'running' });
    try {
      const result = await run();
      setState({ status: 'done', text: JSON.stringify(result, null, 2) });
      // Hand the new request number to the other buttons.
      const made = (result as { requestId?: unknown } | null)?.requestId;
      if (typeof made === 'number') setRequestId(String(made));
    } catch (e) {
      setState({ status: 'failed', text: describe(e) });
    }
  };

  const input = 'mt-100 w-full rounded-md border border-border bg-background px-300 py-100';
  const button = 'rounded-md bg-primary px-400 py-200 font-medium text-primary-foreground disabled:opacity-50';

  return (
    <section aria-labelledby="app3-title" className="rounded-xl border border-border bg-card p-500 md:col-span-2">
      <h2 id="app3-title" className="font-semibold">
        APP-3 · Request write path (scratch)
      </h2>
      <p className="mt-200 text-muted-foreground">
        Creates a real request on a synthetic heater as you, shows its live approval checks, and decides it. The server
        works out who you are from your sign-in; you are never asked for an e-mail. Press the three buttons in order.
        A decision needs you to belong to the request's responsible (then accountable) group, or to be an admin; since
        18 Nov one person in both groups (or an admin) may approve both stages.
      </p>

      <div className="mt-300 grid gap-300 md:grid-cols-4">
        <label className="block text-sm">
          Heater id
          <input className={input} inputMode="numeric" value={heaterId} onChange={(e) => setHeaterId(e.target.value)} />
        </label>
        <label className="block text-sm">
          Request number
          <input className={input} inputMode="numeric" value={requestId} onChange={(e) => setRequestId(e.target.value)} />
        </label>
        <label className="block text-sm">
          Decision
          <select className={input} value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option>APPROVE</option>
            <option>REJECT</option>
            <option>RETURN</option>
          </select>
        </label>
        <label className="block text-sm">
          Comment (needed to reject or return)
          <input className={input} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      </div>

      <div className="mt-300 flex flex-wrap gap-300">
        <button
          type="button"
          className={button}
          disabled={state.status === 'running' || !Number.isInteger(heaterNumber) || heaterNumber < 0}
          onClick={() => void go(() => runScratchCreate(heaterNumber))}
        >
          Create test request
        </button>
        <button
          type="button"
          className={button}
          disabled={state.status === 'running' || !Number.isInteger(requestNumber) || requestNumber < 1}
          onClick={() => void go(async () => (await getRayfinClient()).functions.getRequestChecks.invoke({ requestId: requestNumber }))}
        >
          Show checks
        </button>
        <button
          type="button"
          className={button}
          disabled={state.status === 'running' || !Number.isInteger(requestNumber) || requestNumber < 1}
          onClick={() =>
            void go(async () =>
              (await getRayfinClient()).functions.decideRequest.invoke({ requestId: requestNumber, decision, comment, expectedStatus: '', returnTo: '' })
            )
          }
        >
          Decide request
        </button>
      </div>

      {state.status === 'done' ? (
        <div className="mt-300">
          <pre
            role="status"
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-300 text-sm"
          >
            {state.text}
          </pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.text).then(
                () => setCopied(true),
                () => setCopied(false)
              );
            }}
            className="mt-200 rounded-md border border-border px-300 py-100 text-sm"
          >
            {copied ? 'Copied' : 'Copy result'}
          </button>
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert" className="mt-300 break-words text-destructive">
          The call failed: {state.text}
        </p>
      ) : null}
    </section>
  );
}

// ---- S5 card: can a deployed function reach OxyGPT? ---------------------------------------------------------
// Removed with the rest of this page in APP-10. Only an Admin gets an answer (the function checks, not this page).
// The page sends the mode and the question; the address, the model and the key live on the server.

/** The longest question the function accepts (`OXYGPT.maxPromptChars` in packages/functions/src/config.ts). */
const OXYGPT_MAX_QUESTION = 500;

function OxygptCard() {
  const [question, setQuestion] = useState('');
  const [state, setState] = useState<SpikeState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const go = async (mode: 'dns' | 'models' | 'text' | 'agent') => {
    setCopied(false);
    setState({ status: 'running' });
    try {
      const result = await (await getRayfinClient()).functions.oxygptProbe.invoke({ mode, prompt: question });
      setState({ status: 'done', text: JSON.stringify(result, null, 2) });
    } catch (e) {
      setState({ status: 'failed', text: describe(e) });
    }
  };

  const button = 'rounded-md bg-primary px-400 py-200 font-medium text-primary-foreground disabled:opacity-50';
  const busy = state.status === 'running';

  return (
    <section aria-labelledby="s5-title" className="rounded-xl border border-border bg-card p-500 md:col-span-2">
      <h2 id="s5-title" className="font-semibold">
        S5 · OxyGPT connection (Admin only)
      </h2>
      <p className="mt-200 text-muted-foreground">
        Can the deployed server reach the client's AI service? Press the buttons in order. Name lookup: does the host
        name resolve from Fabric, and is it a private address? List models: can it connect, sign in with the key and
        see the models (copy the agent's ID from here)? Ask OxyGPT: sends the question below to the model and shows the
        answer. Ask the agent: runs the client's saved-chat flow (create a chat, start the agent, wait for it, read the
        answer, delete the chat) and shows each step and which tools the agent ran; it can take a few minutes. Leave the
        question empty to ask for "pong". Do not type client row data. Nothing here is saved by this app.
      </p>

      <label className="mt-300 block text-sm">
        Question (up to {OXYGPT_MAX_QUESTION} characters)
        <textarea
          className="mt-100 w-full rounded-md border border-border bg-background px-300 py-100"
          rows={2}
          maxLength={OXYGPT_MAX_QUESTION}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      <div className="mt-300 flex flex-wrap gap-300">
        <button type="button" className={button} disabled={busy} onClick={() => void go('dns')}>
          Name lookup
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void go('models')}>
          List models
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void go('text')}>
          Ask OxyGPT
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void go('agent')}>
          Ask the agent
        </button>
      </div>

      {busy ? <p className="mt-300 text-muted-foreground">Running… a slow agent can take a few minutes.</p> : null}

      {state.status === 'done' ? (
        <div className="mt-300">
          <pre
            role="status"
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-300 text-sm"
          >
            {state.text}
          </pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.text).then(
                () => setCopied(true),
                () => setCopied(false)
              );
            }}
            className="mt-200 rounded-md border border-border px-300 py-100 text-sm"
          >
            {copied ? 'Copied' : 'Copy result'}
          </button>
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <p role="alert" className="mt-300 break-words text-destructive">
          The call failed: {state.text}
        </p>
      ) : null}
    </section>
  );
}

function SpikeCard({
  id,
  title,
  question,
  buttonLabel,
  run,
}: {
  id: string;
  title: string;
  question: string;
  buttonLabel: string;
  run: () => Promise<unknown>;
}) {
  const [state, setState] = useState<SpikeState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);

  const onRun = async () => {
    setCopied(false);
    setState({ status: 'running' });
    try {
      const result = await run();
      setState({ status: 'done', text: JSON.stringify(result, null, 2) });
    } catch (e) {
      setState({ status: 'failed', text: describe(e) });
    }
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: select the text and copy by hand
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-xl border border-border bg-card p-500"
    >
      <h2 id={`${id}-title`} className="font-semibold">
        {title}
      </h2>
      <p className="mt-200 text-muted-foreground">{question}</p>
      <button
        type="button"
        onClick={() => void onRun()}
        disabled={state.status === 'running'}
        className="mt-300 rounded-md bg-primary px-400 py-200 font-medium text-primary-foreground disabled:opacity-50"
      >
        {state.status === 'running' ? 'Running…' : buttonLabel}
      </button>

      {state.status === 'done' ? (
        <div className="mt-300">
          <pre
            role="status"
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-300 text-sm"
          >
            {state.text}
          </pre>
          <button
            type="button"
            onClick={() => void onCopy(state.text)}
            className="mt-200 rounded-md border border-border px-300 py-100 text-sm"
          >
            {copied ? 'Copied' : 'Copy result'}
          </button>
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <p role="alert" className="mt-300 break-words text-destructive">
          The call failed: {state.text}
        </p>
      ) : null}
    </section>
  );
}

export function Spikes() {
  // useContext, not useAuth: the page still renders (signedIn: false) without a provider.
  const browserUser = useContext(AuthContext)?.session?.user ?? null;
  return (
    <div className="grid gap-500 md:grid-cols-2">
      <SpikeCard
        id="s1"
        title="S1 · Who am I"
        question="Can the server see who is calling? It should tell two different people apart. The server token has no e-mail field, so the result also shows what this browser's own session knows (browserSession) and whether the ids match. S8: tokenCheck shows whether the token's signature verified against the Rayfin service's published keys, and whether a tampered copy was refused (tamper.rejected should be true)."
        buttonLabel="Who am I"
        run={() => runWhoAmI(browserUser)}
      />
      <SpikeCard
        id="s2"
        title="S2 · SQL ping"
        question="Can the server reach the ATLAS database as the app identity, run two inserts in a transaction, and roll them back?"
        buttonLabel="SQL ping"
        run={runSqlPing}
      />
      <SpikeCard
        id="s7"
        title="S7 · Read-function timing (latency gate)"
        question="The connector cannot read views, so the equipment screens read through functions. How long does a call take? This reads every heater (about 2,530 synthetic rows, 100 per call) and times one filtered page, one closest-match search and one heater's detail, in the browser and inside the function. The FIRST call is kept apart: open this page after about 20 minutes idle for a cold start, press again for warm. Pass: warm calls about 2 seconds or less. Counts and timings only."
        buttonLabel="Run timing test"
        run={runReadTiming}
      />
      <SpikeCard
        id="s4"
        title="S4 · OneLake write"
        question="Can the server, as the app identity, write a tiny test file to the lakehouse Files area (ATLAS_LH, folder photos/_probe), read it back and delete it? Rayfin's own storage is not enabled in Fabric, so photos would go this way (APP-7)."
        buttonLabel="Run OneLake test"
        run={runStorageProbe}
      />
      <WritePathCard />
      <OxygptCard />
    </div>
  );
}
