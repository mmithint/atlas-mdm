import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detailInvoke, evidenceInvoke, checksInvoke, decideInvoke, cancelInvoke } = vi.hoisted(() => ({
  detailInvoke: vi.fn(),
  evidenceInvoke: vi.fn(),
  checksInvoke: vi.fn(),
  decideInvoke: vi.fn(),
  cancelInvoke: vi.fn(),
}));

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      getRequestDetail: { invoke: detailInvoke },
      getRequestEvidence: { invoke: evidenceInvoke },
      getRequestChecks: { invoke: checksInvoke },
      decideRequest: { invoke: decideInvoke },
      cancelRequest: { invoke: cancelInvoke },
    },
  }),
}));

import { ActError } from '@/lib/act-answer';

import { decide, fetchRequest, refreshChecks, withdraw } from './request-api';
import { checkRows, detailRow, eventRow, goldRow, relatedRow, routeRow, viewer } from './request-fixtures';

const ENVELOPE = { ok: true, status: 'OK', error: null, errorCode: null, userId: 'id', timing: { connectMs: 1, queryMs: 2, totalMs: 3 } };
const refused = (message: string, errorCode: number) => ({ ...ENVELOPE, ok: false, status: 'REFUSED', error: message, errorCode });

function detailAnswer(over: Record<string, unknown> = {}) {
  return {
    ...ENVELOPE,
    request: detailRow(),
    events: [eventRow(1)],
    related: [relatedRow(5)],
    route: routeRow(),
    gold: goldRow(),
    checks: checkRows(),
    viewer: viewer(),
    ...over,
  };
}

const evidenceAnswer = { ...ENVELOPE, requestRef: 'CR-000012', createdAtUtc: '2026-11-17T09:30:00.000Z', createdBy: 'x@example.test', detailsJson: '{"event":"CREATED"}' };

beforeEach(() => {
  for (const mock of [detailInvoke, evidenceInvoke, checksInvoke, decideInvoke, cancelInvoke]) mock.mockReset();
});

describe('fetchRequest', () => {
  it('reads the request and its evidence in parallel and puts them together', async () => {
    detailInvoke.mockResolvedValue(detailAnswer());
    evidenceInvoke.mockResolvedValue(evidenceAnswer);
    const view = await fetchRequest(12);
    expect(detailInvoke).toHaveBeenCalledWith({ requestId: 12 });
    expect(evidenceInvoke).toHaveBeenCalledWith({ requestId: 12 });
    expect(view?.request.requestRef).toBe('CR-000012');
    expect(view?.events).toHaveLength(1);
    expect(view?.related).toHaveLength(1);
    expect(view?.checks).toHaveLength(6);
    expect(view?.evidence).toEqual({ createdAtUtc: '2026-11-17T09:30:00.000Z', createdBy: 'x@example.test', detailsJson: '{"event":"CREATED"}' });
    expect(view?.evidenceError).toBeNull();
  });

  it('starts both reads before waiting for either', async () => {
    let releaseDetail: (value: unknown) => void = () => undefined;
    detailInvoke.mockReturnValue(new Promise((resolve) => (releaseDetail = resolve)));
    evidenceInvoke.mockResolvedValue(evidenceAnswer);
    const pending = fetchRequest(12);
    await vi.waitFor(() => expect(evidenceInvoke).toHaveBeenCalled());
    expect(detailInvoke).toHaveBeenCalled();
    releaseDetail(detailAnswer());
    expect(await pending).not.toBeNull();
  });

  it('does not fail the page when only the evidence cannot be read', async () => {
    detailInvoke.mockResolvedValue(detailAnswer());
    evidenceInvoke.mockResolvedValue(refused('The evidence is not available.', 50201));
    const view = await fetchRequest(12);
    expect(view?.request.requestRef).toBe('CR-000012');
    expect(view?.evidence).toBeNull();
    expect(view?.evidenceError).toBe('The evidence is not available.');
  });

  it('survives an evidence call that throws', async () => {
    detailInvoke.mockResolvedValue(detailAnswer());
    evidenceInvoke.mockRejectedValue(new Error('network down'));
    const view = await fetchRequest(12);
    expect(view?.evidenceError).toBe('network down');
  });

  it('returns null for the "no such request" refusal (50301)', async () => {
    detailInvoke.mockResolvedValue(refused('That request does not exist.', 50301));
    evidenceInvoke.mockResolvedValue(refused('That request does not exist.', 50201));
    expect(await fetchRequest(999)).toBeNull();
  });

  it('returns null when the answer has no request row', async () => {
    detailInvoke.mockResolvedValue(detailAnswer({ request: null }));
    evidenceInvoke.mockResolvedValue(evidenceAnswer);
    expect(await fetchRequest(12)).toBeNull();
  });

  it('lets any other failure reach the screen with the function\'s own words', async () => {
    detailInvoke.mockResolvedValue({ ...ENVELOPE, ok: false, status: 'FAILED', error: 'Could not read the request (229): permission denied.', errorCode: 229 });
    evidenceInvoke.mockResolvedValue(evidenceAnswer);
    await expect(fetchRequest(12)).rejects.toThrow(/229.*permission denied/);
    await expect(fetchRequest(12)).rejects.toBeInstanceOf(ActError);
  });

  it('assumes nothing is allowed, and says so, when the answer has no viewer row', async () => {
    detailInvoke.mockResolvedValue(detailAnswer({ viewer: null }));
    evidenceInvoke.mockResolvedValue(evidenceAnswer);
    const view = await fetchRequest(12);
    expect(view?.viewer.canDecide).toBe(false);
    expect(view?.viewer.canApprove).toBe(false);
    expect(view?.viewer.canCancel).toBe(false);
    expect(view?.viewer.decideBlockedReason).toMatch(/did not say/);
    expect(view?.viewer.approveBlockedReason).toMatch(/did not say/);
  });
});

