import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueInvoke, bulkInvoke } = vi.hoisted(() => ({ queueInvoke: vi.fn(), bulkInvoke: vi.fn() }));

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      getRequestQueue: { invoke: queueInvoke },
      bulkApprove: { invoke: bulkInvoke },
    },
  }),
}));

import { ActError } from '@/lib/act-answer';

import { bulkApproveRequests, fetchQueue } from './queue-api';
import { bulkAnswer, queuePage, queueRow } from './queue-fixtures';
import { criteriaFromQuery } from './queue-model';

const criteria = (query: string) => criteriaFromQuery(new URLSearchParams(query));
const ENVELOPE = { ok: true, status: 'OK', error: null, errorCode: null, userId: null, timing: { connectMs: 1, queryMs: 2, totalMs: 3 } };

const answerOf = (page = queuePage()) => ({ ...ENVELOPE, ...page });

beforeEach(() => {
  queueInvoke.mockReset();
  bulkInvoke.mockReset();
});

describe('fetchQueue', () => {
  it('asks for the tab and every filter, from the given row', async () => {
    queueInvoke.mockResolvedValue(answerOf());
    await fetchQueue(criteria('tab=ACCOUNTABLE&pc=OP%20EOR&field=HEAT_DUTY&rule=HEATER_DUTY&age=72&note=1&size=50'), 100);
    expect(queueInvoke).toHaveBeenCalledWith({
      tab: 'ACCOUNTABLE',
      profitCenter: 'OP EOR',
      fieldCode: 'HEAT_DUTY',
      ruleId: 'HEATER_DUTY',
      minAgeHours: 72,
      noteOnly: 1,
      offset: 100,
      pageSize: 50,
    });
  });

  it('sends "no filter" as empty text and zero', async () => {
    queueInvoke.mockResolvedValue(answerOf());
    await fetchQueue(criteria(''), 0);
    expect(queueInvoke).toHaveBeenCalledWith({
      tab: 'RESPONSIBLE',
      profitCenter: '',
      fieldCode: '',
      ruleId: '',
      minAgeHours: 0,
      noteOnly: 0,
      offset: 0,
      pageSize: 25,
    });
  });

  it('does not send an age on the approved and rejected tabs, even if one was set by hand', async () => {
    queueInvoke.mockResolvedValue(answerOf());
    await fetchQueue({ ...criteria('tab=APPROVED'), minAgeHours: 72 }, 0);
    await fetchQueue({ ...criteria('tab=REJECTED'), minAgeHours: 24 }, 0);
    expect(queueInvoke.mock.calls.map((c) => c[0].minAgeHours)).toEqual([0, 0]);
  });

  it('returns the rows, the six counts, the total, whether there is more, and the filter choices', async () => {
    const rows = [queueRow(1), queueRow(2)];
    const page = queuePage(rows, { totalMatches: 40, hasMore: true });
    queueInvoke.mockResolvedValue(answerOf(page));
    expect(await fetchQueue(criteria(''), 0)).toEqual(page);
  });

  it('throws the function\'s own sentence when it did not work', async () => {
    queueInvoke.mockResolvedValue({
      ...answerOf(),
      ok: false,
      status: 'NOT_REGISTERED',
      error: 'Your sign-in is not linked to a person yet.',
    });
    await expect(fetchQueue(criteria(''), 0)).rejects.toThrow('Your sign-in is not linked to a person yet.');
    await expect(fetchQueue(criteria(''), 0)).rejects.toBeInstanceOf(ActError);
  });
});

describe('bulkApproveRequests', () => {
  it('sends the request numbers as one comma list with the comment', async () => {
    bulkInvoke.mockResolvedValue(bulkAnswer([{ id: 3 }, { id: 5 }]));
    await bulkApproveRequests([3, 5, 9], 'checked on site');
    expect(bulkInvoke).toHaveBeenCalledWith({ requestIds: '3,5,9', comment: 'checked on site' });
  });

  it('returns the per-request outcomes, skipped ones included, without throwing', async () => {
    const answer = bulkAnswer([{ id: 1 }, { id: 2, reason: 'Approval is blocked by failed checks: OLD_VALUE_CURRENT.' }]);
    bulkInvoke.mockResolvedValue(answer);
    const result = await bulkApproveRequests([1, 2], '');
    expect(result.decided).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('refuses an empty list or more than 100 before calling anything', async () => {
    await expect(bulkApproveRequests([], '')).rejects.toThrow('Select at least one request.');
    await expect(bulkApproveRequests(Array.from({ length: 101 }, (_, i) => i + 1), '')).rejects.toThrow('At most 100');
    expect(bulkInvoke).not.toHaveBeenCalled();
  });

  it('throws the function\'s sentence when the whole call was refused', async () => {
    bulkInvoke.mockResolvedValue({ ...bulkAnswer([]), ok: false, status: 'REFUSED', error: 'At most 100 requests can be decided at once.', errorCode: 50152 });
    await expect(bulkApproveRequests([1], '')).rejects.toThrow('At most 100 requests can be decided at once.');
  });
});
