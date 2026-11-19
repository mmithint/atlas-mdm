import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: async () => ({ functions: { getMyNotifications: { invoke } } }) }));

import { fetchNotifications } from './notifications-api';

beforeEach(() => {
  invoke.mockReset();
});

describe('fetchNotifications', () => {
  it('asks for the newest few and returns the count and the items', async () => {
    const items = [{ notificationId: 1, topic: 'REQUEST_APPROVED', requestId: 5, requestRef: 'CR-000005', title: 't', body: 'b', createdAtUtc: null, isRead: false }];
    invoke.mockResolvedValue({ ok: true, status: 'OK', error: null, errorCode: null, unreadCount: 4, items });
    expect(await fetchNotifications(10)).toEqual({ unreadCount: 4, items });
    expect(invoke).toHaveBeenCalledWith({ limit: 10 });
  });

  it("throws the function's own words when the answer is not ok", async () => {
    invoke.mockResolvedValue({ ok: false, status: 'NOT_REGISTERED', error: 'Your sign-in is not linked to a person yet.', errorCode: null });
    await expect(fetchNotifications(10)).rejects.toThrow('not linked to a person');
  });
});
