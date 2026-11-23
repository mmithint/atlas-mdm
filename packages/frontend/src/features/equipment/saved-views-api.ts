/**
 * The saved filters of screen S-4 (app.saved_view, through the functions listSavedViews, saveView and
 * deleteSavedView). They belong to the signed-in person, who the functions take from the verified token, so
 * they follow the person to any device. Failures come back inside the answer and are turned into an
 * exception with the function's own words (`unwrapAct`).
 *
 * TODO(backend): in the demo (`npm run dev:mock`) these calls are answered by dev-mock/mock-functions.ts, which
 * keeps saved filters in THIS BROWSER's local storage only. Per-user storage needs the procedures
 * db/procs/usp_saved_view_*.sql run in ATLAS_SQL_DB and the functions deployed: see db/SAVED_FILTERS.md.
 * Nothing here changes when that is done.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { unwrapAct } from '@/lib/act-answer';
import { getRayfinClient } from '@/lib/rayfin-client';

import { SCREEN } from './saved-view-model';

export type SavedView = AppFunctionsSchema['listSavedViews']['output']['views'][number];

/** The person's saved filters, by name. */
export async function listSavedViews(): Promise<SavedView[]> {
  const client = await getRayfinClient();
  return unwrapAct(await client.functions.listSavedViews.invoke({ screenCode: SCREEN })).views;
}

/** Saves the view under `name`; a name already used is replaced. Answers the view as saved. */
export async function saveView(name: string, definitionJson: string): Promise<{ view: SavedView; replaced: boolean }> {
  const client = await getRayfinClient();
  const answer = unwrapAct(await client.functions.saveView.invoke({ screenCode: SCREEN, viewName: name, definitionJson }));
  if (answer.view === null) throw new Error('The filter was saved, but the server did not send it back. Reopen the panel to see it.');
  return { view: answer.view, replaced: answer.outcome === 'REPLACED' };
}

export async function deleteSavedView(savedViewId: number): Promise<void> {
  const client = await getRayfinClient();
  unwrapAct(await client.functions.deleteSavedView.invoke({ savedViewId }));
}
