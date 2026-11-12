import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { getRayfinClient } from '@/lib/rayfin-client';

const MAX_LEN = 200;

type Note = {
  id: number;
  title: string;
  createdBy?: string | null;
  createdAt?: string | Date | null;
};

function describe(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.length > 300 ? `${m.slice(0, 300)}…` : m;
}

async function notesApi() {
  return (await getRayfinClient()).connectors.atlas_sql_db.TestNote;
}

/** Form to add a note to dbo.TestNote, plus the latest notes read back. */
export function Notes({ email }: { email?: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const api = await notesApi();
      const rows = await api
        .select(['id', 'title', 'createdBy', 'createdAt'])
        .orderBy({ createdAt: 'desc' })
        .first(20)
        .execute();
      setNotes(rows as unknown as Note[]);
      setError(null);
    } catch (e) {
      setError(`Could not load notes: ${describe(e)}`);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the backend
    void load();
  }, [load]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const title = text.trim();
    if (!title) return;
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const api = await notesApi();
      // `id` is a server IDENTITY column: never sent.
      await api.create({
        title: title.slice(0, MAX_LEN),
        createdBy: email,
        createdAt: new Date(),
      });
      setText('');
      setSaved(true);
      await load();
    } catch (e) {
      setError(`Could not save the note: ${describe(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-500 md:grid-cols-2">
      <form
        onSubmit={(e) => void submit(e)}
        className="rounded-xl border border-border bg-card p-500"
      >
        <label htmlFor="note" className="font-semibold">
          New note
        </label>
        <textarea
          id="note"
          rows={5}
          maxLength={MAX_LEN}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          placeholder="Write a note…"
          className="mt-300 w-full rounded-md border border-border bg-background p-300 text-foreground focus-visible:outline-2 focus-visible:outline-primary"
        />
        <div className="mt-300 flex items-center justify-between">
          <span className="text-muted-foreground">
            {text.length}/{MAX_LEN}
          </span>
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="rounded-md bg-primary px-400 py-200 font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {saved ? (
          <p role="status" className="mt-300 text-muted-foreground">
            Note saved.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-300 text-destructive">
            {error}
          </p>
        ) : null}
      </form>

      <section
        aria-label="Recent notes"
        className="rounded-xl border border-border bg-card p-500"
      >
        <h2 className="font-semibold">Recent notes</h2>
        {notes === null && !error ? (
          <p className="mt-300 text-muted-foreground">Loading…</p>
        ) : null}
        {notes?.length === 0 ? (
          <p className="mt-300 text-muted-foreground">No notes yet.</p>
        ) : null}
        <ul className="mt-300 space-y-300">
          {notes?.map((n) => (
            <li key={n.id} className="border-b border-border pb-300 last:border-0">
              <p>{n.title}</p>
              <p className="text-muted-foreground">
                {n.createdBy ?? 'unknown'}
                {n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
