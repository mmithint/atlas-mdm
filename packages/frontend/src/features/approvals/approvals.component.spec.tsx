import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchQueue, bulkApproveRequests } = vi.hoisted(() => ({ fetchQueue: vi.fn(), bulkApproveRequests: vi.fn() }));
vi.mock('./queue-api', () => ({ fetchQueue, bulkApproveRequests }));

import { Approvals } from './approvals.component';
import { bulkAnswer, queuePage, queueRow } from './queue-fixtures';

/** Rows 1 and 3 can be approved by the person; row 2 cannot (outside their group, say). */
const mixedRows = () => [queueRow(1), queueRow(2, { canApprove: false }), queueRow(3)];

const checkbox = (ref: string) => screen.getByRole('checkbox', { name: `Select ${ref}` });
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

describe('S-2 Approvals', () => {
  beforeEach(() => {
    fetchQueue.mockReset();
    bulkApproveRequests.mockReset();
    window.location.hash = '#/approvals';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('shows the six tabs with their counts, and each request as a link to its page', async () => {
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);

    expect(await screen.findByRole('link', { name: 'CR-000001' })).toHaveAttribute('href', '#/requests/1');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'My Responsible2',
      'My Accountable4',
      'Returned to me1',
      'Approved62',
      'Rejected7',
      'My Requests52',
    ]);
    expect(screen.getByRole('tab', { name: /My Responsible/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Approved/ })).toHaveAttribute('aria-selected', 'false');
    expect(fetchQueue).toHaveBeenCalledWith(expect.objectContaining({ tab: 'RESPONSIBLE', pageSize: 25 }), 0);
  });

  it('switches tab through the address and asks for that tab', async () => {
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });

    fireEvent.click(screen.getByRole('tab', { name: /My Accountable/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/approvals?tab=ACCOUNTABLE'));
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'ACCOUNTABLE' }), 0));
    expect(screen.getByRole('tab', { name: /My Accountable/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves between tabs with the arrow keys', async () => {
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });

    fireEvent.keyDown(screen.getByRole('tab', { name: /My Responsible/ }), { key: 'ArrowRight' });
    await waitFor(() => expect(window.location.hash).toBe('#/approvals?tab=ACCOUNTABLE'));
    fireEvent.keyDown(screen.getByRole('tab', { name: /My Accountable/ }), { key: 'End' });
    await waitFor(() => expect(window.location.hash).toBe('#/approvals?tab=MY_REQUESTS'));
  });

  it('keeps the counts on screen while another tab loads', async () => {
    fetchQueue.mockResolvedValueOnce(queuePage()).mockReturnValue(new Promise(() => undefined));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });

    fireEvent.click(screen.getByRole('tab', { name: /Rejected/ }));
    expect(await screen.findByRole('status', { name: 'Loading requests' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Rejected/ })).toHaveTextContent('7');
  });

  it('disables the checkbox of a request the person may not approve, and says why', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });

    expect(checkbox('CR-000001')).toBeEnabled();
    expect(checkbox('CR-000002')).toBeDisabled();
    expect(checkbox('CR-000002')).toHaveAttribute('title', expect.stringContaining('may not approve'));
    expect(checkbox('CR-000003')).toBeEnabled();
  });

  it('selects only the approvable rows with "Select all on this page", and clears them with a second click', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });
    expect(screen.getByRole('button', { name: 'Bulk approve (0)' })).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    expect(checkbox('CR-000001')).toBeChecked();
    expect(checkbox('CR-000002')).not.toBeChecked();
    expect(checkbox('CR-000003')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Bulk approve (2)' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    expect(checkbox('CR-000001')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Bulk approve (0)' })).toBeDisabled();
  });

  it('selects one row at a time too', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });
    fireEvent.click(checkbox('CR-000003'));
    expect(screen.getByRole('button', { name: 'Bulk approve (1)' })).toBeEnabled();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('offers no checkbox and no bulk button on a tab where a person does not act', async () => {
    window.location.hash = '#/approvals?tab=RETURNED';
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });
    expect(screen.queryByRole('checkbox', { name: /^Select/ })).toBeNull(); // the filter's own checkbox stays
    expect(screen.queryByRole('button', { name: /Bulk approve/ })).toBeNull();
  });

  it('approves the selection after a confirmation, lists what was skipped and why, and reloads', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    bulkApproveRequests.mockResolvedValue(
      bulkAnswer([
        { id: 1, merge: { outcome: 'ERROR', message: 'merge not yet implemented' } },
        { id: 3, reason: 'Approval is blocked by failed checks: OLD_VALUE_CURRENT.' },
      ])
    );
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk approve (2)' }));

    const confirm = screen.getByRole('dialog', { name: 'Approve 2 requests?' });
    expect(within(confirm).getByText(/checked on its own/)).toBeInTheDocument();
    fireEvent.change(within(confirm).getByLabelText(/Comment/), { target: { value: 'looks fine' } });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve 2 requests' }));

    expect(await screen.findByRole('dialog', { name: 'Bulk approval finished' })).toBeInTheDocument();
    expect(bulkApproveRequests).toHaveBeenCalledWith([1, 3], 'looks fine');
    const result = within(screen.getByRole('dialog'));
    expect(result.getByRole('status')).toHaveTextContent('1 approved, 1 skipped');
    expect(result.getByText('CR-000003')).toBeInTheDocument();
    expect(result.getByText('Approval is blocked by failed checks: OLD_VALUE_CURRENT.')).toBeInTheDocument();
    expect(result.getByText(/approved; update of the golden record pending: merge not yet implemented/)).toBeInTheDocument();

    fetchQueue.mockClear();
    fireEvent.click(result.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(fetchQueue).toHaveBeenCalledTimes(1));
    await screen.findByRole('link', { name: 'CR-000001' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(checkbox('CR-000001')).not.toBeChecked(); // the selection starts again after the reload
    expect(screen.getByRole('button', { name: 'Bulk approve (0)' })).toBeDisabled();
  });

  it('keeps the confirmation open and shows the message when the whole call fails', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    bulkApproveRequests.mockRejectedValue(new Error('Your sign-in is not linked to a person yet.'));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });
    fireEvent.click(checkbox('CR-000001'));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk approve (1)' }));

    const confirm = screen.getByRole('dialog', { name: 'Approve 1 request?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve 1 request' }));

    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Your sign-in is not linked to a person yet.');
    expect(screen.getByRole('dialog', { name: 'Approve 1 request?' })).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Approve 1 request' })).toBeEnabled();
    expect(fetchQueue).toHaveBeenCalledTimes(1); // nothing reloaded: nothing changed

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(checkbox('CR-000001')).toBeChecked(); // the selection survives a cancelled confirmation
  });

  it('cannot be dismissed while the approval is running', async () => {
    fetchQueue.mockResolvedValue(queuePage(mixedRows()));
    bulkApproveRequests.mockReturnValue(new Promise(() => undefined));
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000002' });
    fireEvent.click(checkbox('CR-000001'));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk approve (1)' }));
    const confirm = screen.getByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Approve 1 request' }));

    expect(await within(confirm).findByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a failure with a way to try again', async () => {
    fetchQueue.mockRejectedValueOnce(new Error('the function said no')).mockResolvedValueOnce(queuePage());
    render(<Approvals />);
    expect(await screen.findByRole('alert')).toHaveTextContent('the function said no');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'CR-000001' })).toBeInTheDocument();
  });

  it('explains an empty tab in its own words', async () => {
    fetchQueue.mockResolvedValue(queuePage([]));
    render(<Approvals />);
    expect(await screen.findByText('Nothing waiting for your first approval')).toBeInTheDocument();
    expect(screen.getByText(/No requests match this tab for the logged-in user\./)).toBeInTheDocument();
  });

  it('says when the filters, not the tab, hide every request, and offers to clear them', async () => {
    window.location.hash = '#/approvals?field=HEAT_DUTY';
    fetchQueue.mockResolvedValue(queuePage([]));
    render(<Approvals />);
    expect(await screen.findByText('No requests match these filters')).toBeInTheDocument();

    // The filter menu is closed, so the empty state's button is the only one; the menu's own button shows the count.
    expect(screen.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.hash).toBe('#/approvals'));
  });

  it('keeps the filters in a menu that opens from the Filters button and closes with Escape', async () => {
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });
    expect(screen.queryByLabelText('Profit centre')).toBeNull();

    const toggle = screen.getByRole('button', { name: /^Filters/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Profit centre')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByLabelText('Profit centre')).toBeNull();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByLabelText('Profit centre')).toBeNull();
  });

  it('puts every filter in the address and sends it with the next read', async () => {
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });
    openFilters();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Profit centre'), { target: { value: 'ROCKIES-DJ BASIN' } });
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ profitCenter: 'ROCKIES-DJ BASIN' }), 0));

    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'MANUFACTURER' } });
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ fieldCode: 'MANUFACTURER' }), 0));

    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'HEATER_CLASS_FIRED' } });
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ ruleId: 'HEATER_CLASS_FIRED' }), 0));

    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '72' } });
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ minAgeHours: 72 }), 0));

    fireEvent.click(screen.getByLabelText('Has a note (TBD)'));
    await waitFor(() => expect(fetchQueue).toHaveBeenLastCalledWith(expect.objectContaining({ noteOnly: true }), 0));

    const query = new URLSearchParams(window.location.hash.split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({ pc: 'ROCKIES-DJ BASIN', field: 'MANUFACTURER', rule: 'HEATER_CLASS_FIRED', age: '72', note: '1' });

    fireEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(window.location.hash).toBe('#/approvals'));
    await waitFor(() =>
      expect(fetchQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ profitCenter: '', fieldCode: '', ruleId: '', minAgeHours: 0, noteOnly: false }),
        0
      )
    );
  });

  it('starts another tab with no filter', async () => {
    window.location.hash = '#/approvals?pc=ROCKIES-DJ+BASIN&age=24';
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });

    fireEvent.click(screen.getByRole('tab', { name: /Returned to me/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/approvals?tab=RETURNED'));
  });

  it('disables the age filter on the approved and rejected tabs and never sends an age there', async () => {
    window.location.hash = '#/approvals?tab=APPROVED&age=72';
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });

    openFilters();
    const age = screen.getByLabelText('Age');
    expect(age).toBeDisabled();
    expect(age).toHaveAttribute('title', expect.stringContaining('open requests only'));
    expect(fetchQueue).toHaveBeenCalledWith(expect.objectContaining({ tab: 'APPROVED', minAgeHours: 0 }), 0);
    expect(screen.queryByRole('checkbox', { name: /^Select/ })).toBeNull(); // nothing to approve on a closed tab
  });

  it('enables the age filter where requests are open', async () => {
    window.location.hash = '#/approvals?tab=RETURNED';
    fetchQueue.mockResolvedValue(queuePage());
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });
    openFilters();
    expect(screen.getByLabelText('Age')).toBeEnabled();
  });

  it('shows the request in the client\'s terms: blanks as dashes, TBD as a badge, rule requests with the time they were detected', async () => {
    fetchQueue.mockResolvedValue(
      queuePage([
        queueRow(1, { oldValue: null, note: 'TBD', photoCount: 2, ageHours: 79 }),
        queueRow(2, {
          sourceType: 'BUSINESS_RULE',
          sourceLabel: 'Rule HEATER_CLASS_FIRED v1',
          requestedBy: 'system:rule-run',
          detectedAtUtc: '2026-11-16T08:00:00.000Z',
          note: 'check with site',
          fieldLabel: null,
          fieldCode: null,
          sapField: null,
          equipmentNumber: null,
          equipmentTagNumber: null,
          entityType: 'FLOC',
        }),
      ])
    );
    render(<Approvals />);
    await screen.findByRole('link', { name: 'CR-000001' });
    const [, first, second] = screen.getAllByRole('row');

    const a = within(first!);
    expect(a.getByText('TBD')).toBeInTheDocument();
    expect(a.getByText('SYNTHETIC MFR B')).toBeInTheDocument();
    expect(a.getAllByText('—').length).toBeGreaterThanOrEqual(1); // the blank old value
    expect(a.getByText('SAP: HERST')).toBeInTheDocument();
    expect(a.getByText('by someone@example.test')).toBeInTheDocument();
    expect(a.getByText('open 3 d')).toBeInTheDocument();
    expect(a.getByText(/photo\(s\) attached/)).toBeInTheDocument();
    expect(a.getByText('Awaiting responsible')).toBeInTheDocument();

    const b = within(second!);
    expect(b.getByText('Rule HEATER_CLASS_FIRED v1')).toBeInTheDocument();
    expect(b.queryByText(/^by /)).toBeNull();
    expect(b.getByText('Detected')).toBeInTheDocument();
    expect(b.getByText('Note: check with site')).toBeInTheDocument();
    expect(b.getByText('Location request')).toBeInTheDocument();
  });
});
