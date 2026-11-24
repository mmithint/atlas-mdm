import { Lock, MapPin, Search } from 'lucide-react';

import { Segmented } from './segmented.component';
import { useEffect, useId, useState } from 'react';

import { FormField } from '@/components/layout';
import { button, card, input } from '@/components/ui';

import { LEVELS, SITE_KINDS, type LocationLevel, type SiteKind } from './config';
import { autoPick, choose, fullPath, kindNoun, levelLabel, nodeById, optionsAt, pathOf, searchSites, type Draft } from './model';

const RECENT_KEY = 'atlas.field-recent-locations';
const readRecents = (): string[] => {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && nodeById(x) !== undefined) : [];
  } catch {
    return [];
  }
};
const rememberRecent = (id: string) => {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecents().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    // Not remembered; the search still works.
  }
};

type Toast = { message: string; undo: () => void } | null;

/** Step 1: where the person is. Search first; the column browser below is the fallback. */
export function LocationPicker({ draft, update }: { draft: Draft; update: (change: (d: Draft) => Draft) => void }) {
  const searchId = useId();
  // Null while the person is not typing: the box then shows the chosen location.
  const [typed, setQuery] = useState<string | null>(null);
  const [recents, setRecents] = useState(readRecents);
  const [toast, setToast] = useState<Toast>(null);
  const [reporting, setReporting] = useState(false);
  const [report, setReport] = useState(draft.missingLocation);
  const { path, mode } = draft;
  const site = nodeById(path.SITE);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const setPath = (next: Draft['path']) => update((d) => ({ ...d, path: next, equipmentNo: next.SITE === d.path.SITE ? d.equipmentNo : null }));

  const pick = (level: LocationLevel, id: string) => {
    const before = path;
    const { path: next, cleared } = choose(path, mode, level, id);
    setPath(next);
    if (cleared.length > 0) {
      const names = cleared.map((l) => levelLabel(l, mode).toLowerCase());
      const text = names.join(' and ');
      setToast({ message: `${text.charAt(0).toUpperCase()}${text.slice(1)} cleared.`, undo: () => setPath(before) });
    }
  };

  const pickSite = (id: string) => {
    setPath(pathOf(id));
    rememberRecent(id);
    setRecents(readRecents());
    setQuery(null);
  };

  const setMode = (m: SiteKind) =>
    update((d) => {
      const keepSite = nodeById(d.path.SITE)?.kind === m;
      return { ...d, mode: m, path: autoPick({ ...d.path, SITE: keepSite ? d.path.SITE : null }, m), equipmentNo: keepSite ? d.equipmentNo : null };
    });

  const query = typed ?? '';
  const results = searchSites(query, mode);
  const recentSites = recents.filter((id) => nodeById(id)?.kind === mode);

  return (
    <div className="space-y-300">
      <section className={`${card} space-y-400 p-500`} aria-labelledby={`${searchId}-title`}>
        <div className="flex flex-wrap items-center justify-between gap-300">
          <h2 id={`${searchId}-title`} className="text-500 font-semibold">
            Where are you?
          </h2>
          <Segmented label="Location type" options={SITE_KINDS.map((k) => ({ value: k.kind, label: k.label }))} value={mode} onChange={setMode} />
        </div>

        <div>
          <FormField label="Search locations" htmlFor={searchId}>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-300 top-1/2 icon-size-200 -translate-y-1/2 text-muted-foreground" />
              <input id={searchId} type="search" autoComplete="off" className={`${input} pl-800`} value={typed ?? (path.SITE ? fullPath(path.SITE) : '')}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => typed?.trim() === '' && setQuery(null)}
              />
            </div>
          </FormField>
          {query.trim() ? (
            <ul className="mt-200 divide-y divide-divider rounded-lg border border-border" aria-label="Matching locations">
              {results.length === 0 ? <li className="px-300 py-200 text-300 text-muted-foreground">No {SITE_KINDS.find((k) => k.kind === mode)?.plural} match “{query}”.</li> : null}
              {results.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => pickSite(n.id)} className="flex w-full items-center gap-200 px-300 py-200 text-left text-300 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring">
                    <MapPin aria-hidden="true" className="icon-size-200 shrink-0 text-muted-foreground" />
                    <Highlight text={fullPath(n.id)} query={query} />
                  </button>
                </li>
              ))}
            </ul>
          ) : recentSites.length > 0 ? (
            <div className="mt-300">
              <h3 className="text-200 font-medium text-muted-foreground">Recent locations</h3>
              <ul className="mt-100 flex flex-wrap gap-200">
                {recentSites.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => pickSite(id)} className={button.small}>
                      {fullPath(id)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div>
          <h3 className="flex items-center gap-300 text-300 font-medium text-muted-foreground">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            Or choose step by step
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </h3>
          <div className="mt-400 grid gap-300 md:grid-cols-3">
            {LEVELS.map((l, i) => {
              const options = optionsAt(l.level, path, mode);
              const parent = i === 0 ? null : nodeById(path[LEVELS[i - 1]!.level]);
              const name = levelLabel(l.level, mode);
              const waiting = i > 0 && !parent;
              const none = !waiting && options.length === 0;
              const plural = l.level === 'SITE' ? (SITE_KINDS.find((k) => k.kind === mode)?.plural ?? 'sites') : `${name.toLowerCase()}s`;
              return (
                <div key={l.level} className="space-y-100">
                  <FormField
                    label={name}
                    htmlFor={`loc-${l.level}`}
                    hint={waiting ? `Select a ${levelLabel(LEVELS[i - 1]!.level, mode).toLowerCase()} first` : none ? `No ${plural} are listed under ${parent?.label ?? 'this level'}.` : undefined}
                  >
                    <select
                      id={`loc-${l.level}`}
                      className={input}
                      value={path[l.level] ?? ''}
                      disabled={waiting || none}
                      onChange={(e) => e.target.value && pick(l.level, e.target.value)}
                    >
                      <option value="">{waiting ? '—' : `Choose a ${name.toLowerCase()}`}</option>
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  {none ? (
                    <button type="button" className={button.small} onClick={() => setReporting(true)}>
                      Report missing location
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        {reporting ? (
          <form
            className="space-y-200 rounded-lg border border-border bg-muted p-300"
            onSubmit={(e) => {
              e.preventDefault();
              update((d) => ({ ...d, missingLocation: report.trim() }));
              setReporting(false);
              setToast({ message: 'Missing location noted. It goes with this submission.', undo: () => update((d) => ({ ...d, missingLocation: '' })) });
            }}
          >
            <FormField label="What location is missing?" htmlFor={`${searchId}-report`} hint="Its name and where it sits, e.g. the sub-asset it belongs to.">
              <textarea id={`${searchId}-report`} rows={2} className={input} value={report} onChange={(e) => setReport(e.target.value)} />
            </FormField>
            <div className="flex justify-end gap-200">
              <button type="button" className={button.secondary} onClick={() => setReporting(false)}>
                Cancel
              </button>
              <button type="submit" className={button.primary} disabled={!report.trim()}>
                Save report
              </button>
            </div>
          </form>
        ) : null}

        <p aria-live="polite" className="min-h-600 text-300">
          {toast ? (
            <span className="inline-flex items-center gap-300 rounded-lg bg-foreground px-300 py-100 text-background">
              {toast.message}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => {
                  toast.undo();
                  setToast(null);
                }}
              >
                Undo
              </button>
            </span>
          ) : null}
        </p>
      </section>

      <section className={`${card} flex flex-wrap items-center justify-between gap-300 px-500 py-300`} aria-label="Final parent location">
        <span className="flex items-center gap-200 text-300 font-medium">
          <Lock aria-hidden="true" className="icon-size-200 text-muted-foreground" />
          Final parent location
        </span>
        {site?.floc ? (
          <span className="flex items-center gap-200 text-300">
            {site.label}
            <span className="id-plate">{site.floc}</span>
          </span>
        ) : (
          <span className="text-300 text-muted-foreground">Choose a {kindNoun(mode)} to see it</span>
        )}
      </section>
    </div>
  );
}

/** The text with every case-insensitive match of the query marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = text.toLowerCase().indexOf(q);
  if (!q || at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-warning px-100-nudge text-warning-foreground">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </span>
  );
}

