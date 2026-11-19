/**
 * Functions a page already calls although no phase has built them yet (FINAL PLAN/11 §3 F7, APP-D).
 *
 * Pages call them through `previewInvoke` (never through the Rayfin client, where they do not exist). Under
 * `npm run dev:mock` they answer from sample data (`dev-mock/preview-handlers.ts`); anywhere else
 * `previewInvoke` refuses, and the page is not shown (its route shows the "arrives in APP-n" placeholder). Names follow `FINAL PLAN/03` §2.2; a name that section does not list yet is marked
 * "proposed" and is fixed by the phase that builds it.
 *
 * When a phase builds one of these for real: delete its entry here and its handler in preview-handlers.ts,
 * and call it as `client.functions.<name>.invoke(...)`. Until the entry is deleted, `npm run typecheck`
 * fails (see the check at the bottom), so a stale entry cannot stay behind.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

interface Envelope {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
}

export interface PreviewFunctions {
  /** APP-8 (`03` §2.2). Input as `bulkApprove`: a comma-separated id list; empty = all of mine. */
  markNotificationsRead: {
    input: { notificationIds: string };
    output: Envelope & { marked: number; unreadCount: number };
  };
}

export type PreviewFunctionName = keyof PreviewFunctions;

/** Compile-time guard: fails to compile once a name above also exists among the real functions. */
type BuiltAlready = Extract<PreviewFunctionName, keyof AppFunctionsSchema>;
export const PREVIEW_NAMES_ARE_NOT_BUILT: [BuiltAlready] extends [never] ? true : BuiltAlready = true;
