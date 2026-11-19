import { beforeEach, describe, expect, it } from 'vitest';

import { catalogRows, mockHandlers, resetMock } from './mock-functions';
import { createMockClient } from './mock-client';

const h = mockHandlers as Required<typeof mockHandlers>;
const queueInput = { tab: 'RESPONSIBLE', profitCenter: '', fieldCode: '', ruleId: '', minAgeHours: 0, noteOnly: 0, offset: 0, pageSize: 25 };

describe('mock functions (npm run dev:mock)', () => {
  beforeEach(resetMock);

  it('profile lets the mock user see every screen', () => {
    const p = h.getMyProfile({});
    expect(p.status).toBe('OK');
    expect(p.canResponsibleApprove && p.canAccountableApprove && p.canSubmitRequests).toBe(true);
    expect(p.email).toMatch(/@example\.test$/);
  });

  it('search pages, filters and counts open requests', () => {
    const base = { mode: 'sorted', searchColumn: '', searchText: '', facility: '', sortColumn: 'equipmentNumber', sortDirection: 'asc', offset: 0, pageSize: 25 };
    const first = h.searchEquipment(base);
    expect(first.rows).toHaveLength(25);
    expect(first.totalMatches).toBe(60);
    expect(first.hasMore).toBe(true);
    expect(h.searchEquipment({ ...base, offset: 50 }).hasMore).toBe(false);

    const hit = h.searchEquipment({ ...base, mode: 'match', searchText: 'syn-eq-0007' });
    expect(hit.totalMatches).toBe(1);
    expect(hit.rows[0].equipmentNumber).toBe('SYN-EQ-0007');
  });

  it('detail answers for a known heater and says not found for an unknown one', () => {
    const found = h.getEquipmentDetail({ equipmentId: 7 });
    expect(found.found).toBe(true);
    expect(found.fieldValues.map((f) => f.fieldCode)).toEqual(catalogRows().map((c) => c.fieldCode));
    expect(h.getEquipmentDetail({ equipmentId: 9999 }).found).toBe(false);
  });

  it('queue tabs add up and a decision moves a request to the next tab', () => {
    const before = h.getRequestQueue(queueInput);
    expect(before.rows.every((r) => r.requestStatus === 'PENDING_RESPONSIBLE')).toBe(true);
    const target = before.rows[0];

    const answer = h.decideRequest({ requestId: target.requestId, decision: 'APPROVE', comment: '', expectedStatus: 'PENDING_RESPONSIBLE', returnTo: '' });
    expect(answer.ok).toBe(true);
    expect(answer.newStatus).toBe('PENDING_ACCOUNTABLE');

    const after = h.getRequestQueue(queueInput);
    expect(after.counts.responsible).toBe(before.counts.responsible - 1);
    expect(after.counts.accountable).toBe(before.counts.accountable + 1);
  });

  it('a stale decision is refused with the same envelope the real functions use', () => {
    const r = h.decideRequest({ requestId: 1, decision: 'APPROVE', comment: '', expectedStatus: 'APPROVED', returnTo: '' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe('REFUSED');
    expect(r.errorCode).toBe(50310);
  });

  it('a new change request shows up under My requests', () => {
    const created = h.createChangeRequest({
      source: 'MANUAL', entityType: 'EQUIPMENT', equipmentId: 3, functionalLocation: '', fieldCode: 'MANUFACTURER',
      oldValue: 'A', newValue: 'B', reason: 'test', comment: '', evidenceJson: '',
    });
    expect(created.ok).toBe(true);
    const mine = h.getRequestQueue({ ...queueInput, tab: 'MY_REQUESTS' });
    expect(mine.rows.some((r) => r.requestId === created.requestId)).toBe(true);
  });

  it('request detail has a viewer who can decide an open request and not a closed one', () => {
    expect(h.getRequestDetail({ requestId: 1 }).viewer?.canDecide).toBe(true);
    expect(h.getRequestDetail({ requestId: 15 }).viewer?.canDecide).toBe(false);
    expect(h.getRequestDetail({ requestId: 424242 }).ok).toBe(false);
  });

  it('the client serves functions and the catalogue, and names an unmocked function', async () => {
    const client = createMockClient() as unknown as {
      functions: Record<string, { invoke: (i?: unknown) => Promise<{ status?: string }> }>;
      connectors: { atlas_sql_db: { FieldCatalog: { select: (c: unknown) => { where: (w: unknown) => { orderBy: (o: unknown) => { execute: () => Promise<unknown[]> } } } } } };
    };
    expect((await client.functions.getMyProfile.invoke()).status).toBe('OK');
    const rows = await client.connectors.atlas_sql_db.FieldCatalog.select({}).where({}).orderBy({}).execute();
    expect(rows.length).toBeGreaterThan(0);
    await expect(client.functions.whoAmI.invoke()).rejects.toThrow(/not mocked/);
  });
});
