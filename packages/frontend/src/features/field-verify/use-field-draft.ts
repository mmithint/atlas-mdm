import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_DRAFT, type Draft, type Photo } from './model';

/**
 * The Field view draft, saved on every change. The draft is a per-person convenience kept in this browser
 * (photos are not kept: a picture cannot outlive the page). TODO(backend): save drafts per user with the Field view
 * functions, so a visit can be finished on another device.
 */
const keyOf = (who: string) => `atlas.field-draft.${who}`;

function load(who: string): Draft {
  try {
    const saved = window.localStorage.getItem(keyOf(who));
    return saved ? { ...EMPTY_DRAFT, ...(JSON.parse(saved) as Partial<Draft>) } : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function useFieldDraft(who: string) {
  const [draft, setDraft] = useState<Draft>(() => load(who));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Saved as part of each change (from the latest draft, kept in a ref), never in an effect.
  const latest = useRef(draft);
  const update = useCallback(
    (change: (d: Draft) => Draft) => {
      const next = change(latest.current);
      latest.current = next;
      setDraft(next);
      try {
        window.localStorage.setItem(keyOf(who), JSON.stringify(next));
        setSavedAt(new Date());
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);
      }
    },
    [who]
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(keyOf(who));
    } catch {
      // Nothing to clear.
    }
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    latest.current = EMPTY_DRAFT;
    setDraft(EMPTY_DRAFT);
    setSavedAt(null);
  }, [photos, who]);

  // Photos are not saved, and storage can fail: leaving then loses work, so the browser asks first.
  const atRisk = photos.length > 0 || saveFailed;
  useEffect(() => {
    if (!atRisk) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [atRisk]);

  return { draft, update, photos, setPhotos, savedAt, saveFailed, reset };
}

/** "Saved just now", "Saved 3 min ago", "Saved at 14:05". */
export function savedText(at: Date | null, now: Date): string {
  if (at === null) return 'Draft saves as you go';
  const s = Math.round((now.getTime() - at.getTime()) / 1000);
  if (s < 60) return 'Saved just now';
  if (s < 3600) return `Saved ${Math.round(s / 60)} min ago`;
  return `Saved at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
