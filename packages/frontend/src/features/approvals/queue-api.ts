/**
 * The Approvals screen's calls (S-2). The list is read by `getRequestQueue` (read path C, D-17: it
 * calls `app.usp_request_queue`, which knows who is asking and decides which request is in which tab);
 * a bulk approval is `bulkApprove` (`app.usp_request_bulk_decide`, which decides each request on its
 * own). The browser never names who it is: the function reads that from the sign-in.
 *
 * Both functions answer with the envelope of `act-answer.ts`; a failure comes back as text inside the
 * answer, and `unwrapAct` turns it back into an exception carrying the server's own sentence.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { unwrapAct } from '@/lib/act-answer';
import { getRayfinClient } from '@/lib/rayfin-client';

import { BULK_LIMIT, tabById, type QueueCriteria } from './queue-model';

type QueueAnswer = AppFunctionsSchema['getRequestQueue']['output'];
export type BulkAnswer = AppFunctionsSchema['bulkApprove']['output'];

export type QueueRow = QueueAnswer['rows'][number];
export type QueueCounts = QueueAnswer['counts'];
export type QueueFacet = QueueAnswer['facets'][number];
export type BulkResultRow = BulkAnswer['results'][number];

/** One page of one tab, with the six tab counts and the filter choices. */
export interface QueuePage {
  rows: QueueRow[];
  counts: QueueCounts;
  totalMatches: number;
  hasMore: boolean;
  facets: QueueFacet[];
}

/** The function's largest page; the screen offers 25, 50 and 100. */
const PAGE_LIMIT = 100;

/** Reads one page of the tab in `criteria`, starting at row `offset` (0 = the first page). */
export async function fetchQueue(criteria: QueueCriteria, offset: number): Promise<QueuePage> {
  const client = await getRayfinClient();
  const answer = unwrapAct(
    await client.functions.getRequestQueue.invoke({
      tab: criteria.tab,
      profitCenter: criteria.profitCenter,
      fieldCode: criteria.fieldCode,
      ruleId: criteria.ruleId,
      // The age filter counts hours OPEN; on the approved and rejected tabs it means nothing and is not sent.
      minAgeHours: tabById(criteria.tab).ageApplies ? criteria.minAgeHours : 0,
      noteOnly: criteria.noteOnly ? 1 : 0,
      offset,
      pageSize: Math.min(criteria.pageSize, PAGE_LIMIT),
    })
  );
  return {
    rows: answer.rows,
    counts: answer.counts,
    totalMatches: answer.totalMatches,
    hasMore: answer.hasMore,
    facets: answer.facets,
  };
}

/**
 * Approves the named requests, each on its own: the answer lists which were approved and which were
 * skipped, and why. It throws only when the call as a whole failed (not signed in, not registered,
 * a refused list), never because one request was skipped.
 */
export async function bulkApproveRequests(ids: readonly number[], comment: string): Promise<BulkAnswer> {
  if (ids.length === 0) throw new Error('Select at least one request.');
  if (ids.length > BULK_LIMIT) throw new Error(`At most ${BULK_LIMIT} requests can be approved at once.`);
  const client = await getRayfinClient();
  return unwrapAct(await client.functions.bulkApprove.invoke({ requestIds: ids.join(','), comment }));
}
