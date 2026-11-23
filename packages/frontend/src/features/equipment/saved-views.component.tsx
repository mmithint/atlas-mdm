import { Save, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { button, input } from '@/components/ui';
import { errorText } from '@/lib/act-answer';

import { viewOf, type ViewState } from './saved-view-model';
import { deleteSavedView, listSavedViews, saveView, type SavedView } from './saved-views-api';

/** A square icon-only button; its name is the aria-label, and the title shows it on hover. */
const ICON_BUTTON =
  'inline-flex h-800 w-800 shrink-0 items-center justify-center rounded-lg border border-secondary-border bg-secondary text-secondary-foreground transition-colors duration-150 hover:border-secondary-hover-text hover:text-secondary-hover-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:border-divider disabled:text-disabled-foreground motion-reduce:transition-none';

type List = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; views: SavedView[] };
type Mode = { kind: 'idle' } | { kind: 'naming' } | { kind: 'confirm-delete'; view: SavedView };

/**
 * The top of the Filter panel: the person's saved filters. Choosing one puts the whole view back (the
 * boxes, the facility, the order, the page size, the ticked values and the columns); Save keeps the view
 * on screen under a name, and a name already used is updated. Deleting asks first, by name.
 */
export function SavedViews({ current, onApply }: { current: string; onApply: (view: ViewState) => void }) {
  const selectId = useId();
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<List>({ status: 'loading' });
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Read when the panel opens, and again on Try again (which bumps `attempt`).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    listSavedViews().then(
      (views) => !cancelled && setList({ status: 'ready', views }),
      (e: unknown) => !cancelled && setList({ status: 'error', message: errorText(e) })
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  const retry = () => {
    setList({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    if (mode.kind === 'naming') nameInput.current?.focus();
  }, [mode.kind]);

  const views = list.status === 'ready' ? list.views : [];
  const chosen = views.find((v) => v.savedViewId === chosenId) ?? null;
  const changed = chosen !== null && chosen.definitionJson !== current;
  const sameName = views.find((v) => v.viewName.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;

  const choose = (id: string) => {
    setNote(null);
    setMode({ kind: 'idle' });
    const view = views.find((v) => String(v.savedViewId) === id);
    if (!view) {
      setChosenId(null);
      return;
    }
    const state = viewOf(view.definitionJson);
    if (state === null) {
      setNote({ tone: 'error', text: `“${view.viewName}” could not be read. Save it again to fix it.` });
      return;
    }
    setChosenId(view.savedViewId);
    onApply(state);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') {
      setNote({ tone: 'error', text: 'Give the filter a name.' });
      nameInput.current?.focus();
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const { view, replaced } = await saveView(trimmed, current);
      setList((l) => ({
        status: 'ready',
        views: [...(l.status === 'ready' ? l.views.filter((v) => v.savedViewId !== view.savedViewId) : []), view].sort((a, b) => a.viewName.localeCompare(b.viewName)),
      }));
      setChosenId(view.savedViewId);
      setMode({ kind: 'idle' });
      setNote({ tone: 'ok', text: replaced ? `Updated “${view.viewName}”.` : `Saved “${view.viewName}”.` });
    } catch (e) {
      setNote({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (view: SavedView) => {
    setBusy(true);
    setNote(null);
    try {
      await deleteSavedView(view.savedViewId);
      setList((l) => (l.status === 'ready' ? { status: 'ready', views: l.views.filter((v) => v.savedViewId !== view.savedViewId) } : l));
      if (chosenId === view.savedViewId) setChosenId(null);
      setNote({ tone: 'ok', text: `Deleted “${view.viewName}”.` });
    } catch (e) {
      setNote({ tone: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
      setMode({ kind: 'idle' });
    }
  };

  let placeholder = 'Choose a saved filter';
  if (list.status === 'loading') placeholder = 'Loading saved filters…';
  else if (list.status === 'error') placeholder = 'Saved filters unavailable';
  else if (views.length === 0) placeholder = 'No saved filters yet';

  return (
    <section aria-label="Saved filters" className="shrink-0 space-y-200 border-b border-border px-400 py-300">
      <div className="flex items-center justify-between gap-200">
        <label htmlFor={selectId} className="text-200 font-medium text-muted-foreground">
          Saved filters
        </label>
        {changed ? <span className="text-200 text-muted-foreground">Changed since saved</span> : null}
      </div>
      <div className="flex items-center gap-200">
        <select
          id={selectId}
          className={`${input} min-w-0 flex-1`}
          value={chosen ? String(chosen.savedViewId) : ''}
          disabled={list.status !== 'ready' || views.length === 0 || busy}
          onChange={(e) => choose(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {views.map((v) => (
            <option key={v.savedViewId} value={String(v.savedViewId)}>
              {v.viewName}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Save the current filters"
          title="Save the current filters"
          disabled={list.status !== 'ready' || busy}
          onClick={() => {
            setNote(null);
            setName(chosen?.viewName ?? '');
            setMode({ kind: 'naming' });
          }}
        >
          <Save aria-hidden="true" className="icon-size-200" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label={chosen ? `Delete the saved filter “${chosen.viewName}”` : 'Delete a saved filter (choose one first)'}
          title={chosen ? `Delete “${chosen.viewName}”` : 'Choose a saved filter to delete it'}
          disabled={chosen === null || busy}
          onClick={() => chosen && setMode({ kind: 'confirm-delete', view: chosen })}
        >
          <Trash2 aria-hidden="true" className="icon-size-200" />
        </button>
      </div>

      {list.status === 'error' ? (
        <p className="text-200 text-destructive">
          {list.message}{' '}
          <button type="button" className="font-medium text-link underline-offset-2 hover:underline" onClick={retry}>
            Try again
          </button>
        </p>
      ) : null}

      {mode.kind === 'naming' ? (
        <form onSubmit={(e) => void save(e)} className="space-y-200 rounded-lg border border-border bg-muted p-300">
          <label htmlFor={nameId} className="block text-200 font-medium">
            Name
          </label>
          <input
            ref={nameInput}
            id={nameId}
            className={input}
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-200 text-muted-foreground">
            {sameName ? `Replaces your saved filter “${sameName.viewName}”.` : 'Keeps the boxes, facility, sort, page size, ticked values and columns.'}
          </p>
          <div className="flex justify-end gap-200">
            <button type="button" className={button.secondary} onClick={() => setMode({ kind: 'idle' })} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={button.primary} disabled={busy}>
              {sameName ? 'Update filter' : 'Save filter'}
            </button>
          </div>
        </form>
      ) : null}

      {mode.kind === 'confirm-delete' ? (
        <div role="group" aria-label="Confirm delete" className="space-y-200 rounded-lg border border-danger-border bg-danger-bg p-300">
          <p className="text-200 text-danger-text">Delete the saved filter “{mode.view.viewName}”? This cannot be undone.</p>
          <div className="flex justify-end gap-200">
            <button type="button" className={button.secondary} onClick={() => setMode({ kind: 'idle' })} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={button.danger} onClick={() => void remove(mode.view)} disabled={busy}>
              Delete “{mode.view.viewName}”
            </button>
          </div>
        </div>
      ) : null}

      <p className={note?.tone === 'error' ? 'text-200 text-destructive' : 'text-200 text-muted-foreground'} aria-live="polite">
        {note?.text ?? ''}
      </p>
    </section>
  );
}
