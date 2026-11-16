import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSortedPage, fetchBestMatches } = vi.hoisted(() => ({
  fetchSortedPage: vi.fn(),
  fetchBestMatches: vi.fn(),
}));
vi.mock('./equipment-api', () => ({ fetchSortedPage, fetchBestMatches }));

import { EquipmentSearch } from './equipment-search.component';
import { searchRow } from './test-fixtures';

const page = (rows = [searchRow(1), searchRow(2, { equipmentTagNumber: null, superiorFunctionalLocation: null })], hasNext = false) => ({
  rows,
  hasNext,
  endCursor: hasNext ? 'C' : null,
});

describe('S-4 Equipment search', () => {
  beforeEach(() => {
    fetchSortedPage.mockReset();
    fetchBestMatches.mockReset();
    window.location.hash = '#/equipment';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('lists heaters with the tag as a link to the detail page and a facility link', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);

    const tag = await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(tag).toHaveAttribute('href', '#/equipment/1');
    const facility = screen.getAllByRole('link', { name: 'SYN-FL-AREA-01' })[0];
    expect(facility).toHaveAttribute('href', '#/equipment?facility=SYN-FL-AREA-01');
  });

  it('shows a blank as a dash, never as zero or empty', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    const rows = screen.getAllByRole('row');
    // row 0 is the header; row 2 is the heater without a tag and without a facility
    const blankRow = within(rows[2]!);
    expect(blankRow.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // it can still be opened through its equipment number
    expect(blankRow.getByRole('link', { name: 'SYN-EQ-0002' })).toHaveAttribute('href', '#/equipment/2');
  });

  it('searches in the chosen field and puts the search in the address', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    fireEvent.change(screen.getByLabelText('Search in'), { target: { value: 'serial' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'SYN-SN-0004' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(window.location.hash).toBe('#/equipment?field=serial&q=SYN-SN-0004');
  });

  it('shows closest matches first and says how many were found', async () => {
    window.location.hash = '#/equipment?q=SYN';
    fetchBestMatches.mockResolvedValue({ rows: [searchRow(1), searchRow(2), searchRow(3)], truncated: false });
    render(<EquipmentSearch />);
    expect(await screen.findByText(/closest first/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(fetchBestMatches).toHaveBeenCalledTimes(1);
  });

  it('warns when there may be more matches than were fetched', async () => {
    window.location.hash = '#/equipment?q=S';
    fetchBestMatches.mockResolvedValue({ rows: [searchRow(1)], truncated: true });
    render(<EquipmentSearch />);
    expect(await screen.findByText(/more exist/)).toBeInTheDocument();
  });

  it('lists every heater of a facility and offers a way back to all of them', async () => {
    window.location.hash = '#/equipment?facility=SYN-FL-AREA-01';
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(fetchSortedPage).toHaveBeenCalledWith(expect.objectContaining({ facility: 'SYN-FL-AREA-01' }), null);
    const back = screen.getByRole('link', { name: /Show all facilities/ });
    expect(back).toHaveAttribute('href', '#/equipment');
  });

  it('sorts by a column when its header is clicked, and the other way on a second click', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    fireEvent.click(screen.getByRole('button', { name: /^Manufacturer/ }));
    expect(window.location.hash).toBe('#/equipment?sort=manufacturer');
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Manufacturer/ })).toHaveAttribute('aria-sort', 'ascending'));

    fireEvent.click(screen.getByRole('button', { name: /^Manufacturer/ }));
    expect(window.location.hash).toBe('#/equipment?sort=manufacturer&dir=desc');
  });

  it('lets the person choose columns, but never none', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.queryByRole('columnheader', { name: /Model/ })).toBeNull();

    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.getByRole('columnheader', { name: /Model/ })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.queryByRole('columnheader', { name: /Model/ })).toBeNull();
  });

  it('always shows the column that is being searched, even when it is not a default column', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.queryByRole('columnheader', { name: /^FLOC/ })).toBeNull();

    window.location.hash = '#/equipment?field=floc&sort=equipmentNumber';
    expect(await screen.findByRole('columnheader', { name: /^FLOC/ })).toBeInTheDocument();
    expect(screen.getByLabelText('FLOC (searched)')).toBeDisabled(); // locked on in the column chooser
  });

  it('explains an empty result in words', async () => {
    window.location.hash = '#/equipment?q=nothing';
    fetchBestMatches.mockResolvedValue({ rows: [], truncated: false });
    render(<EquipmentSearch />);
    expect(await screen.findByText('No heater found')).toBeInTheDocument();
    expect(screen.getByText(/Nothing matches "nothing" in engineering tag/)).toBeInTheDocument();
  });

  it('shows a failure with a way to try again', async () => {
    fetchSortedPage.mockRejectedValueOnce(new Error('connector said no')).mockResolvedValueOnce(page());
    render(<EquipmentSearch />);
    expect(await screen.findByRole('alert')).toHaveTextContent('connector said no');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'SYN-TAG-0001' })).toBeInTheDocument();
  });

  it('pages forward and back', async () => {
    fetchSortedPage.mockResolvedValue(page([searchRow(1)], true));
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(2));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.anything(), 'C');
  });
});
