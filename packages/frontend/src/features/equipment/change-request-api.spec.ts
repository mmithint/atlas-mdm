import { beforeEach, describe, expect, it, vi } from 'vitest';

const { formInvoke, createInvoke, requestsInvoke } = vi.hoisted(() => ({
  formInvoke: vi.fn(),
  createInvoke: vi.fn(),
  requestsInvoke: vi.fn(),
}));

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      getRequestFormOptions: { invoke: formInvoke },
      createChangeRequest: { invoke: createInvoke },
      getEquipmentRequests: { invoke: requestsInvoke },
    },
  }),
}));

import { ActError } from '@/lib/act-answer';

import { fetchEquipmentRequests, fetchFormOptions, submitChangeRequest } from './change-request-api';
import { requestRow } from './test-fixtures';

const OK = { ok: true, status: 'OK', error: null, errorCode: null };
const REFUSED = { ok: false, status: 'REFUSED', error: 'Only an admin may ask to change this field by hand.', errorCode: 50113 };

beforeEach(() => {
  formInvoke.mockReset();
  createInvoke.mockReset();
  requestsInvoke.mockReset();
});

describe('fetchFormOptions', () => {
  it('returns what the form needs from the answer', async () => {
    formInvoke.mockResolvedValue({
      ...OK,
      canSubmit: true,
      isAdmin: false,
      allowedValues: [{ fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 }],
      blockedFields: [{ fieldCode: 'EQUIP_CLASS', reason: 'Only an admin may change this field.' }],
      timing: { connectMs: 1, queryMs: 1, totalMs: 2 },
    });
    expect(await fetchFormOptions()).toEqual({
      canSubmit: true,
      isAdmin: false,
      allowedValues: [{ fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 }],
      blockedFields: [{ fieldCode: 'EQUIP_CLASS', reason: 'Only an admin may change this field.' }],
    });
  });

  it("throws the function's own words when the answer is not ok", async () => {
    formInvoke.mockResolvedValue({ ...REFUSED, status: 'NOT_REGISTERED', error: 'Your sign-in is not linked to a person yet.', errorCode: null });
    await expect(fetchFormOptions()).rejects.toThrow('Your sign-in is not linked to a person yet.');
  });
});

describe('submitChangeRequest', () => {
  const args = {
    source: 'MANUAL',
    entityType: 'EQUIPMENT',
    equipmentId: 7,
    functionalLocation: '',
    fieldCode: 'MANUFACTURER',
    oldValue: 'A',
    newValue: 'B',
    reason: 'why',
    comment: '',
    evidenceJson: '',
  };

  it('passes the arguments through and returns the answer', async () => {
    createInvoke.mockResolvedValue({ ...OK, requestId: 4, requestRef: 'CR-000004', outcome: 'CREATED' });
    const answer = await submitChangeRequest(args);
    expect(createInvoke).toHaveBeenCalledWith(args);
    expect(answer.outcome).toBe('CREATED');
  });

  it('throws an ActError carrying the status and the refusal number', async () => {
    createInvoke.mockResolvedValue(REFUSED);
    const failure = await submitChangeRequest(args).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ActError);
    expect(failure).toMatchObject({ message: REFUSED.error, status: 'REFUSED', errorCode: 50113 });
  });
});

describe('fetchEquipmentRequests', () => {
  it('asks for one heater and returns the count and the rows', async () => {
    requestsInvoke.mockResolvedValue({ ...OK, totalCount: 3, rows: [requestRow(1)] });
    expect(await fetchEquipmentRequests(7)).toEqual({ totalCount: 3, rows: [requestRow(1)] });
    expect(requestsInvoke).toHaveBeenCalledWith({ equipmentId: 7 });
  });

  it('throws when the answer is not ok', async () => {
    requestsInvoke.mockResolvedValue({ ...REFUSED, status: 'FAILED', error: 'Could not read the requests (1): boom', errorCode: 1 });
    await expect(fetchEquipmentRequests(7)).rejects.toThrow('Could not read the requests');
  });
});
