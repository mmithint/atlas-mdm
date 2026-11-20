import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSortedPage } = vi.hoisted(() => ({ fetchSortedPage: vi.fn() }));
vi.mock('./equipment-api', () => ({ fetchSortedPage }));

import { EquipmentSearch } from './equipment-search.component';
import { searchRow } from './test-fixtures';

const page = (rows = [searchRow(1), searchRow(2, { equipmentTagNumber: null, superiorFunctionalLocation: null })], hasNext = false, total = rows.length) => ({
  rows,
  hasNext,
  endCursor: hasNext ? 'C' : null,
  total,
});

const SEARCH = { name: 'Search with the column filters' };
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('S-4 Equipment search', () => {
  beforeEach(() => {
    fetchSortedPage.mockReset();
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
    // row 0 is the header, row 1 the filter boxes, row 3 is the heater without a tag and without a facility
    const blankRow = within(rows[3]!);
    expect(blankRow.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    // it can still be opened through its equipment number
    expect(blankRow.getByRole('link', { name: 'SYN-EQ-0002' })).toHaveAttribute('href', '#/equipment/2');
  });

  it('puts a filter box under every text column and none under a count, a percentage or a date', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    for (const label of ['Tag', 'Serial number', 'Equipment no.', 'Facility', 'Manufacturer', 'Class', 'Profit centre']) {
      expect(screen.getByLabelText(`Filter ${label}`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Filter Open requests')).toBeNull();
    expect(screen.queryByLabelText('Filter Verified')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('textbox')).toHaveLength(7);
  });

  it('offers a filter box in the column chooser for every text column, shown or not, and none for the others', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    for (const label of ['Tag', 'FLOC', 'Description', 'Model', 'Manufacturer']) {
      expect(screen.getByLabelText(`${label} filter value`)).toBeInTheDocument();
    }
    for (const label of ['Open requests', 'Verified', 'Heat duty (MMBTU/hr)', 'Invalid rules', 'Last changed']) {
      expect(screen.queryByLabelText(`${label} filter value`)).toBeNull();
      expect(screen.getByLabelText(label)).toBeInTheDocument(); // still a checkbox
    }
  });

  it('searches a hidden column from the chooser with Apply, without showing the column', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    type('Model filter value', ' H-100 ');
    type('Manufacturer filter value', 'heat');
    expect(window.location.hash).toBe('#/equipment'); // typing alone searches nothing
    expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('heat'); // shared with the header box

    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(window.location.hash).toBe('#/equipment?f.manufacturer=heat&f.modelNumber=H-100');
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(2));
    expect(fetchSortedPage.mock.calls[1]?.[0].filters).toEqual([
      { column: 'manufacturer', text: 'heat' },
      { column: 'modelNumber', text: 'H-100' },
    ]);
    expect(screen.queryByRole('columnheader', { name: /Model/ })).toBeNull(); // the column stays hidden
  });

  it('marks an applied filter on a hidden column in the chooser, and lets the column be shown or hidden freely', async () => {
    window.location.hash = '#/equipment?f.functionalLocation=SYN-FL';
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    expect(screen.queryByRole('columnheader', { name: /^FLOC/ })).toBeNull();
    expect(screen.getByLabelText('FLOC filter value')).toHaveValue('SYN-FL');
    const toggle = screen.getByLabelText('FLOC (filtered)');
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(screen.getByRole('columnheader', { name: /^FLOC/ })).toBeInTheDocument();
  });

  it('searches only when the search icon is pressed, with every filled box, and puts the search in the address', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(fetchSortedPage).toHaveBeenCalledTimes(1);

    type('Filter Manufacturer', ' heat ');
    type('Filter Class', 'fired');
    type('Filter Serial number', '   '); // blank: not a filter
    expect(window.location.hash).toBe('#/equipment'); // typing alone searches nothing
    expect(fetchSortedPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', SEARCH));
    expect(window.location.hash).toBe('#/equipment?f.manufacturer=heat&f.equipClass=fired');
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(2));
    expect(fetchSortedPage.mock.calls[1]?.[0].filters).toEqual([
      { column: 'manufacturer', text: 'heat' },
      { column: 'equipClass', text: 'fired' },
    ]);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('heat'); // the boxes show what is applied
  });

  it('keeps the sort when the filters change', async () => {
    window.location.hash = '#/equipment?sort=manufacturer&dir=desc';
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    type('Filter Class', 'fired');
    fireEvent.click(screen.getByRole('button', SEARCH));
    expect(window.location.hash).toBe('#/equipment?f.equipClass=fired&sort=manufacturer&dir=desc');
  });

  // The summary line ("N heaters match") is not shown at the moment (commented out in the toolbar); the pager still says which page this is.
  it('says which page this is, and how many pages there are', async () => {
    window.location.hash = '#/equipment?f.manufacturer=heat';
    fetchSortedPage.mockResolvedValue(page([searchRow(1), searchRow(2), searchRow(3)], true, 120));
    render(<EquipmentSearch />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('shows the filters of the address in the boxes, and keeps a hidden column hidden', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.queryByRole('columnheader', { name: /^FLOC/ })).toBeNull();

    window.location.hash = '#/equipment?f.manufacturer=heat&f.functionalLocation=SYN-FL';
    await waitFor(() => expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('heat'));
    expect(screen.getByLabelText('FLOC filter value')).toHaveValue('SYN-FL');
    expect(screen.queryByRole('columnheader', { name: /^FLOC/ })).toBeNull();
  });

  it('clears all the filters, the boxes and the address', async () => {
    window.location.hash = '#/equipment?f.manufacturer=heat&f.equipClass=fired&sort=manufacturer';
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('heat');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(window.location.hash).toBe('#/equipment?sort=manufacturer');
    await waitFor(() => expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue(''));
    expect(screen.getByLabelText('Filter Class')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('offers to clear text that was typed but not searched yet, and empties the boxes', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();

    type('Filter Manufacturer', 'heat');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('');
    expect(window.location.hash).toBe('#/equipment');
    expect(fetchSortedPage).toHaveBeenCalledTimes(1);
  });

  it('lists every heater of a facility and offers a way back to all of them, keeping the filters', async () => {
    window.location.hash = '#/equipment?facility=SYN-FL-AREA-01';
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(fetchSortedPage).toHaveBeenCalledWith(expect.objectContaining({ facility: 'SYN-FL-AREA-01' }), null);
    expect(screen.getByRole('link', { name: /Show all facilities/ })).toHaveAttribute('href', '#/equipment');

    window.location.hash = '#/equipment?f.manufacturer=heat&facility=SYN-FL-AREA-01';
    await waitFor(() => expect(screen.getByRole('link', { name: /Show all facilities/ })).toHaveAttribute('href', '#/equipment?f.manufacturer=heat'));
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
    expect(screen.getByLabelText('Filter Model')).toBeInTheDocument(); // a newly shown text column gets its box
    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.queryByRole('columnheader', { name: /Model/ })).toBeNull();
  });

  it('keeps the filter boxes while it searches, so a filter can be changed at once', async () => {
    fetchSortedPage.mockReturnValue(new Promise(() => undefined)); // never answers
    render(<EquipmentSearch />);
    expect(await screen.findByLabelText('Filter Manufacturer')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument();
  });

  it('explains an empty result in words, and keeps the boxes', async () => {
    window.location.hash = '#/equipment?f.manufacturer=nothing&f.equipClass=x';
    fetchSortedPage.mockResolvedValue(page([], false, 0));
    render(<EquipmentSearch />);
    expect(await screen.findByText('No heater found')).toBeInTheDocument();
    expect(screen.getByText(/Nothing matches Manufacturer contains "nothing" and Class contains "x"/)).toBeInTheDocument();
    expect(screen.getByLabelText('Filter Manufacturer')).toHaveValue('nothing');
  });

  it('shows a failure with a way to try again, and keeps the boxes', async () => {
    fetchSortedPage.mockRejectedValueOnce(new Error('connector said no')).mockResolvedValueOnce(page());
    render(<EquipmentSearch />);
    expect(await screen.findByRole('alert')).toHaveTextContent('connector said no');
    expect(screen.getByLabelText('Filter Manufacturer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'SYN-TAG-0001' })).toBeInTheDocument();
  });

  it('pages forward and back', async () => {
    fetchSortedPage.mockResolvedValue(page([searchRow(1)], true, 120));
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(fetchSortedPage).toHaveBeenCalledTimes(2));
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.anything(), 'C');
  });
});
