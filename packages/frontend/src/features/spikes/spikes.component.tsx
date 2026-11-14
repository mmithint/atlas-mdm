import { useContext, useState } from 'react';

import { AuthContext } from '@/hooks/auth.context';
import { getRayfinClient } from '@/lib/rayfin-client';

import {
  compareBrowserIdentity,
  type BrowserUser,
} from './browser-identity';

/**
 * TEMPORARY (APP-0, removed in APP-10): two buttons that call the spike
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
    </div>
  );
}
