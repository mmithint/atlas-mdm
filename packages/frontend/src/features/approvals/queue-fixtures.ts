/**
 * Synthetic rows for the approvals tests. Everything here is invented (SYN- identifiers, example.test
 * people); nothing comes from the client.
 */
import type { BulkAnswer, QueuePage, QueueRow } from './queue-api';

export function queueRow(n: number, over: Partial<Record<keyof QueueRow, unknown>> = {}): QueueRow {
  const code = String(n).padStart(4, '0');
  return {
    requestId: n,
    requestRef: `CR-${String(n).padStart(6, '0')}`,
    requestStatus: 'PENDING_RESPONSIBLE',
    approvalStage: 'RESPONSIBLE',
    entityType: 'EQUIPMENT',
    equipmentId: n,
    equipmentNumber: `SYN-EQ-${code}`,
    functionalLocation: `SYN-FL-${code}`,
    equipmentTagNumber: `SYN-TAG-${code}`,
    profitCenterName: 'ROCKIES-DJ BASIN',
    fieldCode: 'MANUFACTURER',
    fieldLabel: 'Manufacturer',
    sapField: 'HERST',
    oldValue: 'SYNTHETIC MFR A',
    newValue: 'SYNTHETIC MFR B',
    reason: 'Nameplate says B',
    note: null,
    sourceType: 'MANUAL',
    sourceRuleId: null,
    sourceRuleVersion: null,
    sourceLabel: 'Manual request',
    requestedBy: 'someone@example.test',
    requestedAtUtc: '2026-11-17T09:30:00.000Z',
    detectedAtUtc: null,
    responsibleGroup: 'SYN-GROUP-R',
    accountableGroup: 'SYN-GROUP-A',
    returnRecipientType: null,
    returnRecipient: null,
    ageHours: 5,
    photoCount: 0,
    updatedAtUtc: '2026-11-17T09:30:00.000Z',
    canApprove: true,
    ...over,
  } as unknown as QueueRow;
}

export function queuePage(rows: QueueRow[] = [queueRow(1), queueRow(2)], over: Partial<QueuePage> = {}): QueuePage {
  return {
    rows,
    counts: { responsible: rows.length, accountable: 4, returned: 1, approved: 62, rejected: 7, mine: 52 },
    totalMatches: rows.length,
    hasMore: false,
    facets: [
      { kind: 'PROFIT_CENTER', value: 'ROCKIES-DJ BASIN', label: 'ROCKIES-DJ BASIN', n: rows.length },
      { kind: 'FIELD', value: 'MANUFACTURER', label: 'Manufacturer', n: rows.length },
      { kind: 'RULE', value: 'HEATER_CLASS_FIRED', label: 'HEATER_CLASS_FIRED', n: 1 },
    ],
    ...over,
  };
}

/** A bulk answer built from per-request outcomes: `ok` rows are approved, the others skipped with the reason given. */
export function bulkAnswer(
  results: { id: number; reason?: string; merge?: { outcome: string; message: string | null } }[]
): BulkAnswer {
  const rows = results.map((r) => ({
    requestId: r.id,
    requestRef: `CR-${String(r.id).padStart(6, '0')}`,
    outcome: r.reason ? 'SKIPPED' : 'DECIDED',
    newStatus: r.reason ? null : 'PENDING_ACCOUNTABLE',
    reason: r.reason ?? null,
    merge: r.merge ? { outcome: r.merge.outcome, message: r.merge.message, goldenVersionId: null, recorded: 'COMMENTED', error: null } : null,
  }));
  const decided = rows.filter((r) => r.outcome === 'DECIDED').length;
  return {
    ok: true,
    status: 'OK',
    error: null,
    errorCode: null,
    userId: null,
    timing: { connectMs: 1, queryMs: 2, totalMs: 3 },
    decided,
    skipped: rows.length - decided,
    results: rows,
  } as unknown as BulkAnswer;
}
