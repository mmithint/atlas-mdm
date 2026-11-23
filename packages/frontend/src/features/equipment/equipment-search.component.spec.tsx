import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchSortedPage, listSavedViews, saveView, deleteSavedView } = vi.hoisted(() => ({
  fetchSortedPage: vi.fn(),
  listSavedViews: vi.fn(),
  saveView: vi.fn(),
  deleteSavedView: vi.fn(),
}));
vi.mock('./equipment-api', () => ({ fetchSortedPage }));
vi.mock('./saved-views-api', () => ({ listSavedViews, saveView, deleteSavedView }));

import { EquipmentSearch } from './equipment-search.component';
import { definitionOf } from './saved-view-model';
import { criteriaFromQuery } from './search-model';
import { searchRow } from './test-fixtures';

const page = (rows = [searchRow(1), searchRow(2, { equipmentTagNumber: null, superiorFunctionalLocation: null })], hasNext = false, total = rows.length) => ({
  rows,
  hasNext,
  endCursor: hasNext ? 'C' : null,
  total,
});

const SEARCH = { name: 'Open equipment search' };

/**
 * The table's own page reads. The metric cards also read every row of the search, 100 at a time
 * (use-filtered-search.ts), so those calls are left out here.
 */
const pageCalls = () => fetchSortedPage.mock.calls.filter((c) => c[0].pageSize !== 100);
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
    expect(tag).toHaveClass('rounded-lg', 'border-info-border', 'bg-info');
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
    await waitFor(() => expect(pageCalls()).toHaveLength(2));
    expect(pageCalls()[1]?.[0].filters).toEqual([
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

  it('turns the search icon into a working tag search input', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    fireEvent.click(screen.getByRole('button', SEARCH));
    const field = screen.getByRole('searchbox', { name: 'Search equipment tags' });
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('type', 'text');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Clear and close equipment search' })).toHaveLength(1);
    fireEvent.change(field, { target: { value: ' SYN-TAG-0007 ' } });
    fireEvent.submit(screen.getByRole('search'));

    expect(window.location.hash).toBe('#/equipment?q=SYN-TAG-0007');
    await waitFor(() => expect(pageCalls()).toHaveLength(2));
    expect(pageCalls()[1]?.[0].searchText).toBe('SYN-TAG-0007');

    fireEvent.click(screen.getByRole('button', { name: 'Clear and close equipment search' }));
    expect(window.location.hash).toBe('#/equipment');
    await waitFor(() => expect(screen.getByRole('button', SEARCH)).toBeInTheDocument());
  });

  it('searches only when the search icon is pressed, with every filled box, and puts the search in the address', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    expect(pageCalls()).toHaveLength(1);

    type('Filter Manufacturer', ' heat ');
    type('Filter Class', 'fired');
    type('Filter Serial number', '   '); // blank: not a filter
    expect(window.location.hash).toBe('#/equipment'); // typing alone searches nothing
    expect(pageCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', SEARCH));
    expect(window.location.hash).toBe('#/equipment?f.manufacturer=heat&f.equipClass=fired');
    await waitFor(() => expect(pageCalls()).toHaveLength(2));
    expect(pageCalls()[1]?.[0].filters).toEqual([
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

  it('lets the person select every column at once', async () => {
    fetchSortedPage.mockResolvedValue(page());
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });

    const selectAll = screen.getByRole('button', { name: 'Select all' });
    expect(selectAll).toBeEnabled();
    fireEvent.click(selectAll);

    expect(screen.getByLabelText('FLOC')).toBeChecked();
    expect(screen.getByLabelText('Model')).toBeChecked();
    expect(screen.getByLabelText('Last changed')).toBeChecked();
    expect(selectAll).toBeDisabled();
    expect(screen.getByText('25 of 25 shown')).toBeInTheDocument();
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
    // Only the table's first read fails; the metric cards' read and the retry work.
    let failed = false;
    fetchSortedPage.mockImplementation(async (c: { pageSize: number }) => {
      if (c.pageSize !== 100 && !failed) {
        failed = true;
        throw new Error('connector said no');
      }
      return page();
    });
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
    await waitFor(() => expect(pageCalls()).toHaveLength(2));
    expect(pageCalls()[1]?.[1]).toBe('C');
  });
});

describe('S-4 Equipment search, the Filter panel', () => {
  const rows = [
    searchRow(1, { manufacturer: 'Demo Thermal Inc.', equipClass: 'HEATER', verificationPct: 20 }),
    searchRow(2, { manufacturer: 'Example Heater Co.', equipClass: 'LINE_HEATER', verificationPct: 80 }),
    searchRow(3, { manufacturer: 'Demo Thermal Inc.', equipClass: 'LINE_HEATER', verificationPct: 100 }),
  ];

  beforeEach(() => {
    fetchSortedPage.mockReset();
    fetchSortedPage.mockResolvedValue(page(rows));
    listSavedViews.mockReset().mockResolvedValue([]);
    saveView.mockReset();
    deleteSavedView.mockReset();
    window.location.hash = '#/equipment';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  const openPanel = async () => {
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    await within(panel).findByRole('list', { name: 'Manufacturer' });
    return panel;
  };
  const tags = () => screen.queryAllByRole('link', { name: /^SYN-TAG-/ }).map((a) => a.textContent);
  const box = (panel: HTMLElement, list: string, option: RegExp) => within(within(panel).getByRole('list', { name: list })).getByRole('checkbox', { name: option });

  it('opens from the toolbar and lists every value of a field as a checkbox, with its count', async () => {
    const panel = await openPanel();
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'true');
    expect(box(panel, 'Manufacturer', /^Demo Thermal Inc\. \(2\)$/)).not.toBeChecked();
    expect(box(panel, 'Manufacturer', /^Example Heater Co\. \(1\)$/)).toBeInTheDocument();
    // every matching row was read at once, in the list's own order
    expect(fetchSortedPage).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null, pageSize: 100 }), null);
  });

  it('filters the table as soon as a value is ticked, and shows the count on the button', async () => {
    const panel = await openPanel();
    fireEvent.click(box(panel, 'Manufacturer', /^Demo Thermal Inc\./));
    await waitFor(() => expect(tags()).toEqual(['SYN-TAG-0001', 'SYN-TAG-0003']));
    expect(screen.getByRole('button', { name: 'Filter, 1 selected' })).toBeInTheDocument();
  });

  it('widens with a second value of the same field and narrows with another field', async () => {
    const panel = await openPanel();
    fireEvent.click(box(panel, 'Manufacturer', /^Demo Thermal Inc\./));
    fireEvent.click(box(panel, 'Manufacturer', /^Example Heater Co\./));
    await waitFor(() => expect(tags()).toHaveLength(3));
    fireEvent.click(box(panel, 'Class', /^LINE_HEATER/));
    await waitFor(() => expect(tags()).toEqual(['SYN-TAG-0002', 'SYN-TAG-0003']));
    expect(screen.getByRole('button', { name: 'Filter, 3 selected' })).toBeInTheDocument();
  });

  it('offers numbers as ranges', async () => {
    const panel = await openPanel();
    fireEvent.click(box(panel, 'Verified', /^100%/));
    await waitFor(() => expect(tags()).toEqual(['SYN-TAG-0003']));
  });

  it('clears every ticked value at once', async () => {
    const panel = await openPanel();
    fireEvent.click(box(panel, 'Manufacturer', /^Example Heater Co\./));
    await waitFor(() => expect(tags()).toEqual(['SYN-TAG-0002']));
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(tags()).toHaveLength(3));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('gives a long list a search box', async () => {
    fetchSortedPage.mockResolvedValue(page(Array.from({ length: 10 }, (_, i) => searchRow(i + 1, { manufacturer: `Maker ${i + 1}` }))));
    const panel = await openPanel();
    fireEvent.change(within(panel).getByRole('searchbox', { name: 'Search Manufacturer' }), { target: { value: 'maker 1' } });
    const shown = within(within(panel).getByRole('list', { name: 'Manufacturer' })).getAllByRole('checkbox');
    expect(shown.map((c) => c.getAttribute('aria-label'))).toEqual(['Maker 1 (1)', 'Maker 10 (1)']);
  });

  it('refuses to read more heaters than it can filter, and says how to narrow the search', async () => {
    fetchSortedPage.mockResolvedValue(page(rows, true, 5000));
    render(<EquipmentSearch />);
    await screen.findByRole('link', { name: 'SYN-TAG-0001' });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(await screen.findByText('Too many heaters to filter')).toBeInTheDocument();
  });

  it('closes with Escape and gives focus back to the Filter button', async () => {
    const panel = await openPanel();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveFocus();
  });

  describe('saved filters', () => {
    const saved = {
      savedViewId: 3,
      viewName: 'Line heaters by Demo',
      definitionJson: definitionOf({
        criteria: criteriaFromQuery(new URLSearchParams('f.manufacturer=demo&size=25')),
        selection: { equipClass: ['LINE_HEATER'] },
        columns: ['equipmentTagNumber', 'manufacturer', 'equipClass'],
      }),
      isDefault: false,
      updatedAtUtc: '2026-11-23T10:00:00.000Z',
    };

    it('lists them at the top of the panel, and choosing one puts the whole view back', async () => {
      listSavedViews.mockResolvedValue([saved]);
      const panel = await openPanel();
      const select = within(panel).getByRole('combobox', { name: 'Saved filters' });
      await waitFor(() => expect(select).toBeEnabled());
      fireEvent.change(select, { target: { value: '3' } });

      await waitFor(() => expect(window.location.hash).toContain('f.manufacturer=demo'));
      expect(window.location.hash).toContain('size=25');
      expect(screen.getByRole('button', { name: 'Filter, 1 selected' })).toBeInTheDocument();
      expect(screen.queryByRole('columnheader', { name: /Profit centre/ })).toBeNull();
    });

    it('saves the current view under a name', async () => {
      saveView.mockImplementation(async (name: string, definitionJson: string) => ({
        view: { ...saved, savedViewId: 9, viewName: name, definitionJson },
        replaced: false,
      }));
      const panel = await openPanel();
      fireEvent.click(box(panel, 'Class', /^LINE_HEATER/));
      fireEvent.click(within(panel).getByRole('button', { name: 'Save the current filters' }));
      fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'My line heaters' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Save filter' }));

      expect(await within(panel).findByText('Saved “My line heaters”.')).toBeInTheDocument();
      expect(saveView).toHaveBeenCalledWith('My line heaters', expect.stringContaining('"equipClass":["LINE_HEATER"]'));
      expect(within(panel).getByRole('combobox', { name: 'Saved filters' })).toHaveValue('9');
    });

    it('asks before deleting one, by name', async () => {
      listSavedViews.mockResolvedValue([saved]);
      deleteSavedView.mockResolvedValue(undefined);
      const panel = await openPanel();
      const select = within(panel).getByRole('combobox', { name: 'Saved filters' });
      await waitFor(() => expect(select).toBeEnabled());
      fireEvent.change(select, { target: { value: '3' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Delete the saved filter “Line heaters by Demo”' }));
      expect(deleteSavedView).not.toHaveBeenCalled();
      fireEvent.click(within(panel).getByRole('button', { name: 'Delete “Line heaters by Demo”' }));

      expect(await within(panel).findByText('Deleted “Line heaters by Demo”.')).toBeInTheDocument();
      expect(deleteSavedView).toHaveBeenCalledWith(3);
      expect(within(panel).queryByRole('option', { name: 'Line heaters by Demo' })).toBeNull();
    });

    it('says when they cannot be read, and offers to try again', async () => {
      listSavedViews.mockRejectedValueOnce(new Error('Could not read your saved filters.')).mockResolvedValueOnce([saved]);
      const panel = await openPanel();
      expect(await within(panel).findByText(/Could not read your saved filters\./)).toBeInTheDocument();
      fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
      expect(await within(panel).findByRole('option', { name: 'Line heaters by Demo' })).toBeInTheDocument();
    });
  });
});

describe('S-4 Equipment search, the metric cards', () => {
  const rows = [
    searchRow(1, { verificationPct: 100, heatDutyMmbtuHr: null }),
    searchRow(2, { verificationPct: 20, openRequestCount: 1 }),
    searchRow(3, { verificationPct: 100 }),
  ];

  beforeEach(() => {
    fetchSortedPage.mockReset();
    fetchSortedPage.mockResolvedValue(page(rows));
    listSavedViews.mockReset().mockResolvedValue([]);
    window.location.hash = '#/equipment';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  const summary = () => screen.getByRole('region', { name: 'Equipment summary' });
  const card = (label: RegExp) => within(summary()).getByRole('button', { name: label });
  const tags = () => screen.queryAllByRole('link', { name: /^SYN-TAG-/ }).map((a) => a.textContent);

  it('shows each figure worked out from the rows of the search', async () => {
    render(<EquipmentSearch />);
    await screen.findByRole('region', { name: 'Equipment summary' });
    expect(card(/^Heaters: 3$/)).toHaveAttribute('aria-pressed', 'true');
    expect(card(/^Fully verified: 2 of 3 \(67%\)$/)).toHaveAttribute('aria-pressed', 'false');
    expect(card(/^Under 50% verified: 1 of 3 \(33%\)$/)).toBeInTheDocument();
    expect(card(/^With open requests: 1 of 3 \(33%\)$/)).toBeInTheDocument();
    expect(card(/^Missing heat duty: 1 of 3 \(33%\)$/)).toBeInTheDocument();
  });

  it('filters the table when a card is clicked, and shows every heater again on a second click', async () => {
    render(<EquipmentSearch />);
    await screen.findByRole('region', { name: 'Equipment summary' });
    fireEvent.click(card(/^Fully verified/));
    await waitFor(() => expect(tags()).toEqual(['SYN-TAG-0001', 'SYN-TAG-0003']));
    expect(card(/^Fully verified/)).toHaveAttribute('aria-pressed', 'true');
    expect(card(/^Heaters: 2$/)).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Filter, 1 selected' })).toBeInTheDocument();

    fireEvent.click(card(/^Fully verified/));
    await waitFor(() => expect(tags()).toHaveLength(3));
  });

  it('holds the place with loading cards while the rows are read', () => {
    fetchSortedPage.mockReturnValue(new Promise(() => undefined));
    render(<EquipmentSearch />);
    expect(screen.getByLabelText('Loading the equipment summary')).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps the total and explains the rest when the search is too large to summarise', async () => {
    fetchSortedPage.mockResolvedValue(page(rows, true, 5000));
    render(<EquipmentSearch />);
    expect(await screen.findByText(/This search is too large to summarise/)).toBeInTheDocument();
    expect(card(/^Heaters: 5,000$/)).toBeEnabled();
    expect(card(/^Fully verified: not available$/)).toBeDisabled();
  });
});
