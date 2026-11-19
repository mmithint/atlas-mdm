import { beforeEach, describe, expect, it } from 'vitest';

import { demo, resetDemo } from './demo-store';
import { mockHandlers, resetMock } from './mock-functions';
import { setPersona } from './personas';
import { previewHandlers } from './preview-handlers';

/**
 * The client-demo story (FINAL PLAN/11 §5): one persona's action shows up for the next persona.
 * These run the handlers exactly as the screens call them.
 */
const h = mockHandlers as Required<typeof mockHandlers>;
const queue = (tab: string) =>
  h.getRequestQueue({ tab, profitCenter: '', fieldCode: '', ruleId: '', minAgeHours: 0, noteOnly: 0, offset: 0, pageSize: 100 });
const decide = (requestId: number, decision: string, returnTo = '', comment = '') =>
  h.decideRequest({ requestId, decision, comment, expectedStatus: '', returnTo });

describe('demo store and personas (npm run dev:mock)', () => {
  beforeEach(resetMock);

  it('the responsible approver sees only the requests routed to Carlsbad, and may approve them', () => {
    setPersona('responsible');
    const page = queue('RESPONSIBLE');
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.responsibleGroup === 'Operations-IOC-Carlsbad' && r.profitCenterName === 'OP RES DB NM')).toBe(true);
    expect(page.rows.every((r) => r.canApprove)).toBe(true);
    expect(queue('ACCOUNTABLE').rows).toHaveLength(0);
  });

  it('the field lead cannot decide, and has the two returned requests', () => {
    setPersona('field');
    expect(queue('RESPONSIBLE').rows).toHaveLength(0);
    expect(queue('RETURNED').rows).toHaveLength(2);
    setPersona('admin');
    const waiting = queue('RESPONSIBLE').rows[0];
    setPersona('field');
    const answer = decide(waiting.requestId, 'APPROVE');
    expect(answer.ok).toBe(false);
    expect(answer.errorCode).toBe(50140);
  });

  it('stage 1 tells the accountable group; stage 2 changes the heater and records the merge', () => {
    setPersona('responsible');
    const target = queue('RESPONSIBLE').rows.find((r) => r.sourceType !== 'BUSINESS_RULE');
    expect(target).toBeDefined();
    const id = target!.requestId;
    expect(decide(id, 'APPROVE').newStatus).toBe('PENDING_ACCOUNTABLE');

    setPersona('accountable');
    const inbox = h.getMyNotifications({ limit: 50 });
    expect(inbox.items.some((n) => n.requestId === id && !n.isRead)).toBe(true);
    expect(queue('ACCOUNTABLE').rows.some((r) => r.requestId === id)).toBe(true);

    const answer = decide(id, 'APPROVE');
    expect(answer.newStatus).toBe('APPROVED');
    expect(answer.merge?.outcome).toBe('MERGED');

    const detail = h.getRequestDetail({ requestId: id });
    expect(detail.events.map((e) => e.eventType)).toEqual(['CREATED', 'RESPONSIBLE_APPROVED', 'ACCOUNTABLE_APPROVED', 'MERGED']);
    const heater = h.getEquipmentDetail({ equipmentId: target!.equipmentId! });
    expect(heater.fieldValues.find((f) => f.fieldCode === target!.fieldCode)?.currentValue).toBe(target!.newValue);
  });

  it('a return lands with the picked person, who corrects and resubmits it', () => {
    setPersona('responsible');
    const target = queue('RESPONSIBLE').rows[0];
    expect(decide(target.requestId, 'RETURN', 'riley.brooks@example.test', 'Add a photo').newStatus).toBe('RETURNED');

    setPersona('field');
    expect(queue('RETURNED').rows.some((r) => r.requestId === target.requestId)).toBe(true);
    expect(h.getRequestDetail({ requestId: target.requestId }).viewer?.canResubmit).toBe(true);
    const again = h.resubmitRequest({ requestId: target.requestId, newValue: 'SYN-CORRECTED', comment: 'Photo added' });
    expect(again.newStatus).toBe('PENDING_RESPONSIBLE');

    setPersona('responsible');
    expect(queue('RESPONSIBLE').rows.find((r) => r.requestId === target.requestId)?.newValue).toBe('SYN-CORRECTED');
  });

  it('the same change twice is suppressed; a different value on the same field is blocked', () => {
    setPersona('field');
    const input = { source: 'FIELD', entityType: 'EQUIPMENT', equipmentId: 2, functionalLocation: '', fieldCode: 'MODEL_NUMBER', oldValue: 'SYN-MODEL-3', newValue: 'SYN-MODEL-7', reason: 'Nameplate', comment: '', evidenceJson: '' };
    expect(h.createChangeRequest(input).outcome).toBe('CREATED');
    expect(h.createChangeRequest(input).outcome).toBe('DUPLICATE_SUPPRESSED');
    expect(h.createChangeRequest({ ...input, newValue: 'SYN-MODEL-8' }).outcome).toBe('BLOCKED_INCOMPATIBLE');
  });

  it('marking notifications read empties the unread count for that person only', () => {
    setPersona('responsible');
    expect(h.getMyNotifications({ limit: 50 }).unreadCount).toBeGreaterThan(0);
    const answer = previewHandlers.markNotificationsRead({ notificationIds: '' });
    expect(answer.marked).toBeGreaterThan(0);
    expect(h.getMyNotifications({ limit: 50 }).unreadCount).toBe(0);
    setPersona('accountable');
    expect(h.getMyNotifications({ limit: 50 }).unreadCount).toBeGreaterThan(0);
  });

  it('Reset demo puts the data back and keeps the persona', () => {
    setPersona('responsible');
    const before = queue('RESPONSIBLE').counts.responsible;
    decide(queue('RESPONSIBLE').rows[0].requestId, 'APPROVE');
    expect(queue('RESPONSIBLE').counts.responsible).toBe(before - 1);
    resetDemo();
    expect(queue('RESPONSIBLE').counts.responsible).toBe(before);
    expect(h.getMyProfile({}).email).toBe('sam.carter@example.test');
  });

  it('sample data stays sample data: invented heater ids, example.test people, the real profit centres', () => {
    const s = demo();
    expect(s.heaters.every((x) => x.equipmentNumber?.startsWith('SYN-'))).toBe(true);
    expect(s.requests.every((r) => r.requestedBy.startsWith('system:') || r.requestedBy.endsWith('@example.test'))).toBe(true);
    expect(new Set(s.heaters.map((x) => x.profitCenterName)).size).toBe(10);
  });
});
