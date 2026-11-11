//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/auth.context';
import { getRayfinClient } from '@/lib/rayfin-client';

type Note = { id: string; title: string; createdBy?: string | null; createdAt?: string | Date | null };

/** "nitej.mithinti@bizmetric.com" → "Nitej" */
function firstName(email?: string): string {
  const local = (email ?? '').split('@')[0] ?? '';
  const first = local.split(/[._\s-]+/).find(Boolean) ?? '';
  return first ? first[0].toUpperCase() + first.slice(1) : 'there';
}

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}

/** Proves the backend works: writes a note to ATLAS_SQL_DB (dbo.TestNote) and reads it back. */
function BackendTest({ email }: { email?: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = (await getRayfinClient()).connectors.atlassqldb;
      const rows = await db.TestNote.select(['id', 'title', 'createdBy', 'createdAt']).orderBy({ createdAt: 'desc' }).first(20).execute();
      setNotes(rows as unknown as Note[]);
      setError(null);
    } catch (e) {
      setError(`Read failed: ${describe(e)}`);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the backend
    void load();
  }, [load]);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const db = (await getRayfinClient()).connectors.atlassqldb;
      await db.TestNote.create({ id: crypto.randomUUID(), title: text.trim().slice(0, 200), createdBy: email?.slice(0, 200), createdAt: new Date() });
      setText('');
      setSaved(true);
      await load();
    } catch (e) {
      setError(`Save failed: ${describe(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-border p-6 text-left">
      <label htmlFor="comment" className="font-medium">Comment</label>
      <p className="mt-1 text-sm text-muted-foreground">Submitting saves it to ATLAS_SQL_DB (dbo.TestNote) with your sign-in and the time.</p>
      <textarea
        id="comment"
        rows={4}
        maxLength={200}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a comment (up to 200 characters)"
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{text.length}/200</span>
        <button type="button" onClick={() => void save()} disabled={busy || !text.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
      {saved ? <p role="status" className="mt-3 text-sm text-green-700">Saved to ATLAS_SQL_DB.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
      {notes === null && !error ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : null}
      {notes && notes.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No comments yet. Submit one to test.</p> : null}
      {notes && notes.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {notes.map((n) => (
            <li key={n.id}>
              {n.title}{' '}
              <span className="text-muted-foreground">
                · {n.createdBy ?? 'unknown'}
                {n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Shown only after sign-in: the AuthGate in Root renders the Fabric login page first.
function App() {
  const { session } = useAuth();
  const email = session?.user?.email;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Welcome, {firstName(email)}</h1>
        {email ? <p className="mt-2 text-sm text-muted-foreground">Signed in as {email}</p> : null}
        <div className="mt-8 rounded-lg border border-dashed border-border p-6">
          <p className="font-medium">No data is available</p>
          <p className="mt-1 text-sm text-muted-foreground">ATLAS-DEV · Oxy ATLAS workspace</p>
        </div>
        <BackendTest email={email} />
      </section>
    </main>
  );
}

export default App;
