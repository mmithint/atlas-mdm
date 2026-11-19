import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileContext, type MyProfile, type ProfileState } from '@/app/profile.context';

const { fetchHeater, fetchFormOptions, fetchEquipmentRequests, submitChangeRequest } = vi.hoisted(() => ({
  fetchHeater: vi.fn(),
  fetchFormOptions: vi.fn(),
  fetchEquipmentRequests: vi.fn(),
  submitChangeRequest: vi.fn(),
}));
vi.mock('./equipment-api', () => ({ fetchHeater }));
vi.mock('./change-request-api', () => ({ fetchFormOptions, fetchEquipmentRequests, submitChangeRequest }));

import { EquipmentDetail } from './equipment-detail.component';
import { formOptions, heaterDetail, requestRow } from './test-fixtures';

const NO_SCOPE = { allOrcm: false, profitCenters: [] };
const PROFILE: MyProfile = {
  status: 'OK',
  userId: '11111111-2222-3333-4444-555555555555',
  email: 'tester.one@example.test',
  displayName: 'Tester One',
  roles: ['GeneralViewer'],
  groups: [],
  canView: true,
  canSubmitRequests: true,
  canEditRules: false,
  canPublishRules: false,
  canResponsibleApprove: false,
  canAccountableApprove: false,
  canManageAdmin: false,
  responsibleScope: NO_SCOPE,
  accountableScope: NO_SCOPE,
};
const READY: ProfileState = { status: 'ready', profile: PROFILE };

function renderDetail(idText = '1', profile: ProfileState = READY) {
  return render(
    <ProfileContext.Provider value={{ state: profile, reload: vi.fn() }}>
      <EquipmentDetail idText={idText} />
    </ProfileContext.Provider>
  );
}

