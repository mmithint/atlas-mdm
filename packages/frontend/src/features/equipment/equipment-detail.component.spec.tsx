import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchHeater } = vi.hoisted(() => ({ fetchHeater: vi.fn() }));
vi.mock('./equipment-api', () => ({ fetchHeater }));

import { EquipmentDetail } from './equipment-detail.component';
import { heaterDetail } from './test-fixtures';

describe('S-5 Equipment detail', () => {
  beforeEach(() => fetchHeater.mockReset());

  it('shows the heater with the tag as title and the identifiers as plates', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'SYN-TAG-0001' })).toBeInTheDocument();
    expect(fetchHeater).toHaveBeenCalledWith(1);
    expect(screen.getAllByText('SYN-EQ-0001').length).toBeGreaterThan(0);
  });

  it('lists the catalogue fields, key fields first, with the unit and no trailing zeros', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    await screen.findByRole('heading', { level: 1 });

    const table = screen.getByRole('table', { name: 'All fields of this heater' });
    const groups = within(table).getAllByRole('rowgroup');
    expect(within(groups[1]!).getByText('Key fields')).toBeInTheDocument();
    expect(within(groups[2]!).getByText('Additional details')).toBeInTheDocument();

    const duty = within(table).getByRole('row', { name: /Heat duty/ });
    expect(within(duty).getAllByText(/2\.5 MMBTU\/hr/).length).toBeGreaterThan(0);
    expect(within(duty).queryByText(/2\.5000/)).toBeNull();
    // all four catalogue fields of the fixture are there
    expect(within(table).getAllByRole('row').length).toBe(1 + 2 + 4); // header + two group rows + four fields
  });

  it('shows who answers first and who signs off second next to a field, and "no route" when there is none', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    await screen.findByRole('heading', { level: 1 });
    const manufacturer = screen.getByRole('row', { name: /Manufacturer/ });
    expect(within(manufacturer).getByText(/Operations-IOC/)).toBeInTheDocument();
    expect(within(manufacturer).getByText(/SAPBusinessSupport/)).toBeInTheDocument();
    const flocClass = screen.getByRole('row', { name: /FLOC class/ });
    expect(within(flocClass).getByText('no route')).toBeInTheDocument();
  });

  it('shows the FLOC hierarchy and links the facility to the drill-down', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/SYN-ORG\s+›\s+SYN-BU-01\s+›\s+SYN-AREA-01/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SYN-FL-AREA-01' })).toHaveAttribute('href', '#/equipment?facility=SYN-FL-AREA-01');
  });

  it('keeps the change buttons switched off until the approval phase, and says what is still to come', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('button', { name: 'Request change' })).toBeDisabled();
    for (const b of screen.getAllByRole('button', { name: /Request a change to/ })) expect(b).toBeDisabled();
    for (const name of ['Rule results', 'Verification', 'History and requests', 'Evidence']) {
      expect(screen.getByRole('region', { name: `${name}, not built yet` })).toBeInTheDocument();
    }
  });

  it('says so when the golden record has no approved change yet', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    render(<EquipmentDetail idText="1" />);
    expect(await screen.findByText(/none yet \(the values are the SAP baseline\)/)).toBeInTheDocument();
  });

  it('says there is no such heater, and does not ask the server for a broken id', async () => {
    render(<EquipmentDetail idText="abc" />);
    expect(await screen.findByText('No such heater')).toBeInTheDocument();
    expect(fetchHeater).not.toHaveBeenCalled();
  });

  it('says there is no such heater for an unknown id', async () => {
    fetchHeater.mockResolvedValue(null);
    render(<EquipmentDetail idText="999999" />);
    expect(await screen.findByText('No such heater')).toBeInTheDocument();
    expect(fetchHeater).toHaveBeenCalledWith(999999);
  });

  it('shows a failure with a way to try again', async () => {
    fetchHeater.mockRejectedValueOnce(new Error('connector said no'));
    render(<EquipmentDetail idText="1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('connector said no');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
