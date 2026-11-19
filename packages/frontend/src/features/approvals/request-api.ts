/**
 * The request-detail screen's calls (S-3). The only place this screen talks to the server.
 *
 * Reads: `getRequestDetail` (the request, its events, related requests, route, golden values, the six live
 * checks and what THIS person may do, in one call, read path C / D-17) and `getRequestEvidence` (the evidence
 * snapshot, a long JSON text kept apart). Writes: `decideRequest` and `cancelRequest`. Every business rule is a
 * stored procedure behind them; nothing here decides who may do what.
 *
 * The functions answer with an envelope and carry their failures inside it (the platform hides the message of a
 * thrown error), so each call goes through `unwrapAct`, which turns a failure back into an exception that carries
 * the function's own words.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { ActError, errorText, unwrapAct } from '@/lib/act-answer';
import { getRayfinClient } from '@/lib/rayfin-client';

type DetailAnswer = AppFunctionsSchema['getRequestDetail']['output'];

export type DetailRow = NonNullable<DetailAnswer['request']>;
export type EventRow = DetailAnswer['events'][number];
export type RelatedRow = DetailAnswer['related'][number];
export type RouteRow = NonNullable<DetailAnswer['route']>;
export type GoldRow = NonNullable<DetailAnswer['gold']>;
export type CheckRow = DetailAnswer['checks'][number];
export type Viewer = NonNullable<DetailAnswer['viewer']>;
export type ReturnCandidate = DetailAnswer['returnCandidates'][number];
export type DecideAnswer = AppFunctionsSchema['decideRequest']['output'];
export type WithdrawAnswer = AppFunctionsSchema['cancelRequest']['output'];

export type Decision = 'APPROVE' | 'REJECT' | 'RETURN';

/** The procedure's refusal when there is no such request (app.usp_request_detail). */
const NO_SUCH_REQUEST = 50301;

export interface EvidenceSnapshot {
  createdAtUtc: string | null;
  createdBy: string | null;
  /** The snapshot as JSON text; `request-model.parseEvidence` reads it. */
  detailsJson: string | null;
}

export interface RequestView {
  request: DetailRow;
  events: EventRow[];
  related: RelatedRow[];
  route: RouteRow | null;
  gold: GoldRow | null;
  checks: CheckRow[];
  viewer: Viewer;
  /** Who the person may return the request to (the Return dialog's picker); empty unless they may decide. */
  returnCandidates: ReturnCandidate[];
  evidence: EvidenceSnapshot | null;
  /** Why the evidence could not be read; the page still works without it. */
  evidenceError: string | null;
}

/** What the screen assumes when the server sends no `viewer` row: nothing is allowed, and it says so. */
const UNKNOWN_VIEWER: Viewer = {
  canDecide: false,
  decideBlockedReason: 'The server did not say what you may do with this request.',
  canApprove: false,
  approveBlockedReason: 'The server did not say what you may do with this request.',
  canResubmit: false,
  canCancel: false,
  returnToType: null,
  returnTo: null,
  returnToLabel: null,
  stage: null,
  decidedAs: null,
};

async function readEvidence(requestId: number): Promise<{ evidence: EvidenceSnapshot | null; evidenceError: string | null }> {
  try {
    const client = await getRayfinClient();
    const answer = unwrapAct(await client.functions.getRequestEvidence.invoke({ requestId }));
    return {
      evidence: { createdAtUtc: answer.createdAtUtc, createdBy: answer.createdBy, detailsJson: answer.detailsJson },
      evidenceError: null,
    };
  } catch (error) {
    // The snapshot is a nice-to-have on the first tab: its failure must not hide the request or the decision.
    return { evidence: null, evidenceError: errorText(error) };
  }
}

/** Everything S-3 shows for one request; null when there is no such request. */
export async function fetchRequest(requestId: number): Promise<RequestView | null> {
  const client = await getRayfinClient();
  const evidenceCall = readEvidence(requestId);

  let detail: DetailAnswer;
  try {
    detail = unwrapAct(await client.functions.getRequestDetail.invoke({ requestId }));
  } catch (error) {
    if (error instanceof ActError && error.errorCode === NO_SUCH_REQUEST) return null;
    throw error;
  }
  if (detail.request === null) return null;

  const { evidence, evidenceError } = await evidenceCall;
  return {
    request: detail.request,
    events: detail.events,
    related: detail.related,
    route: detail.route,
    gold: detail.gold,
    checks: detail.checks,
    viewer: detail.viewer ?? UNKNOWN_VIEWER,
    returnCandidates: detail.returnCandidates ?? [],
    evidence,
    evidenceError,
  };
}

/** The six live approval checks again ("Check again"): the golden record may have moved since the page opened. */
export async function refreshChecks(requestId: number): Promise<CheckRow[]> {
  const client = await getRayfinClient();
  return unwrapAct(await client.functions.getRequestChecks.invoke({ requestId })).checks;
}

/**
 * Records one decision. `expectedStatus` is the status the screen showed: the procedure refuses when the request
 * has moved on, so a stale page can never decide a request that somebody else already decided. `returnTo` (RETURN
 * only) is the e-mail of the person picked in the dialog; empty sends it to the default recipient. The procedure
 * checks the choice again (app.fn_return_candidates).
 */
export async function decide(
  requestId: number,
  decision: Decision,
  comment: string,
  expectedStatus: string,
  returnTo = ''
): Promise<DecideAnswer> {
  const client = await getRayfinClient();
  return unwrapAct(await client.functions.decideRequest.invoke({ requestId, decision, comment, expectedStatus, returnTo }));
}

/** The requester (or an admin) withdraws an open request. */
export async function withdraw(requestId: number, comment: string): Promise<WithdrawAnswer> {
  const client = await getRayfinClient();
  return unwrapAct(await client.functions.cancelRequest.invoke({ requestId, comment }));
}
