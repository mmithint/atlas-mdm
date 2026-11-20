import { describe, expect, it } from 'vitest';

import { checkRows } from './request-fixtures';
import {
  actorText,
  ageText,
  approvalBlockers,
  checkBadge,
  checkLabel,
  clip,
  decisionBanner,
  describeRoute,
  eventLabel,
  isClosed,
  mergeWording,
  oldValueMismatch,
  parseEvidence,
  requestTitle,
  returnTarget,
  statusDisplay,
  summarizeChecks,
  valueText,
  withdrawBanner,
} from './request-model';

describe('statuses, stages and events', () => {
  it('words every request status and marks a rejection red', () => {
    expect(statusDisplay('PENDING_RESPONSIBLE')).toEqual({ text: 'Waiting for responsible approval', kind: 'warning' });
    expect(statusDisplay('PENDING_ACCOUNTABLE').text).toBe('Waiting for accountable approval');
    expect(statusDisplay('RETURNED').kind).toBe('info');
    expect(statusDisplay('APPROVED').kind).toBe('success');
    expect(statusDisplay('REJECTED').kind).toBe('danger');
    expect(statusDisplay('CANCELLED').text).toBe('Withdrawn');
  });

  it('shows an unknown status as its own words instead of hiding it', () => {
    expect(statusDisplay('ON_HOLD')).toEqual({ text: 'on hold', kind: 'neutral' });
  });

  it('knows which statuses are closed', () => {
    for (const s of ['APPROVED', 'REJECTED', 'CANCELLED']) expect(isClosed(s)).toBe(true);
    for (const s of ['DRAFT', 'PENDING_RESPONSIBLE', 'PENDING_ACCOUNTABLE', 'RETURNED']) expect(isClosed(s)).toBe(false);
  });

  it('words every event type, and falls back to the type itself', () => {
    expect(eventLabel('MERGED')).toBe('Applied to the golden record');
    expect(eventLabel('MERGE_STALE')).toBe('Not applied: the value had changed');
    expect(eventLabel('SOMETHING_NEW')).toBe('something new');
  });

  it('says what a system actor is and leaves a person as it is', () => {
    expect(actorText('system:rule-run')).toBe('Rule run (system)');
    expect(actorText('system:de')).toBe('Data engineering import (system)');
    expect(actorText('system:merge')).toBe('Golden record update (system)');
    expect(actorText('system:other')).toBe('System');
    expect(actorText('t3.person@example.test')).toBe('t3.person@example.test');
    expect(actorText(null)).toBe('—');
  });
});

describe('approval checks', () => {
  it('words the six checks and falls back to the code', () => {
    expect(checkLabel('ASSOCIATION_MATCH')).toBe('Heater is still at the same location (FLOC)');
    expect(checkLabel('USER_ELIGIBLE_FOR_STAGE')).toBe('You may decide this stage');
    expect(checkLabel('NEW_CHECK')).toBe('new check');
  });

  it('lists the failed checks that block an approval, and only those', () => {
    expect(approvalBlockers(checkRows())).toEqual([]);
    expect(approvalBlockers(checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'FAIL' }, VALUE_ALLOWED: { checkStatus: 'FAIL' } }))).toEqual([
      'OLD_VALUE_CURRENT',
      'VALUE_ALLOWED',
    ]);
  });

  it('does not count NOT_CHECKED as a blocker, nor the sixth check (the server refuses that one with its own message)', () => {
    expect(approvalBlockers(checkRows({ ASSOCIATION_MATCH: { checkStatus: 'NOT_CHECKED' } }))).toEqual([]);
    expect(approvalBlockers(checkRows({ USER_ELIGIBLE_FOR_STAGE: { checkStatus: 'FAIL' } }))).toEqual([]);
  });

  it('gives the server\'s own words when the golden value moved on', () => {
    const rows = checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'FAIL', message: 'the current value is "X", the request expected "Y"' } });
    expect(oldValueMismatch(rows)).toBe('the current value is "X", the request expected "Y"');
    expect(oldValueMismatch(checkRows())).toBeNull();
    expect(oldValueMismatch(checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'NOT_CHECKED' } }))).toBeNull();
  });

  it('counts passes, failures and the rest', () => {
    const rows = checkRows({ VALUE_ALLOWED: { checkStatus: 'FAIL' }, UNITS_EXPLICIT: { checkStatus: 'NOT_CHECKED' } });
    expect(summarizeChecks(rows)).toEqual({ pass: 4, fail: 1, notChecked: 1 });
    expect(summarizeChecks([])).toEqual({ pass: 0, fail: 0, notChecked: 0 });
  });

  it('badges the three results', () => {
    expect(checkBadge('PASS')).toEqual({ text: 'Pass', kind: 'success' });
    expect(checkBadge('FAIL')).toEqual({ text: 'Fail', kind: 'danger' });
    expect(checkBadge('NOT_CHECKED')).toEqual({ text: 'Not checked', kind: 'neutral' });
  });
});

