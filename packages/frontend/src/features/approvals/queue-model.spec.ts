import { describe, expect, it } from 'vitest';

import { bulkAnswer, queueRow } from './queue-fixtures';
import {
  AGE_OPTIONS,
  DEFAULT_PAGE_SIZE,
  QUEUE_TABS,
  ageText,
  allSelected,
  criteriaFromQuery,
  criteriaKey,
  facetOptions,
  hasFilters,
  mergeNote,
  noteView,
  orderedSelection,
  pruneSelection,
  queryFromCriteria,
  rangeText,
  selectableIds,
  sourceView,
  statusView,
  switchTab,
  tabById,
  timeView,
  toggleAll,
  toggleId,
  withoutFilters,
} from './queue-model';

const criteria = (query: string) => criteriaFromQuery(new URLSearchParams(query));

describe('the six tabs', () => {
  it('are the client\'s tabs, in order, each with its own count', () => {
    expect(QUEUE_TABS.map((t) => [t.id, t.label, t.countKey])).toEqual([
      ['RESPONSIBLE', 'My Responsible', 'responsible'],
      ['ACCOUNTABLE', 'My Accountable', 'accountable'],
      ['RETURNED', 'Returned to me', 'returned'],
      ['APPROVED', 'Approved', 'approved'],
      ['REJECTED', 'Rejected', 'rejected'],
      ['MY_REQUESTS', 'My Requests', 'mine'],
    ]);
  });

  it('let a person act (checkboxes and bulk approve) only on the two pending tabs', () => {
    expect(QUEUE_TABS.filter((t) => t.pending).map((t) => t.id)).toEqual(['RESPONSIBLE', 'ACCOUNTABLE']);
  });

  it('apply the age filter only where requests are open', () => {
    expect(QUEUE_TABS.filter((t) => !t.ageApplies).map((t) => t.id)).toEqual(['APPROVED', 'REJECTED']);
  });

  it('each explain an empty list, starting with the client\'s own sentence where one exists', () => {
    for (const t of QUEUE_TABS) {
      expect(t.emptyTitle.length).toBeGreaterThan(5);
      expect(t.emptyHint.length).toBeGreaterThan(20);
    }
    expect(tabById('RESPONSIBLE').emptyHint).toMatch(/^No requests match this tab for the logged-in user\./);
  });

  it('fall back to the first tab for an unknown word', () => {
    expect(tabById('NONSENSE').id).toBe('RESPONSIBLE');
    expect(tabById(null).id).toBe('RESPONSIBLE');
    expect(tabById('APPROVED').id).toBe('APPROVED');
  });
});

