import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { decide, withdraw } = vi.hoisted(() => ({ decide: vi.fn(), withdraw: vi.fn() }));
vi.mock('./request-api', () => ({ decide, withdraw }));

import { DecisionPanel, type DecisionPanelProps } from './decision-panel.component';
import { checkRows, detailRow, returnCandidates, viewer } from './request-fixtures';

const onDone = vi.fn();

function renderPanel(over: Partial<DecisionPanelProps> = {}) {
  return render(<DecisionPanel request={detailRow()} viewer={viewer()} checks={checkRows()} onDone={onDone} {...over} />);
}

const dialog = () => screen.getByRole('dialog');
const approved = { requestRef: 'CR-000012', newStatus: 'PENDING_ACCOUNTABLE', needsMerge: false, merge: null };

beforeEach(() => {
  decide.mockReset();
  withdraw.mockReset();
  onDone.mockReset();
});

describe('which buttons are on', () => {
  it('switches Approve, Reject and Return on for a person who may decide and approve, with nothing to explain', () => {
    renderPanel();
    for (const name of ['Approve', 'Reject', 'Return for correction']) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
    expect(screen.queryByText(/are off|is off/)).toBeNull();
  });

  it('switches all three off and says why, once, for a person who may not decide', () => {
    const reason = 'You are not an active member of the group for this stage (SYN-RESPONSIBLE-GROUP).';
    renderPanel({ viewer: viewer({ canDecide: false, decideBlockedReason: reason, canApprove: false, approveBlockedReason: reason }) });
    for (const name of ['Approve', 'Reject', 'Return for correction']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getAllByText(reason)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAccessibleDescription(/not an active member/);
    expect(screen.getByRole('button', { name: 'Reject' })).toHaveAccessibleDescription(/not an active member/);
  });

  it('keeps Reject and Return on when only Approve is stopped by the server, and says so next to Approve', () => {
    const segregation = 'A sentence the server gives for Approve only.';
    renderPanel({ viewer: viewer({ canApprove: false, approveBlockedReason: segregation }) });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Return for correction' })).toBeEnabled();
    expect(screen.getByText(segregation)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveAccessibleDescription(`Approve is off: ${segregation}`);
    expect(screen.queryByText(/Reject and Return are off/)).toBeNull();
  });

  it('shows two different reasons separately when both differ', () => {
    renderPanel({
      viewer: viewer({ canDecide: false, decideBlockedReason: 'The request is APPROVED; only a request that waits for a decision can be decided.', canApprove: false, approveBlockedReason: 'A different sentence.' }),
    });
    expect(screen.getByText('A different sentence.')).toBeInTheDocument();
    expect(screen.getByText(/The request is APPROVED/)).toBeInTheDocument();
  });

  it('falls back to the decide reason, then to a plain sentence, when the server gave no approve reason', () => {
    renderPanel({ viewer: viewer({ canDecide: false, decideBlockedReason: 'Closed.', canApprove: false, approveBlockedReason: null }) });
    expect(screen.getAllByText('Closed.')).toHaveLength(1);
  });

  it('switches Approve off with the failed checks named, and keeps Reject and Return on', () => {
    renderPanel({ checks: checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'FAIL' }, VALUE_ALLOWED: { checkStatus: 'FAIL' } }) });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByText('A failed approval check blocks approval: OLD_VALUE_CURRENT, VALUE_ALLOWED.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Return for correction' })).toBeEnabled();
  });

  it('lets the server\'s reason win over the failed-check explanation', () => {
    renderPanel({
      viewer: viewer({ canApprove: false, approveBlockedReason: 'A sentence the server gives for Approve only.' }),
      checks: checkRows({ OLD_VALUE_CURRENT: { checkStatus: 'FAIL' } }),
    });
    expect(screen.getByText('A sentence the server gives for Approve only.')).toBeInTheDocument();
    expect(screen.queryByText(/failed approval check/)).toBeNull();
  });

  it('says so when the person decides as an admin, naming the group they are not in', () => {
    renderPanel({ viewer: viewer({ decidedAs: 'ADMIN' }) });
    expect(screen.getByText(/as an admin: you are not a member of\s+SYN-RESPONSIBLE-GROUP/)).toBeInTheDocument();
  });

  it('says nothing about admins to a group member', () => {
    renderPanel();
    expect(screen.queryByText(/as an admin/)).toBeNull();
  });

  it('shows Withdraw only to a person who may withdraw', () => {
    renderPanel({ viewer: viewer({ canCancel: true }) });
    expect(screen.getByRole('button', { name: 'Withdraw request' })).toBeEnabled();
  });
});