describe('parseEvidence', () => {
  const snapshot = {
    event: 'CREATED',
    source_type: 'BUSINESS_RULE',
    entity_type: 'EQUIPMENT',
    entity_key: 'SYN-EQ-1',
    route_used: 'FIELD',
    golden_version_id: 4,
    baseline_as_of_utc: '2026-11-01T00:00:00.000Z',
    evidence: { rule_message: 'duty is blank', count: 2, nested: { a: 1 }, empty: '', nothing: null },
  };

  it('says there is none for null, empty and blank text', () => {
    expect(parseEvidence(null)).toEqual({ kind: 'none' });
    expect(parseEvidence('')).toEqual({ kind: 'none' });
    expect(parseEvidence('   ')).toEqual({ kind: 'none' });
  });

  it('reads the facts and the attached items of the documented shape', () => {
    const parsed = parseEvidence(JSON.stringify(snapshot));
    expect(parsed.kind).toBe('snapshot');
    if (parsed.kind !== 'snapshot') return;
    expect(parsed.facts).toEqual({
      sourceType: 'BUSINESS_RULE',
      entityType: 'EQUIPMENT',
      entityKey: 'SYN-EQ-1',
      routeUsed: 'FIELD',
      goldenVersionId: '4',
      baselineAsOfUtc: '2026-11-01T00:00:00.000Z',
    });
    expect(parsed.items).toEqual([
      { key: 'rule message', value: 'duty is blank' },
      { key: 'count', value: '2' },
      { key: 'nested', value: '{"a":1}' },
      { key: 'empty', value: '—' },
      { key: 'nothing', value: '—' },
    ]);
    expect(parsed.itemsClipped).toBe(false);
  });

  it('tolerates a snapshot without the evidence part or with a part that is not an object', () => {
    const bare = parseEvidence(JSON.stringify({ event: 'CREATED', entity_key: 'K' }));
    expect(bare).toMatchObject({ kind: 'snapshot', items: [], facts: { entityKey: 'K', routeUsed: null } });
    const text = parseEvidence(JSON.stringify({ evidence: 'seen on the nameplate' }));
    expect(text).toMatchObject({ kind: 'snapshot', items: [{ key: 'evidence', value: 'seen on the nameplate' }] });
  });

  it('shows invalid JSON, and JSON that is not an object, as raw text, clipped', () => {
    expect(parseEvidence('{not json')).toEqual({ kind: 'raw', text: '{not json' });
    expect(parseEvidence('[1,2]')).toEqual({ kind: 'raw', text: '[1,2]' });
    expect(parseEvidence('42')).toEqual({ kind: 'raw', text: '42' });
    const long = parseEvidence('x'.repeat(2000));
    expect(long.kind).toBe('raw');
    if (long.kind === 'raw') expect(long.text).toHaveLength(601);
  });

  it('keeps at most 30 items and says so, and clips a long value', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) many[`k${i}`] = 'v';
    const parsed = parseEvidence(JSON.stringify({ evidence: many }));
    if (parsed.kind !== 'snapshot') throw new Error('expected a snapshot');
    expect(parsed.items).toHaveLength(30);
    expect(parsed.itemsClipped).toBe(true);

    const clipped = parseEvidence(JSON.stringify({ evidence: { long: 'y'.repeat(1000) } }));
    if (clipped.kind !== 'snapshot') throw new Error('expected a snapshot');
    expect(clipped.items[0]?.value).toHaveLength(301);
  });
});

describe('merge wording', () => {
  it('says in the golden record when it was applied, however it was recorded', () => {
    expect(mergeWording('APPLIED')).toEqual({ tone: 'success', text: 'In the golden record.' });
    expect(mergeWording('ALREADY_APPLIED').tone).toBe('success');
  });

  it('says the value changed for STALE, and that the approval stands', () => {
    const stale = mergeWording('STALE');
    expect(stale.tone).toBe('warning');
    expect(stale.text).toMatch(/changed after the request was raised/);
    expect(stale.text).toMatch(/approval stands/);
  });

  it('says the update is pending with the merge message for ERROR and NOT_ELIGIBLE', () => {
    expect(mergeWording('ERROR', 'merge not yet implemented.')).toEqual({
      tone: 'warning',
      text: 'Golden record update pending: merge not yet implemented. The approval stands.',
    });
    expect(mergeWording('NOT_ELIGIBLE').text).toBe('Golden record update pending. The approval stands.');
  });

  it('says not applied yet when no merge was tried', () => {
    expect(mergeWording(null)).toEqual({ tone: 'neutral', text: 'Not applied yet.' });
  });
});