describe('criteria and the address', () => {
  it('start on My Responsible with no filter and the default page size', () => {
    expect(criteria('')).toEqual({
      tab: 'RESPONSIBLE',
      profitCenter: '',
      fieldCode: '',
      ruleId: '',
      minAgeHours: 0,
      noteOnly: false,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('read every part of the address', () => {
    expect(criteria('tab=ACCOUNTABLE&pc=OP%20EOR&field=HEAT_DUTY&rule=HEATER_DUTY&age=72&note=1&size=50')).toEqual({
      tab: 'ACCOUNTABLE',
      profitCenter: 'OP EOR',
      fieldCode: 'HEAT_DUTY',
      ruleId: 'HEATER_DUTY',
      minAgeHours: 72,
      noteOnly: true,
      pageSize: 50,
    });
  });

  it('turn unreadable parts into defaults', () => {
    const c = criteria('tab=NOPE&age=13&size=7&note=yes&pc=%20%20');
    expect(c).toMatchObject({ tab: 'RESPONSIBLE', minAgeHours: 0, noteOnly: false, pageSize: DEFAULT_PAGE_SIZE, profitCenter: '' });
  });

  it('drop an age that means nothing on the approved and rejected tabs', () => {
    expect(criteria('tab=APPROVED&age=72').minAgeHours).toBe(0);
    expect(criteria('tab=REJECTED&age=24').minAgeHours).toBe(0);
    expect(criteria('tab=RETURNED&age=24').minAgeHours).toBe(24);
    expect(hasFilters(criteria('tab=APPROVED&age=72'))).toBe(false);
  });

  it('write only what differs from the default, and never the row offset', () => {
    expect(queryFromCriteria(criteria(''))).toEqual({
      tab: undefined, pc: undefined, field: undefined, rule: undefined, age: undefined, note: undefined, size: undefined,
    });
    const q = queryFromCriteria(criteria('tab=RETURNED&pc=OP%20EOR&age=24&note=1&size=100'));
    expect(q).toEqual({ tab: 'RETURNED', pc: 'OP EOR', field: undefined, rule: undefined, age: '24', note: '1', size: '100' });
    expect(Object.keys(q)).not.toContain('offset');
  });

  it('give a different key to every change that changes the list', () => {
    const base = criteria('');
    const keys = new Set([
      criteriaKey(base),
      criteriaKey(criteria('tab=RETURNED')),
      criteriaKey(criteria('pc=X')),
      criteriaKey(criteria('field=X')),
      criteriaKey(criteria('rule=X')),
      criteriaKey(criteria('age=24')),
      criteriaKey(criteria('note=1')),
      criteriaKey(criteria('size=50')),
    ]);
    expect(keys.size).toBe(8);
  });

  it('know when a filter is on, and clear them all while keeping the tab and page size', () => {
    expect(hasFilters(criteria('tab=RETURNED&size=50'))).toBe(false);
    for (const q of ['pc=X', 'field=X', 'rule=X', 'age=24', 'note=1']) expect(hasFilters(criteria(q))).toBe(true);
    const cleared = withoutFilters(criteria('tab=RETURNED&size=50&pc=X&field=Y&rule=Z&age=24&note=1'));
    expect(cleared).toMatchObject({ tab: 'RETURNED', pageSize: 50, profitCenter: '', fieldCode: '', ruleId: '', minAgeHours: 0, noteOnly: false });
  });

  it('start another tab with no filter, because the filter choices belong to the tab\'s own rows', () => {
    const next = switchTab(criteria('pc=X&age=24&note=1&size=50'), 'ACCOUNTABLE');
    expect(next).toMatchObject({ tab: 'ACCOUNTABLE', pageSize: 50, profitCenter: '', minAgeHours: 0, noteOnly: false });
  });

  it('offer exactly four ages, "any" first', () => {
    expect(AGE_OPTIONS.map((o) => o.hours)).toEqual([0, 24, 72, 168]);
  });
});

describe('filter choices', () => {
  const facets = [
    { kind: 'FIELD', value: 'HEAT_DUTY', label: 'Heat duty', n: 3 },
    { kind: 'FIELD', value: 'MANUFACTURER', label: 'Manufacturer', n: 12 },
    { kind: 'RULE', value: 'R1', label: 'R1', n: 2 },
  ];

  it('list the values of one kind with their counts, in label order', () => {
    expect(facetOptions(facets, 'FIELD', '')).toEqual([
      { value: 'HEAT_DUTY', label: 'Heat duty (3)' },
      { value: 'MANUFACTURER', label: 'Manufacturer (12)' },
    ]);
  });

  it('always offer the value that is in the address, even when the tab has no such row', () => {
    expect(facetOptions(facets, 'RULE', 'OLD_RULE')).toEqual([
      { value: 'R1', label: 'R1 (2)' },
      { value: 'OLD_RULE', label: 'OLD_RULE' },
    ]);
    expect(facetOptions([], 'FIELD', '')).toEqual([]);
  });
});

describe('describing a row', () => {
  it('names every status and tones the ones that need a person', () => {
    expect(statusView('PENDING_RESPONSIBLE')).toEqual({ label: 'Awaiting responsible', tone: 'warning' });
    expect(statusView('PENDING_ACCOUNTABLE')).toEqual({ label: 'Awaiting accountable', tone: 'warning' });
    expect(statusView('RETURNED').tone).toBe('info');
    expect(statusView('APPROVED').tone).toBe('success');
    expect(statusView('CANCELLED').label).toBe('Withdrawn');
    expect(statusView('SOMETHING_NEW')).toEqual({ label: 'something new', tone: 'neutral' });
  });

  it('writes the age in hours, then days, and nothing for a closed request', () => {
    expect(ageText(null)).toBe('');
    expect(ageText(undefined)).toBe('');
    expect(ageText(0)).toBe('<1 h');
    expect(ageText(5)).toBe('5 h');
    expect(ageText(47)).toBe('47 h');
    expect(ageText(48)).toBe('2 d');
    expect(ageText(79)).toBe('3 d');
    expect(ageText(-1)).toBe('');
  });

  it('shows the submitter of a person\'s request and nobody for a rule or the system', () => {
    expect(sourceView({ sourceLabel: 'Manual request', sourceType: 'MANUAL', requestedBy: 'a@example.test' })).toEqual({
      label: 'Manual request',
      by: 'a@example.test',
    });
    expect(sourceView({ sourceLabel: 'Rule HEATER_DUTY v2', sourceType: 'BUSINESS_RULE', requestedBy: 'system:rule-run' })).toEqual({
      label: 'Rule HEATER_DUTY v2',
      by: null,
    });
    expect(sourceView({ sourceLabel: 'Correction import', sourceType: 'CORRECTION_IMPORT', requestedBy: 'system:de' }).by).toBeNull();
  });

  it('shows when a rule found a request, and when a person submitted theirs', () => {
    expect(timeView({ sourceType: 'BUSINESS_RULE', detectedAtUtc: 'D', requestedAtUtc: 'R' })).toEqual({ label: 'Detected', iso: 'D' });
    expect(timeView({ sourceType: 'BUSINESS_RULE', detectedAtUtc: null, requestedAtUtc: 'R' })).toEqual({ label: 'Submitted', iso: 'R' });
    expect(timeView({ sourceType: 'FIELD', detectedAtUtc: null, requestedAtUtc: 'R' })).toEqual({ label: 'Submitted', iso: 'R' });
  });

  it('flags TBD and shows any other note as text', () => {
    expect(noteView(null)).toBeNull();
    expect(noteView('   ')).toBeNull();
    expect(noteView('TBD')).toEqual({ tbd: true, text: 'TBD' });
    expect(noteView(' tbd ')).toEqual({ tbd: true, text: 'tbd' });
    expect(noteView('check with site')).toEqual({ tbd: false, text: 'check with site' });
  });
});

describe('selecting rows for a bulk approval', () => {
  const rows = [queueRow(1), queueRow(2, { canApprove: false }), queueRow(3), queueRow(4, { canApprove: false })];

  it('can select only what the server says the person may approve', () => {
    expect(selectableIds(rows)).toEqual([1, 3]);
  });

  it('toggles one row on and off without changing the original set', () => {
    const none = new Set<number>();
    const one = toggleId(none, 3);
    expect([...one]).toEqual([3]);
    expect(none.size).toBe(0);
    expect(toggleId(one, 3).size).toBe(0);
  });

  it('selects every approvable row at once, and clears when they are all selected already', () => {
    const all = toggleAll(new Set(), rows);
    expect([...all].sort()).toEqual([1, 3]);
    expect(allSelected(all, rows)).toBe(true);
    expect(toggleAll(all, rows).size).toBe(0);
    expect(allSelected(new Set([1]), rows)).toBe(false);
  });

  it('is never "all selected" when there is nothing to select', () => {
    expect(allSelected(new Set(), [queueRow(1, { canApprove: false })])).toBe(false);
    expect(allSelected(new Set(), [])).toBe(false);
  });

  it('drops a selected request that is no longer on the page or no longer approvable', () => {
    const kept = pruneSelection(new Set([1, 2, 3, 99]), rows);
    expect([...kept].sort()).toEqual([1, 3]);
  });

  it('hands the bulk function the numbers in the order of the page', () => {
    expect(orderedSelection(new Set([3, 1]), rows)).toEqual([1, 3]);
  });
});

describe('paging text', () => {
  it('says which rows are shown', () => {
    expect(rangeText(0, 25, 130)).toBe('1 to 25 of 130');
    expect(rangeText(20, 20, 130)).toBe('21 to 40 of 130');
    expect(rangeText(0, 0, 0)).toBe('No rows');
  });
});

describe('the bulk result', () => {
  it('says nothing about a request whose update of the golden record went through', () => {
    const a = bulkAnswer([{ id: 1, merge: { outcome: 'APPLIED', message: 'ok' } }, { id: 2, merge: { outcome: 'ALREADY_APPLIED', message: null } }]);
    expect(a.results.map(mergeNote)).toEqual([null, null]);
  });

  it('says the update is pending, with the merge\'s own words, when it did not complete', () => {
    const a = bulkAnswer([{ id: 1, merge: { outcome: 'ERROR', message: 'merge not yet implemented' } }]);
    expect(mergeNote(a.results[0]!)).toBe('approved; update of the golden record pending: merge not yet implemented');
  });

  it('falls back to the outcome when the merge gave no message, and says nothing for a request that was not approved', () => {
    const a = bulkAnswer([{ id: 1, merge: { outcome: 'STALE', message: null } }, { id: 2, reason: 'checks failed', merge: { outcome: 'ERROR', message: 'x' } }, { id: 3 }]);
    expect(mergeNote(a.results[0]!)).toBe('approved; update of the golden record pending: STALE');
    expect(mergeNote(a.results[1]!)).toBeNull();
    expect(mergeNote(a.results[2]!)).toBeNull(); // a final approval always has a merge; a first-stage one has none
  });
});