describe('S-5 Equipment detail', () => {
  beforeEach(() => {
    fetchHeater.mockReset();
    fetchFormOptions.mockReset();
    fetchEquipmentRequests.mockReset();
    submitChangeRequest.mockReset();
    fetchFormOptions.mockResolvedValue(formOptions());
    fetchEquipmentRequests.mockResolvedValue({ totalCount: 0, rows: [] });
  });

  it('shows the heater with the tag as title and the identifiers as plates', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    renderDetail();
    expect(await screen.findByRole('heading', { level: 1, name: 'SYN-TAG-0001' })).toBeInTheDocument();
    expect(fetchHeater).toHaveBeenCalledWith(1);
    expect(screen.getAllByText('SYN-EQ-0001').length).toBeGreaterThan(0);
  });

  it('lists the catalogue fields, key fields first, with the unit and no trailing zeros', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    renderDetail();
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
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    const manufacturer = screen.getByRole('row', { name: /Manufacturer/ });
    expect(within(manufacturer).getByText(/Operations-IOC/)).toBeInTheDocument();
    expect(within(manufacturer).getByText(/SAPBusinessSupport/)).toBeInTheDocument();
    const flocClass = screen.getByRole('row', { name: /FLOC class/ });
    expect(within(flocClass).getByText('no route')).toBeInTheDocument();
  });

  it('shows the FLOC hierarchy and links the facility to the drill-down', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/SYN-ORG\s+›\s+SYN-BU-01\s+›\s+SYN-AREA-01/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SYN-FL-AREA-01' })).toHaveAttribute('href', '#/equipment?facility=SYN-FL-AREA-01');
  });

  it('says what is still to come, without the history card that is now a real section', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    renderDetail();
    await screen.findByRole('heading', { level: 1 });
    for (const name of ['Rule results', 'Verification', 'Evidence']) {
      expect(screen.getByRole('region', { name: `${name}, not built yet` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('region', { name: 'History and requests, not built yet' })).toBeNull();
  });

  it('says so when the golden record has no approved change yet', async () => {
    fetchHeater.mockResolvedValue(heaterDetail());
    renderDetail();
    expect(await screen.findByText(/none yet \(the values are the SAP baseline\)/)).toBeInTheDocument();
  });

  it('says there is no such heater, and does not ask the server for a broken id', async () => {
    renderDetail('abc');
    expect(await screen.findByText('No such heater')).toBeInTheDocument();
    expect(fetchHeater).not.toHaveBeenCalled();
  });

  it('says there is no such heater for an unknown id', async () => {
    fetchHeater.mockResolvedValue(null);
    renderDetail('999999');
    expect(await screen.findByText('No such heater')).toBeInTheDocument();
    expect(fetchHeater).toHaveBeenCalledWith(999999);
  });

  it('shows a failure with a way to try again', async () => {
    fetchHeater.mockRejectedValueOnce(new Error('connector said no'));
    renderDetail();
    expect(await screen.findByRole('alert')).toHaveTextContent('connector said no');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  describe('Request change (APP-4)', () => {
    const header = () => screen.getByRole('button', { name: 'Request change' });
    const rowButton = (label: string) => screen.getByRole('button', { name: `Request a change to ${label}` });

    it('switches the buttons on for a registered person who may submit', async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(header()).toBeEnabled());
      for (const b of screen.getAllByRole('button', { name: /Request a change to/ })) expect(b).toBeEnabled();
    });

    it('opens the dialog from the header with no field chosen', async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(header()).toBeEnabled());
      fireEvent.click(header());
      expect(screen.getByRole('dialog', { name: 'Request a change to SYN-TAG-0001' })).toBeInTheDocument();
      expect(screen.getByLabelText('Field')).toHaveValue('');
    });

    it("opens the dialog from a row's pencil with that field chosen and its value shown", async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(rowButton('Heat duty (MMBTU/hr)')).toBeEnabled());
      fireEvent.click(rowButton('Heat duty (MMBTU/hr)'));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByLabelText('Field')).toHaveValue('HEAT_DUTY');
      expect(within(dialog).getByText('2.5 MMBTU/hr')).toBeInTheDocument();
    });

    it("keeps a blocked field's button off with the server's reason, and the others on", async () => {
      fetchFormOptions.mockResolvedValue(
        formOptions({ blockedFields: [{ fieldCode: 'FLOC_CLASS', reason: 'Only an admin may ask to change this field by hand.' }] })
      );
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(rowButton('Manufacturer')).toBeEnabled());
      expect(rowButton('FLOC class')).toBeDisabled();
      expect(rowButton('FLOC class')).toHaveAttribute('title', 'Only an admin may ask to change this field by hand.');
    });

    it('keeps a field the catalogue marks read-only switched off', async () => {
      const detail = heaterDetail();
      detail.catalog = detail.catalog.map((c) => (c.fieldCode === 'EQUIPMENT_TAG_NUMBER' ? { ...c, isEditable: false } : c)) as typeof detail.catalog;
      fetchHeater.mockResolvedValue(detail);
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(rowButton('Manufacturer')).toBeEnabled());
      expect(rowButton('Engineering tag')).toBeDisabled();
      expect(rowButton('Engineering tag')).toHaveAttribute('title', 'This field cannot be changed by hand.');
    });

    it('switches everything off, saying why, for a person who may not submit', async () => {
      fetchFormOptions.mockResolvedValue(formOptions({ canSubmit: false }));
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(header()).toHaveAttribute('title', 'You are not allowed to submit change requests.'));
      expect(header()).toBeDisabled();
      for (const b of screen.getAllByRole('button', { name: /Request a change to/ })) expect(b).toBeDisabled();
    });

    it('switches everything off for a sign-in that is not linked to a person yet', async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail('1', { status: 'ready', profile: { ...PROFILE, status: 'NOT_REGISTERED' } });
      await screen.findByRole('heading', { level: 1 });
      expect(header()).toBeDisabled();
      expect(header()).toHaveAttribute('title', expect.stringMatching(/not linked to a person/));
    });

    it('never breaks the page when the form options fail: the buttons stay off with the reason', async () => {
      fetchFormOptions.mockRejectedValue(new Error('options said no'));
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      expect(await screen.findByRole('heading', { level: 1, name: 'SYN-TAG-0001' })).toBeInTheDocument();
      await waitFor(() => expect(header()).toHaveAttribute('title', expect.stringMatching(/options said no/)));
      expect(header()).toBeDisabled();
      expect(screen.getByRole('table', { name: 'All fields of this heater' })).toBeInTheDocument();
    });

    it('waits while the options load, with a reason', async () => {
      fetchFormOptions.mockReturnValue(new Promise(() => undefined));
      fetchHeater.mockResolvedValue(heaterDetail());
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      expect(header()).toBeDisabled();
      expect(header()).toHaveAttribute('title', 'Checking what you may request…');
    });
  });

  describe('Requests on this heater (APP-4)', () => {
    it('shows the heater\'s requests under the fields', async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      fetchEquipmentRequests.mockResolvedValue({ totalCount: 1, rows: [requestRow(5)] });
      renderDetail();
      await screen.findByRole('heading', { level: 1 });
      expect(await screen.findByRole('link', { name: 'CR-000005' })).toHaveAttribute('href', '#/requests/5');
      expect(fetchEquipmentRequests).toHaveBeenCalledWith(1);
    });

    it('reloads the list after a request was created from the dialog', async () => {
      fetchHeater.mockResolvedValue(heaterDetail());
      fetchEquipmentRequests.mockResolvedValueOnce({ totalCount: 0, rows: [] });
      renderDetail();
      await screen.findByText('No requests yet');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Request change' })).toBeEnabled());

      submitChangeRequest.mockResolvedValue({
        ok: true,
        status: 'OK',
        error: null,
        errorCode: null,
        requestId: 8,
        requestRef: 'CR-000008',
        outcome: 'CREATED',
        responsibleGroup: 'Operations-IOC-Carlsbad',
        accountableGroup: 'SAPBusinessSupport',
      });
      fetchEquipmentRequests.mockResolvedValueOnce({ totalCount: 1, rows: [requestRow(8)] });

      fireEvent.click(screen.getByRole('button', { name: 'Request a change to Manufacturer' }));
      fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'SYNTHETIC MFR B' } });
      fireEvent.change(screen.getByLabelText('Reason for the change'), { target: { value: 'nameplate' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      });

      expect(submitChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ equipmentId: 1, fieldCode: 'MANUFACTURER', newValue: 'SYNTHETIC MFR B' }));
      // the dialog's own link and the list's link both point at the new request
      await waitFor(() => expect(fetchEquipmentRequests).toHaveBeenCalledTimes(2));
      expect((await screen.findAllByRole('link', { name: 'CR-000008' })).length).toBeGreaterThan(1);
    });
  });
});