describe('Approve', () => {
  it('says the request goes to the accountable group at the responsible stage, and the comment is optional', async () => {
    decide.mockResolvedValue(approved);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(within(dialog()).getByText(/goes to SYN-ACCOUNTABLE-GROUP for the second approval/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText('Comment (optional)')).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // the status the screen showed goes with the call, so a stale page cannot decide a moved request
    expect(decide).toHaveBeenCalledWith(12, 'APPROVE', '', 'PENDING_RESPONSIBLE', '');
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ tone: 'success', title: expect.stringContaining('CR-000012: Approved at the responsible stage') });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says it is the final approval at the accountable stage', () => {
    renderPanel({ request: detailRow({ requestStatus: 'PENDING_ACCOUNTABLE', approvalStage: 'ACCOUNTABLE' }), viewer: viewer({ stage: 'ACCOUNTABLE' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(within(dialog()).getByText(/final approval.*golden record is updated/)).toBeInTheDocument();
  });

  it('sends the comment when there is one, trimmed', async () => {
    decide.mockResolvedValue(approved);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(within(dialog()).getByLabelText('Comment (optional)'), { target: { value: '  checked the nameplate  ' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(12, 'APPROVE', 'checked the nameplate', 'PENDING_RESPONSIBLE', ''));
  });

  it('turns the banner into a warning when the golden record update is pending; the approval stands', async () => {
    decide.mockResolvedValue({
      requestRef: 'CR-000012',
      newStatus: 'APPROVED',
      needsMerge: true,
      merge: { outcome: 'ERROR', message: 'merge not yet implemented', recorded: 'COMMENTED', error: null },
    });
    renderPanel({ request: detailRow({ requestStatus: 'PENDING_ACCOUNTABLE', approvalStage: 'ACCOUNTABLE' }), viewer: viewer({ stage: 'ACCOUNTABLE' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const banner = onDone.mock.calls[0]?.[0];
    expect(banner.tone).toBe('warning');
    expect(banner.detail).toMatch(/pending: merge not yet implemented/);
    expect(banner.detail).toMatch(/approval stands/);
  });
});

describe('Reject and Return', () => {
  it('needs a comment to reject: the button stays off for empty and for blank text', async () => {
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'REJECTED', needsMerge: false, merge: null });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const confirm = within(dialog()).getByRole('button', { name: 'Reject' });
    expect(within(dialog()).getByText(/closes the request/)).toBeInTheDocument();
    expect(within(dialog()).getByLabelText('Comment (required)')).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog()).getByLabelText('Comment (required)'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    expect(decide).not.toHaveBeenCalled();

    fireEvent.change(within(dialog()).getByLabelText('Comment (required)'), { target: { value: 'wrong maker' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledWith(12, 'REJECT', 'wrong maker', 'PENDING_RESPONSIBLE', ''));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0]?.[0].title).toBe('CR-000012: Rejected. The request is closed.');
  });

  it('needs a comment to return; with no candidates it names the default recipient and offers no picker', async () => {
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'RETURNED', needsMerge: false, merge: null });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(within(dialog()).getByText(/returned to T3 requester \(person\)/)).toBeInTheDocument();
    expect(within(dialog()).queryByRole('combobox')).toBeNull();
    const confirm = within(dialog()).getByRole('button', { name: 'Return for correction' });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog()).getByLabelText('Comment (required)'), { target: { value: 'please re-check the serial' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(decide).toHaveBeenCalledWith(12, 'RETURN', 'please re-check the serial', 'PENDING_RESPONSIBLE', ''));
  });

  it("offers the server's candidates, default first, and sends the person picked (yourself included)", async () => {
    decide.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'RETURNED', needsMerge: false, merge: null });
    renderPanel({ returnCandidates: returnCandidates() });
    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    const picker = within(dialog()).getByLabelText('Return to');
    const options = within(picker).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'T3 requester (person) (default)',
      'T3 requester (raised it)',
      'T3 responsible (responsible group, you)',
      'T3 accountable (accountable group)',
    ]);
    expect(picker).toHaveValue('');

    fireEvent.change(picker, { target: { value: 't3.accountable@example.test' } });
    expect(within(dialog()).getByText(/returned to T3 accountable \(accountable group\)/)).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByLabelText('Comment (required)'), { target: { value: 'please check the nameplate' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Return for correction' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(12, 'RETURN', 'please check the nameplate', 'PENDING_RESPONSIBLE', 't3.accountable@example.test')
    );
  });

  it('does not show the picker for Reject, and forgets the pick when a dialog is opened again', () => {
    renderPanel({ returnCandidates: returnCandidates() });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(within(dialog()).queryByLabelText('Return to')).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    fireEvent.change(within(dialog()).getByLabelText('Return to'), { target: { value: 't3.responsible@example.test' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(within(dialog()).getByLabelText('Return to')).toHaveValue('');
  });

  it('says a group when the return goes to a group, and a plain phrase when the server named nobody', () => {
    const { unmount } = renderPanel({ viewer: viewer({ returnToType: 'GROUP', returnTo: 'SYN-EDITORS', returnToLabel: null }) });
    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(within(dialog()).getByText(/returned to SYN-EDITORS \(group\)/)).toBeInTheDocument();
    unmount();

    renderPanel({ viewer: viewer({ returnToType: null, returnTo: null, returnToLabel: null }) });
    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(within(dialog()).getByText(/returned to the person or group that raised it/)).toBeInTheDocument();
  });
});

describe('when the server says no', () => {
  it('shows a refusal in the dialog, keeps it open and does not report success', async () => {
    decide.mockRejectedValue(new Error('The request is now PENDING_ACCOUNTABLE, not PENDING_RESPONSIBLE: reload it and decide again.'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/reload it and decide again/);
    expect(onDone).not.toHaveBeenCalled();
    // the buttons are usable again, so the person can close the dialog or try once more
    expect(within(dialog()).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('closes with Cancel and with Escape without asking the server anything', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it('starts every dialog with an empty comment and no leftover error', async () => {
    decide.mockRejectedValue(new Error('no'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(dialog()).getByLabelText('Comment (required)'), { target: { value: 'because' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reject' }));
    await within(dialog()).findByRole('alert');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(within(dialog()).getByLabelText('Comment (required)')).toHaveValue('');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });
});

describe('Withdraw', () => {
  it('asks for confirmation, sends the optional comment and reports it', async () => {
    withdraw.mockResolvedValue({ requestRef: 'CR-000012', newStatus: 'CANCELLED' });
    renderPanel({ viewer: viewer({ canCancel: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    expect(within(dialog()).getByText(/closes the request.*stays in the history/)).toBeInTheDocument();
    fireEvent.change(within(dialog()).getByLabelText('Comment (optional)'), { target: { value: 'raised by mistake' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(12, 'raised by mistake'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0]?.[0].title).toMatch(/CR-000012 was withdrawn/);
    expect(decide).not.toHaveBeenCalled();
  });

  it('shows a refused withdrawal in the dialog', async () => {
    withdraw.mockRejectedValue(new Error('Only the person who raised the request, or an admin, may withdraw it.'));
    renderPanel({ viewer: viewer({ canCancel: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Withdraw request' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/Only the person who raised/);
    expect(onDone).not.toHaveBeenCalled();
  });
});