describe('refreshChecks', () => {
  it('returns the six checks from the checks function', async () => {
    checksInvoke.mockResolvedValue({ ...ENVELOPE, requestStatus: 'PENDING_RESPONSIBLE', checks: checkRows() });
    const rows = await refreshChecks(12);
    expect(checksInvoke).toHaveBeenCalledWith({ requestId: 12 });
    expect(rows).toHaveLength(6);
  });

  it('turns a refusal into an exception', async () => {
    checksInvoke.mockResolvedValue(refused('That request does not exist.', 50130));
    await expect(refreshChecks(12)).rejects.toThrow('That request does not exist.');
  });
});

describe('decide and withdraw', () => {
  it('sends the decision, the comment and the status the screen showed', async () => {
    const answer = { ...ENVELOPE, requestId: 12, requestRef: 'CR-000012', decision: 'APPROVE', previousStatus: 'PENDING_RESPONSIBLE', newStatus: 'PENDING_ACCOUNTABLE', stage: 'RESPONSIBLE', needsMerge: false, merge: null };
    decideInvoke.mockResolvedValue(answer);
    expect(await decide(12, 'APPROVE', 'looks right', 'PENDING_RESPONSIBLE')).toEqual(answer);
    expect(decideInvoke).toHaveBeenCalledWith({ requestId: 12, decision: 'APPROVE', comment: 'looks right', expectedStatus: 'PENDING_RESPONSIBLE', returnTo: '' });
  });

  it('turns a refusal into an exception carrying the procedure\'s message and number', async () => {
    decideInvoke.mockResolvedValue(refused('The request is now PENDING_ACCOUNTABLE, not PENDING_RESPONSIBLE: reload it and decide again.', 50135));
    const error = await decide(12, 'REJECT', 'no', 'PENDING_RESPONSIBLE').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActError);
    expect((error as ActError).errorCode).toBe(50135);
    expect((error as ActError).message).toMatch(/reload it/);
  });

  it('withdraws with the comment', async () => {
    const answer = { ...ENVELOPE, requestId: 12, requestRef: 'CR-000012', previousStatus: 'PENDING_RESPONSIBLE', newStatus: 'CANCELLED' };
    cancelInvoke.mockResolvedValue(answer);
    expect(await withdraw(12, 'raised by mistake')).toEqual(answer);
    expect(cancelInvoke).toHaveBeenCalledWith({ requestId: 12, comment: 'raised by mistake' });
  });

  it('turns a refused withdrawal into an exception', async () => {
    cancelInvoke.mockResolvedValue(refused('Only the person who raised the request may withdraw it.', 50173));
    await expect(withdraw(12, '')).rejects.toThrow(/Only the person who raised/);
  });
});
