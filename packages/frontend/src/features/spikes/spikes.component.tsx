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
        question="Can the server see who is calling? It should tell two different people apart. The server token has no e-mail field, so the result also shows what this browser's own session knows (browserSession) and whether the ids match."
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
    </div>
  );
}
