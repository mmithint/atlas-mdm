import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRequest, refreshChecks, decide, withdraw } = vi.hoisted(() => ({
  fetchRequest: vi.fn(),
  refreshChecks: vi.fn(),
  decide: vi.fn(),
  withdraw: vi.fn(),
}));
vi.mock('./request-api', () => ({ fetchRequest, refreshChecks, decide, withdraw }));

import { RequestDetail } from './request-detail.component';
import { checkRows, detailRow, eventRow, goldRow, relatedRow, requestView, viewer } from './request-fixtures';

const panel = () => screen.getByRole('tabpanel');
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

async function show(view = requestView()) {
  fetchRequest.mockResolvedValue(view);
  render(<RequestDetail idText="12" />);
  await screen.findByRole('heading', { level: 1 });
}

beforeEach(() => {
  for (const mock of [fetchRequest, refreshChecks, decide, withdraw]) mock.mockReset();
});

describe('the page', () => {
  it('shows the reference, the status, what changes and where, and links back to the approvals and to the heater', async () => {
    await show();
    expect(fetchRequest).toHaveBeenCalledWith(12);
    expect(screen.getByRole('heading', { level: 1, name: 'Manufacturer on SYN-TAG-0007' })).toBeInTheDocument();
    expect(screen.getByText('CR-000012')).toBeInTheDocument();
    expect(screen.getByText('Waiting for responsible approval')).toBeInTheDocument();
    expect(screen.getByText('Responsible (first stage)')).toBeInTheDocument();
    expect(screen.getByText('open for 5 hours')).toBeInTheDocument();
    // The equipment number is itself the link to the heater (there is no separate "Open the heater" button).
    expect(screen.getByRole('link', { name: 'SYN-EQ-0007' })).toHaveAttribute('href', '#/equipment/7');
    expect(screen.getByTitle('Functional location')).toHaveTextContent('SYN-FL-0007');
    expect(screen.getByTitle('SAP field this changes')).toHaveTextContent('HERST');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '#/approvals');
    expect(screen.queryByRole('button', { name: 'Open the heater' })).toBeNull();
  });

  it('does not link the equipment number for a location request, and does not say a closed request is open', async () => {
    await show(requestView({ request: detailRow({ entityType: 'FLOC', equipmentId: null, requestStatus: 'APPROVED', approvalStage: null }) }));
    expect(screen.queryByRole('link', { name: 'SYN-EQ-0007' })).toBeNull();
    expect(screen.queryByText(/open for/)).toBeNull();
  });

  it('shows the decision panel above the tabs, and the four tabs by their names', async () => {
    await show();
    expect(screen.getByRole('region', { name: 'Decision' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Request & related', 'Equipment & FLOC', 'Evidence', 'Audit & routing']);
    expect(screen.getByRole('tab', { name: 'Request & related' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between the tabs with the arrow keys, Home and End', async () => {
    await show();
    const first = screen.getByRole('tab', { name: 'Request & related' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Equipment & FLOC' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Equipment & FLOC' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'Audit & routing' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Audit & routing' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Request & related' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Request & related' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Audit & routing' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('tab "Request & related"', () => {
  it('shows the current and the proposed value, the reason, the note, who raised it and when', async () => {
    await show(requestView({ request: detailRow({ note: 'TBD', detectedAtUtc: '2026-11-17T06:00:00.000Z', sourceLabel: 'Rule HEATER_CLASS_FIRED v1', requestedBy: 'system:rule-run' }) }));
    const tab = within(panel());
    expect(tab.getByText('SYNTHETIC MFR A')).toBeInTheDocument();
    expect(tab.getByText('SYNTHETIC MFR B')).toBeInTheDocument();
    expect(tab.getByText('Nameplate photo shows a different maker')).toBeInTheDocument();
    expect(tab.getByText('TBD')).toBeInTheDocument();
    expect(tab.getByText('Rule HEATER_CLASS_FIRED v1')).toBeInTheDocument();
    expect(tab.getByText(/by Rule run \(system\)/)).toBeInTheDocument();
    // the submission time is shown twice on purpose: on the request and as the time of the evidence snapshot
    expect(tab.getAllByText('17 Nov 2026, 09:30 UTC')).toHaveLength(2);
    expect(tab.getByText('17 Nov 2026, 06:00 UTC')).toBeInTheDocument();
    expect(tab.getByText('Checked on site')).toBeInTheDocument();
  });

  it('shows the evidence snapshot with its watermark facts and what was attached', async () => {
    await show();
    const tab = within(panel());
    expect(tab.getByText('Snapshot taken')).toBeInTheDocument();
    expect(tab.getByText('FIELD')).toBeInTheDocument(); // route used
    expect(tab.getByText('1 Nov 2026, 00:00 UTC')).toBeInTheDocument(); // SAP baseline
    expect(tab.getByText('seen on')).toBeInTheDocument();
    expect(tab.getByText('nameplate')).toBeInTheDocument();
    expect(tab.getByText('photo taken')).toBeInTheDocument();
    expect(tab.getByText('true')).toBeInTheDocument();
  });

  it('shows evidence that is not JSON as it was stored, and says when there is none', async () => {
    await show(requestView({ evidence: { createdAtUtc: null, createdBy: null, detailsJson: '{not json at all' } }));
    expect(within(panel()).getByText('{not json at all')).toBeInTheDocument();
    expect(within(panel()).getByText(/not in the usual shape/)).toBeInTheDocument();
  });

  it('says no snapshot was kept when there is none', async () => {
    await show(requestView({ evidence: null }));
    expect(within(panel()).getByText('No evidence snapshot was kept for this request.')).toBeInTheDocument();
  });

  it('does not break the page when only the evidence could not be read', async () => {
    await show(requestView({ evidence: null, evidenceError: 'The evidence is not available.' }));
    expect(within(panel()).getByText(/The evidence snapshot could not be read \(The evidence is not available\.\)/)).toBeInTheDocument();
    // the rest still works
    expect(within(panel()).getByText('SYNTHETIC MFR B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('lists the related requests, each linking to its own page, with an overlap badge only where there is one', async () => {
    await show(requestView({ related: [relatedRow(5, { otherOpenRequestsSameField: 2 }), relatedRow(6, { requestStatus: 'APPROVED', isOpen: false })] }));
    const table = within(panel()).getByRole('table', { name: 'Related requests' });
    expect(within(table).getByRole('link', { name: 'CR-000005' })).toHaveAttribute('href', '#/requests/5');
    expect(within(table).getByRole('link', { name: 'CR-000006' })).toHaveAttribute('href', '#/requests/6');
    expect(within(table).getByText('overlaps 2 open')).toBeInTheDocument();
    expect(within(table).getAllByText(/overlaps/)).toHaveLength(1);
    expect(within(table).getByText('Approved')).toBeInTheDocument();
  });

  it('says there is no other request when there is none', async () => {
    await show();
    expect(within(panel()).getByText('No other request on this heater or location.')).toBeInTheDocument();
  });
});

describe('tab "Equipment & FLOC"', () => {
  it('shows the golden values now and the value the requester saw beside the golden value of the field', async () => {
    await show(requestView({ gold: goldRow({ fieldCurrentValue: '2.5', fieldUnit: 'MMBTU/hr' }), request: detailRow({ oldValue: '2.5', newValue: '3' }) }));
    openTab('Equipment & FLOC');
    const tab = within(panel());
    expect(tab.getByText('SYNTHETIC HEATER 0007')).toBeInTheDocument();
    expect(tab.getByText('SYN-SN-0007')).toBeInTheDocument();
    expect(tab.getByText('none yet (SAP baseline)')).toBeInTheDocument();
    expect(tab.getByText('Value the requester saw')).toBeInTheDocument();
    expect(tab.getByText('Value in the golden record now')).toBeInTheDocument();
    expect(tab.getAllByText('2.5 MMBTU/hr')).toHaveLength(2);
    expect(tab.queryByRole('alert')).toBeNull();
  });

  it('warns, in the server\'s words, when the golden value moved on since the request was raised', async () => {
    const message = 'the current value is "SYNTHETIC MFR C", the request expected "SYNTHETIC MFR A"';
    await show(requestView({ checks: checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'FAIL', message } }), gold: goldRow({ fieldCurrentValue: 'SYNTHETIC MFR C' }) }));
    openTab('Equipment & FLOC');
    const alert = within(panel()).getByRole('alert');
    expect(alert).toHaveTextContent('The golden value changed after this request was raised');
    expect(alert).toHaveTextContent(message);
    expect(within(panel()).getByText('SYNTHETIC MFR C')).toBeInTheDocument();
  });

  it('says the values are not compared once the request is closed', async () => {
    await show(requestView({ request: detailRow({ requestStatus: 'APPROVED', approvalStage: null }), checks: checkRows({ ASSOCIATION_MATCH: { checkStatus: 'NOT_CHECKED' } }) }));
    openTab('Equipment & FLOC');
    expect(within(panel()).getByText(/The request is closed, so the values are not compared/)).toBeInTheDocument();
    expect(within(panel()).queryByRole('alert')).toBeNull();
  });

  it('says so when the heater is no longer in the golden record', async () => {
    await show(requestView({ gold: null }));
    openTab('Equipment & FLOC');
    expect(within(panel()).getByText('The heater or location is no longer in the golden record.')).toBeInTheDocument();
  });

  it('lists the six approval checks in plain words with their codes, results, messages and times', async () => {
    await show(requestView({ checks: checkRows({ VALUE_ALLOWED: { checkStatus: 'FAIL', message: 'the value is not in the allowed list' }, UNITS_EXPLICIT: { checkStatus: 'NOT_CHECKED' } }) }));
    openTab('Equipment & FLOC');
    const table = within(panel()).getByRole('table', { name: 'Approval checks' });
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    const failed = within(table).getByRole('row', { name: /Proposed value is allowed/ });
    expect(within(failed).getByText('Fail')).toBeInTheDocument();
    expect(within(failed).getByText('VALUE_ALLOWED')).toBeInTheDocument();
    expect(within(failed).getByText('the value is not in the allowed list')).toBeInTheDocument();
    expect(within(table).getByText('Not checked')).toBeInTheDocument();
    expect(within(table).getAllByText('Pass')).toHaveLength(4);
    expect(within(panel()).getByText('4 passed, 1 failed, 1 not checked')).toBeInTheDocument();
    expect(within(table).getAllByText('17 Nov 2026, 14:00 UTC')).toHaveLength(6);
  });

  it('reads the checks again on "Check again", replaces the rows, and lets the decision panel follow', async () => {
    await show();
    openTab('Equipment & FLOC');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    refreshChecks.mockResolvedValue(checkRows({ VALUE_ALLOWED: { checkStatus: 'FAIL', message: 'the value is not in the allowed list for this field' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await within(panel()).findByText('the value is not in the allowed list for this field')).toBeInTheDocument();
    expect(refreshChecks).toHaveBeenCalledWith(12);
    expect(within(panel()).getByText('5 passed, 1 failed, 0 not checked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('A failed approval check blocks approval: VALUE_ALLOWED.')).toBeInTheDocument();
  });

  it('shows why the checks could not be read again', async () => {
    await show();
    openTab('Equipment & FLOC');
    refreshChecks.mockRejectedValue(new Error('Could not read the checks (229): permission denied.'));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await within(panel()).findByRole('alert')).toHaveTextContent(/could not be read again.*permission denied/);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  });
});

describe('tab "Evidence"', () => {
  it('says evidence is missing when no photo is attached, and what is built later', async () => {
    await show();
    openTab('Evidence');
    expect(within(panel()).getByText('Evidence missing')).toBeInTheDocument();
    expect(within(panel()).getByText(/APP-7/)).toBeInTheDocument();
    expect(within(panel()).getByText(/APP-9/)).toBeInTheDocument();
  });

  it('counts the photos linked to the request', async () => {
    await show(requestView({ request: detailRow({ photoCount: 3 }) }));
    openTab('Evidence');
    expect(within(panel()).getByText(/3 photos are linked to this request/)).toBeInTheDocument();
    expect(within(panel()).queryByText('Evidence missing')).toBeNull();
  });
});

describe('tab "Audit & routing"', () => {
  it('lists the history oldest first, with who, when, the comment and the status change', async () => {
    const events = [
      eventRow(3, { eventType: 'ACCOUNTABLE_APPROVED', approvalStage: 'ACCOUNTABLE', actor: 't3.accountable@example.test', actorGroup: 'SYN-ACCOUNTABLE-GROUP', comments: null, statusFrom: 'PENDING_ACCOUNTABLE', statusTo: 'APPROVED', occurredAtUtc: '2026-11-17T11:00:00.000Z' }),
      eventRow(1),
      eventRow(2, { eventType: 'RESPONSIBLE_APPROVED', approvalStage: 'RESPONSIBLE', actor: 't3.responsible@example.test', actorGroup: 'SYN-RESPONSIBLE-GROUP', comments: 'looks right', statusFrom: 'PENDING_RESPONSIBLE', statusTo: 'PENDING_ACCOUNTABLE', occurredAtUtc: '2026-11-17T10:00:00.000Z' }),
    ];
    await show(requestView({ events }));
    openTab('Audit & routing');
    const items = within(screen.getByRole('list', { name: 'Request history' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Request created');
    expect(items[1]).toHaveTextContent('Approved by the responsible stage');
    expect(items[1]).toHaveTextContent('t3.responsible@example.test');
    expect(items[1]).toHaveTextContent('SYN-RESPONSIBLE-GROUP');
    expect(items[1]).toHaveTextContent('“looks right”');
    expect(items[1]).toHaveTextContent(/Waiting for responsible approval.*Waiting for accountable approval/);
    expect(items[2]).toHaveTextContent('Approved by the accountable stage');
    expect(items[2]).toHaveTextContent('Approved');
  });

  it('shows the route applied and both groups', async () => {
    await show();
    openTab('Audit & routing');
    const tab = within(panel());
    expect(tab.getByText('SYN-RESPONSIBLE-GROUP')).toBeInTheDocument();
    expect(tab.getByText('SYN-ACCOUNTABLE-GROUP')).toBeInTheDocument();
    expect(tab.getByText(/Route 3: equipment update, any field, any class/)).toBeInTheDocument();
    expect(tab.getByText('Operations-IOC', { exact: false })).toBeInTheDocument();
    expect(tab.getByText('No decision yet')).toBeInTheDocument();
    expect(tab.getByText('Not applied yet.')).toBeInTheDocument();
  });

  it('says so when no route was recorded or its details are missing', async () => {
    await show(requestView({ request: detailRow({ routeId: null }), route: null }));
    openTab('Audit & routing');
    expect(within(panel()).getByText('No route was recorded for this request.')).toBeInTheDocument();
  });

  it('says the route details are not available when only its number is known', async () => {
    await show(requestView({ route: null }));
    openTab('Audit & routing');
    expect(within(panel()).getByText('Route 3 (its details are not available).')).toBeInTheDocument();
  });

  it('shows the last decision, the merge outcome, the golden version and the export when they exist', async () => {
    const request = detailRow({
      requestStatus: 'APPROVED',
      approvalStage: null,
      lastDecisionBy: 't3.accountable@example.test',
      lastDecisionAtUtc: '2026-11-17T11:00:00.000Z',
      mergeOutcome: 'APPLIED',
      mergedAtUtc: '2026-11-17T11:01:00.000Z',
      goldenVersionId: 5,
      exportedAtUtc: '2026-11-18T01:00:00.000Z',
      evolveBatchId: 9,
      evolveRowNumber: 2,
    });
    await show(requestView({ request }));
    openTab('Audit & routing');
    const tab = within(panel());
    expect(tab.getByText(/t3\.accountable@example\.test, 17 Nov 2026, 11:00 UTC/)).toBeInTheDocument();
    expect(tab.getByText('In the golden record.')).toBeInTheDocument();
    expect(tab.getByText(/Applied 17 Nov 2026, 11:01 UTC/)).toBeInTheDocument();
    expect(tab.getByText('Golden record version 5')).toBeInTheDocument();
    expect(tab.getByText('Exported for SAP')).toBeInTheDocument();
    expect(tab.getByText('Batch 9, row 2')).toBeInTheDocument();
  });

  it('says the update is pending when the merge failed, and that the approval stands', async () => {
    await show(requestView({ request: detailRow({ requestStatus: 'APPROVED', approvalStage: null, mergeOutcome: 'ERROR' }) }));
    openTab('Audit & routing');
    expect(within(panel()).getByText('Golden record update pending. The approval stands.')).toBeInTheDocument();
  });
});

describe('the decision panel on the page', () => {
  it('shows disabled buttons with the reason for a person who may not decide', async () => {
    const reason = 'You are not an active member of the group for this stage (SYN-RESPONSIBLE-GROUP).';
    await show(requestView({ viewer: viewer({ canDecide: false, decideBlockedReason: reason, canApprove: false, approveBlockedReason: reason }) }));
    for (const name of ['Approve', 'Reject', 'Return for correction']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('records an approval, shows the result banner and reads the request again without blanking the page', async () => {
    const after = requestView({
      request: detailRow({ requestStatus: 'PENDING_ACCOUNTABLE', approvalStage: 'ACCOUNTABLE' }),
      viewer: viewer({ canDecide: false, decideBlockedReason: 'You are not an active member of the group for this stage (SYN-ACCOUNTABLE-GROUP).', canApprove: false, approveBlockedReason: 'You are not an active member of the group for this stage (SYN-ACCOUNTABLE-GROUP).' }),
      events: [eventRow(1), eventRow(2, { eventType: 'RESPONSIBLE_APPROVED', approvalStage: 'RESPONSIBLE', actor: 't3.responsible@example.test', statusFrom: 'PENDING_RESPONSIBLE', statusTo: 'PENDING_ACCOUNTABLE' })],
    });
    fetchRequest.mockResolvedValueOnce(requestView()).mockResolvedValueOnce(after);
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'PENDING_ACCOUNTABLE', needsMerge: false, merge: null });
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('CR-000012: Approved at the responsible stage. It now waits for the accountable stage.');
    await waitFor(() => expect(fetchRequest).toHaveBeenCalledTimes(2));
    expect(fetchRequest).toHaveBeenLastCalledWith(12);
    // the new status is on the page, and the person can no longer decide at that stage
    expect(await screen.findByText('Waiting for accountable approval')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled());
    // the banner is still there after the reload
    expect(screen.getByRole('status')).toHaveTextContent('Approved at the responsible stage');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warns that the golden record update is pending when the final approval could not be merged; the approval stands', async () => {
    fetchRequest.mockResolvedValue(requestView({ request: detailRow({ requestStatus: 'PENDING_ACCOUNTABLE', approvalStage: 'ACCOUNTABLE' }), viewer: viewer({ stage: 'ACCOUNTABLE' }) }));
    decide.mockResolvedValue({
      requestRef: 'CR-000012',
      newStatus: 'APPROVED',
      needsMerge: true,
      merge: { outcome: 'ERROR', message: 'merge not yet implemented', recorded: 'COMMENTED', error: null },
    });
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Approved by both stages.');
    expect(banner).toHaveTextContent(/pending: merge not yet implemented/);
    expect(banner).toHaveTextContent(/approval stands/);
  });

  it('refuses to reject without a comment and shows the server\'s refusal inside the dialog', async () => {
    fetchRequest.mockResolvedValue(requestView());
    decide.mockRejectedValue(new Error('The request is now RETURNED, not PENDING_RESPONSIBLE: reload it and decide again.'));
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Comment (required)'), { target: { value: 'wrong maker' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/reload it and decide again/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it('withdraws a request for the requester and reads it again', async () => {
    fetchRequest
      .mockResolvedValueOnce(requestView({ viewer: viewer({ canDecide: false, decideBlockedReason: 'not yours', canApprove: false, approveBlockedReason: 'not yours', canCancel: true }) }))
      .mockResolvedValueOnce(requestView({ request: detailRow({ requestStatus: 'CANCELLED', approvalStage: null }), viewer: viewer({ canDecide: false, canApprove: false, decideBlockedReason: 'closed', approveBlockedReason: 'closed' }) }));
    withdraw.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'CANCELLED' });
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw request' }));
    expect(await screen.findByRole('status')).toHaveTextContent('CR-000012 was withdrawn');
    expect(withdraw).toHaveBeenCalledWith(12, '');
    expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull());
  });

  it('keeps the result banner and offers a retry when the refresh after a decision fails', async () => {
    fetchRequest.mockResolvedValueOnce(requestView()).mockRejectedValueOnce(new Error('connection dropped'));
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'REJECTED', needsMerge: false, merge: null });
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Comment (required)'), { target: { value: 'wrong maker' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('The request could not be refreshed')).toBeInTheDocument();
    expect(screen.getByText('connection dropped')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Rejected. The request is closed.');
    // the page is still there under the message
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('says there is no such request when it vanishes while the page is open', async () => {
    fetchRequest.mockResolvedValueOnce(requestView()).mockResolvedValueOnce(null);
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'REJECTED', needsMerge: false, merge: null });
    render(<RequestDetail idText="12" />);
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Comment (required)'), { target: { value: 'wrong maker' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('No such request')).toBeInTheDocument();
  });
});

describe('loading, errors and a request that is not there', () => {
  it('shows a loading state first', () => {
    fetchRequest.mockReturnValue(new Promise(() => undefined));
    render(<RequestDetail idText="12" />);
    expect(screen.getByRole('status', { name: 'Loading the request' })).toBeInTheDocument();
  });

  it('says there is no such request for an unknown number, with a way back', async () => {
    fetchRequest.mockResolvedValue(null);
    render(<RequestDetail idText="999999" />);
    expect(await screen.findByText('No such request')).toBeInTheDocument();
    expect(fetchRequest).toHaveBeenCalledWith(999999);
    expect(screen.getByRole('link', { name: 'Back to the approvals' })).toHaveAttribute('href', '#/approvals');
  });

  it('does not ask the server for a number that is not a request number', async () => {
    for (const bad of ['abc', '0', '1.5', '-3', '']) {
      const { unmount } = render(<RequestDetail idText={bad} />);
      expect(await screen.findByText('No such request')).toBeInTheDocument();
      unmount();
    }
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it('shows a failure with a way to try again, and shows the request after a retry', async () => {
    fetchRequest.mockRejectedValueOnce(new Error('Could not read the request (229): permission denied.')).mockResolvedValueOnce(requestView());
    render(<RequestDetail idText="12" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Manufacturer on SYN-TAG-0007' })).toBeInTheDocument();
  });
});
