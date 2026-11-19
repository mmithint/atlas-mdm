import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchEquipmentRequests } = vi.hoisted(() => ({ fetchEquipmentRequests: vi.fn() }));
vi.mock('./change-request-api', () => ({ fetchEquipmentRequests }));

import { EquipmentRequests } from './equipment-requests.component';
import { requestRow } from './test-fixtures';

describe('S-5 Requests on this heater', () => {
  beforeEach(() => {
    fetchEquipmentRequests.mockReset();
  });

  it('lists the requests with a link, the field, the status in words, the source and the time', async () => {
    fetchEquipmentRequests.mockResolvedValue({
      totalCount: 2,
      rows: [
        requestRow(5),
        requestRow(3, { requestStatus: 'APPROVED', isOpen: false, fieldLabel: 'Heat duty (MMBTU/hr)', sourceLabel: 'Rule HEATER_DUTY v1' }),
      ],
    });
    render(<EquipmentRequests equipmentId={1} reloadKey={0} />);

    const table = await screen.findByRole('table', { name: 'Change requests on this heater' });
    expect(fetchEquipmentRequests).toHaveBeenCalledWith(1);
    const first = within(table).getByRole('row', { name: /CR-000005/ });
    expect(within(first).getByRole('link', { name: 'CR-000005' })).toHaveAttribute('href', '#/requests/5');
    expect(within(first).getByText('Manufacturer')).toBeInTheDocument();
    expect(within(first).getByText('Waiting for the responsible stage')).toBeInTheDocument();
    expect(within(first).getByText('Manual request')).toBeInTheDocument();
    expect(within(first).getByText(/17 Nov 2026/)).toBeInTheDocument();
    const second = within(table).getByRole('row', { name: /CR-000003/ });
    expect(within(second).getByText('Approved')).toBeInTheDocument();
    expect(within(second).getByText('Rule HEATER_DUTY v1')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('flags a request that overlaps another open one on the same field, and a request about the location', async () => {
    fetchEquipmentRequests.mockResolvedValue({
      totalCount: 2,
      rows: [requestRow(5, { otherOpenRequestsSameField: 1 }), requestRow(6, { equipmentId: null, fieldLabel: 'FLOC class' })],
    });
    render(<EquipmentRequests equipmentId={1} reloadKey={0} />);
    const overlapping = await screen.findByRole('row', { name: /CR-000005/ });
    expect(within(overlapping).getByText('overlaps another open request')).toBeInTheDocument();
    const location = screen.getByRole('row', { name: /CR-000006/ });
    expect(within(location).getByText('location')).toBeInTheDocument();
    expect(within(location).queryByText('overlaps another open request')).toBeNull();
  });

  it('says how many are shown when there are more', async () => {
    fetchEquipmentRequests.mockResolvedValue({ totalCount: 130, rows: [requestRow(1), requestRow(2)] });
    render(<EquipmentRequests equipmentId={1} reloadKey={0} />);
    expect(await screen.findByText('Showing 2 of 130 requests (the newest, open ones first).')).toBeInTheDocument();
  });

  it('has an honest empty state', async () => {
    fetchEquipmentRequests.mockResolvedValue({ totalCount: 0, rows: [] });
    render(<EquipmentRequests equipmentId={1} reloadKey={0} />);
    expect(await screen.findByText('No requests yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a failure with a way to try again, inside the section', async () => {
    fetchEquipmentRequests.mockRejectedValueOnce(new Error('the read failed'));
    render(<EquipmentRequests equipmentId={1} reloadKey={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('the read failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requests on this heater' })).toBeInTheDocument();
  });

  it('reads again when reloadKey changes (a request was just created)', async () => {
    fetchEquipmentRequests.mockResolvedValueOnce({ totalCount: 0, rows: [] });
    const { rerender } = render(<EquipmentRequests equipmentId={1} reloadKey={0} />);
    await screen.findByText('No requests yet');

    fetchEquipmentRequests.mockResolvedValueOnce({ totalCount: 1, rows: [requestRow(8)] });
    rerender(<EquipmentRequests equipmentId={1} reloadKey={1} />);
    expect(await screen.findByRole('link', { name: 'CR-000008' })).toBeInTheDocument();
    expect(fetchEquipmentRequests).toHaveBeenCalledTimes(2);
  });
});
