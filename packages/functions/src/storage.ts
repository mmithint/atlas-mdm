/**
 * Spike S4, the part that can be tested today: can a function, running as the app
 * identity, write a file to the lakehouse Files area through OneLake, read it back and
 * delete it? (APP-2; removed in APP-10 with the other spikes.)
 *
 * Why this and not Rayfin storage: the installed Rayfin docs say Rayfin storage "is not
 * enabled in the Fabric service; this decorator generates configuration that the
 * platform does not yet honor" (`@microsoft/rayfin-core`, `experimental` `blob`), and the
 * installed client has no upload call. The plan's fallback (D-09, `03` APP-2) is writing
 * photos to `ATLAS_LH/Files/photos/` through the OneLake file API with the app identity's
 * `AudienceType.Storage` token. This probe tests exactly that, with a tiny text file.
 *
 * Steps (ADLS Gen2 file API, which OneLake speaks): create, append, flush, read, delete.
 * Returns what happened at each step; never returns the token.
 * What it does NOT prove: that a 10 MiB photo can travel from the browser through a
 * function call (payload limits). That is checked when photo upload is built (APP-7).
 */
import { ONELAKE_LAKEHOUSE_ITEM, ONELAKE_WORKSPACE } from './config.js';

export type StorageProbeStep =
  | 'token'
  | 'create'
  | 'append'
  | 'flush'
  | 'read'
  | 'delete'
  | 'done';

export interface StorageProbeResult {
  /** True only when every step worked and the text read back equals the text written. */
  ok: boolean;
  /** The last step reached. `done` means every step ran. */
  step: StorageProbeStep;
  /** The file's address without the host: `<workspace>/<item>/Files/...` (no secrets). */
  path: string;
  /** HTTP status of the last request made, or null if none was made. */
  httpStatus: number | null;
  /** Whether the text read back equals the text written (null until the read step). */
  readBackMatches: boolean | null;
  totalMs: number;
  /** What went wrong, with a hint for the usual causes; null when ok. */
  error: string | null;
}

const HOST = 'https://onelake.dfs.fabric.microsoft.com';
const FOLDER = 'Files/photos/_probe';
const FILE = 'atlas-s4-probe.txt';
const MAX_ERROR = 300;

function hintFor(status: number, step: StorageProbeStep): string {
  if (status === 401) return 'The token was refused (401). The app identity may not be allowed to use OneLake.';
  if (status === 403) return 'Forbidden (403). The app identity (the owner of the Fabric App item) needs Contributor on workspace ATLAS, and the tenant setting "Users can access data stored in OneLake with apps external to Fabric" must be on (RB-12 item 4).';
  if (status === 404) return `Not found (404) at step ${step}. Check ONELAKE_WORKSPACE and ONELAKE_LAKEHOUSE_ITEM in packages/functions/src/config.ts: both display names, or both ids.`;
  return `Unexpected status ${status} at step ${step}.`;
}

export async function storageProbe(getToken: () => string): Promise<StorageProbeResult> {
  const started = performance.now();
  const path = `${ONELAKE_WORKSPACE}/${ONELAKE_LAKEHOUSE_ITEM}/${FOLDER}/${FILE}`;
  const url = `${HOST}/${encodeURI(path)}`;
  const text = `ATLAS S4 probe ${new Date().toISOString()}`;
  const bytes = Buffer.from(text, 'utf8');

  const result: StorageProbeResult = {
    ok: false,
    step: 'token',
    path,
    httpStatus: null,
    readBackMatches: null,
    totalMs: 0,
    error: null,
  };

  let token: string | undefined;
  const call = async (
    step: StorageProbeStep,
    method: string,
    query: string,
    expected: readonly number[],
    body?: Buffer
  ): Promise<Response | null> => {
    result.step = step;
    const res = await fetch(`${url}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token ?? ''}`,
        ...(body ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      ...(body ? { body: new Uint8Array(body) } : {}),
    });
    result.httpStatus = res.status;
    if (expected.includes(res.status)) return res;
    const detail = (await res.text().catch(() => '')).slice(0, MAX_ERROR);
    result.error = `${hintFor(res.status, step)}${detail ? ` Response: ${detail}` : ''}`;
    return null;
  };

  try {
    token = getToken();
    if (!token) {
      result.error = 'No Storage token was given to the function (ctx.Tokens.Storage is empty).';
      return result;
    }

    if (!(await call('create', 'PUT', '?resource=file', [201]))) return result;
    if (!(await call('append', 'PATCH', '?action=append&position=0', [202], bytes))) return result;
    if (!(await call('flush', 'PATCH', `?action=flush&position=${bytes.length}`, [200]))) return result;

    const read = await call('read', 'GET', '', [200]);
    if (!read) return result;
    result.readBackMatches = (await read.text()) === text;

    // Clean up even if the read-back differed, so no probe file is left behind.
    const deleted = await call('delete', 'DELETE', '', [200, 202]);
    if (!deleted) return result;

    if (!result.readBackMatches) {
      result.error = 'The file was written and deleted, but the text read back was different from the text written.';
      return result;
    }
    result.step = 'done';
    result.ok = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = (token ? message.split(token).join('[token]') : message).slice(0, MAX_ERROR);
  } finally {
    result.totalMs = Math.round(performance.now() - started);
    console.log(`storageProbe: ok=${result.ok} step=${result.step} status=${result.httpStatus} totalMs=${result.totalMs}`);
  }
  return result;
}