describe('result banners', () => {
  const done = { requestRef: 'CR-000012', newStatus: 'PENDING_ACCOUNTABLE', needsMerge: false, merge: null };

  it('says what happened after each decision', () => {
    expect(decisionBanner(done)).toEqual({
      tone: 'success',
      title: 'CR-000012: Approved at the responsible stage. It now waits for the accountable stage.',
      detail: null,
    });
    expect(decisionBanner({ ...done, newStatus: 'REJECTED' }).title).toBe('CR-000012: Rejected. The request is closed.');
    expect(decisionBanner({ ...done, newStatus: 'RETURNED' }).title).toBe('CR-000012: Returned for correction.');
  });

  it('is a plain success when the final approval was merged', () => {
    const banner = decisionBanner({
      requestRef: 'CR-000012',
      newStatus: 'APPROVED',
      needsMerge: true,
      merge: { outcome: 'APPLIED', message: null, error: null },
    });
    expect(banner).toEqual({ tone: 'success', title: 'CR-000012: Approved by both stages.', detail: 'The golden record was updated.' });
  });

  it('turns into a warning when the merge is pending, stale, failed to record, or never started; the approval stands', () => {
    const base = { requestRef: 'CR-000012', newStatus: 'APPROVED', needsMerge: true };
    const pending = decisionBanner({ ...base, merge: { outcome: 'ERROR', message: 'merge not yet implemented', error: null } });
    expect(pending.tone).toBe('warning');
    expect(pending.detail).toMatch(/pending: merge not yet implemented/);
    expect(decisionBanner({ ...base, merge: { outcome: 'STALE', message: null, error: null } }).detail).toMatch(/golden value changed/);
    expect(decisionBanner({ ...base, merge: { outcome: 'APPLIED', message: null, error: 'could not record' } }).detail).toMatch(/could not record/);
    expect(decisionBanner({ ...base, merge: null }).detail).toMatch(/could not be started/);
  });

  it('uses a stand-in name when the answer has no reference, and words a withdrawal', () => {
    expect(decisionBanner({ ...done, requestRef: null }).title.startsWith('The request: ')).toBe(true);
    expect(withdrawBanner('CR-000012').title).toBe('CR-000012 was withdrawn. It is closed and stays in the history.');
  });
});

describe('small wording helpers', () => {
  it('names who a return goes to, with its kind, or null when the server named nobody', () => {
    expect(returnTarget({ returnToType: 'USER', returnTo: 'a@example.test', returnToLabel: 'A Person' })).toBe('A Person (person)');
    expect(returnTarget({ returnToType: 'GROUP', returnTo: 'SYN-GROUP', returnToLabel: null })).toBe('SYN-GROUP (group)');
    expect(returnTarget({ returnToType: null, returnTo: 'x', returnToLabel: null })).toBe('x');
    expect(returnTarget({ returnToType: null, returnTo: null, returnToLabel: null })).toBeNull();
  });

  it('keeps a blank blank and adds a unit only to a value', () => {
    expect(valueText(null)).toBe('—');
    expect(valueText('  ')).toBe('—');
    expect(valueText('2.5', 'MMBTU/hr')).toBe('2.5 MMBTU/hr');
    expect(valueText('A', null)).toBe('A');
    expect(valueText(null, 'MMBTU/hr')).toBe('—');
  });

  it('says how long a request has been open', () => {
    expect(ageText(null)).toBeNull();
    expect(ageText(0)).toBe('less than an hour');
    expect(ageText(1)).toBe('1 hour');
    expect(ageText(47)).toBe('47 hours');
    expect(ageText(72)).toBe('3 days');
  });

  it('titles the page with the field and the tag, then the number, then the location', () => {
    const base = { fieldLabel: 'Manufacturer', fieldCode: 'MANUFACTURER', equipmentTagNumber: 'T-1', equipmentNumber: 'E-1', functionalLocation: 'F-1' };
    expect(requestTitle(base)).toBe('Manufacturer on T-1');
    expect(requestTitle({ ...base, equipmentTagNumber: null })).toBe('Manufacturer on E-1');
    expect(requestTitle({ ...base, equipmentTagNumber: null, equipmentNumber: null })).toBe('Manufacturer on F-1');
    expect(requestTitle({ ...base, fieldLabel: null, equipmentTagNumber: null, equipmentNumber: null, functionalLocation: null })).toBe('MANUFACTURER');
  });

  it('describes the route in one line', () => {
    expect(describeRoute({ routeId: 3, entityType: 'EQUIPMENT', requestAction: 'UPDATE', fieldOrCharacteristic: '*', classScope: 'ANY' })).toBe(
      'Route 3: equipment update, any field, any class'
    );
    expect(describeRoute({ routeId: 9, entityType: 'FLOC', requestAction: 'UPDATE', fieldOrCharacteristic: 'OEM_BSFC', classScope: 'LIST' })).toBe(
      'Route 9: floc update, field OEM_BSFC, listed classes only'
    );
  });

  it('clips long text with an ellipsis and leaves short text alone', () => {
    expect(clip('abc', 5)).toBe('abc');
    expect(clip('abcdef', 5)).toBe('abcde…');
  });
});
