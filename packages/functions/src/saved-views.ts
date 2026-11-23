/**
 * Saved filters (saved views) of a screen: one person's named filter settings, kept in app.saved_view
 * (migration 0007, section 7.3) so they follow the person to any device.
 *
 *   listSavedViews   -> app.usp_saved_view_list
 *   saveView         -> app.usp_saved_view_save    (a name already used is replaced)
 *   deleteSavedView  -> app.usp_saved_view_delete
 *
 * Thin like the other functions (decision D-03): they check their inputs, take the owner from the verified
 * token (never from the browser), run one procedure and hand its answer back. The definition is opaque JSON
 * here; the screen that wrote it reads it back. Names and counts only in the log.
 */
import sql from 'mssql';

import { act, invalid, num, on, str, text, whole, word, MAX_SAFE, type Envelope, type Row, type Timing } from './runner.js';

/** The screens that keep saved views (ck_saved_view_screen). */
const SCREENS = ['S-2', 'S-4'] as const;

/** The longest definition the table takes (definition_json nvarchar(4000)). */
const MAX_DEFINITION = 4000;

// The answers are flat on purpose, like requests.ts: the generated contract in types.ts is compared with them.
export interface SavedView {
  savedViewId: number;
  viewName: string;
  definitionJson: string;
  isDefault: boolean;
  updatedAtUtc: string | null;
}

export interface ListSavedViewsResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  views: SavedView[];
}

export interface SaveViewResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  view: SavedView | null;
  /** CREATED or REPLACED (a view of the same name was updated). */
  outcome: string | null;
}

export interface DeleteSavedViewResult {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
  userId: string | null;
  timing: Timing;
  savedViewId: number | null;
}

const viewOf = (row: Row): SavedView => ({
  savedViewId: num(row['saved_view_id']) ?? 0,
  viewName: str(row['view_name']) ?? '',
  definitionJson: str(row['definition_json']) ?? '{}',
  isDefault: on(row['is_default']),
  updatedAtUtc: str(row['updated_at_utc']),
});

const screenOf = (value: unknown): string => word('The screen', value, SCREENS);

export async function runListSavedViews(
  screenCode: string,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<ListSavedViewsResult> {
  const started = performance.now();
  let screen: string;
  try {
    screen = screenOf(screenCode);
  } catch (err) {
    return invalid(err, started, { views: [] as SavedView[] });
  }
  return act('listSavedViews', 'read your saved filters', accessToken, getSqlToken, { views: [] as SavedView[] }, async (pool, email) => {
    const r = await pool
      .request()
      .input('actor_email', sql.NVarChar(256), email)
      .input('screen_code', sql.NVarChar(10), screen)
      .execute<Row>('app.usp_saved_view_list');
    return { views: (r.recordset ?? []).map(viewOf) };
  });
}

export async function runSaveView(
  input: { screenCode: string; viewName: string; definitionJson: string },
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<SaveViewResult> {
  const started = performance.now();
  const empty = { view: null, outcome: null };
  let screen: string, name: string, definition: string;
  try {
    screen = screenOf(input.screenCode);
    name = text('The name', input.viewName, 100, true);
    definition = text('The filter settings', input.definitionJson, MAX_DEFINITION, true);
  } catch (err) {
    return invalid(err, started, empty);
  }
  return act('saveView', 'save the filter', accessToken, getSqlToken, empty as Omit<SaveViewResult, keyof Envelope>, async (pool, email) => {
    const r = await pool
      .request()
      .input('actor_email', sql.NVarChar(256), email)
      .input('screen_code', sql.NVarChar(10), screen)
      .input('view_name', sql.NVarChar(200), name)
      .input('definition_json', sql.NVarChar(sql.MAX), definition)
      .execute<Row>('app.usp_saved_view_save');
    const row = r.recordset?.[0];
    return { view: row ? viewOf(row) : null, outcome: str(row?.['outcome']) };
  });
}

export async function runDeleteSavedView(
  savedViewId: number,
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<DeleteSavedViewResult> {
  const started = performance.now();
  let id: number;
  try {
    id = whole('The saved filter number', savedViewId, 1, Math.min(MAX_SAFE, 2_147_483_647));
  } catch (err) {
    return invalid(err, started, { savedViewId: null });
  }
  return act('deleteSavedView', 'delete the saved filter', accessToken, getSqlToken, { savedViewId: null as number | null }, async (pool, email) => {
    const r = await pool
      .request()
      .input('actor_email', sql.NVarChar(256), email)
      .input('saved_view_id', sql.Int, id)
      .execute<Row>('app.usp_saved_view_delete');
    return { savedViewId: num(r.recordset?.[0]?.['saved_view_id']) };
  });
}
