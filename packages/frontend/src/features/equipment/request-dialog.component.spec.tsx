import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitChangeRequest } = vi.hoisted(() => ({ submitChangeRequest: vi.fn() }));
vi.mock('./change-request-api', () => ({ submitChangeRequest }));

import { RequestDialog, type RequestDialogProps } from './request-dialog.component';
import type { FieldChoice } from './request-dialog-model';

const choice = (over: Partial<FieldChoice>): FieldChoice => ({
  fieldCode: 'MANUFACTURER',
  label: 'Manufacturer',
  unit: null,
  entityType: 'EQUIPMENT',
  dataType: 'TEXT',
  maxLength: 30,
  valuesFromList: false,
  current: 'SYNTHETIC MFR A',
  rawCurrent: 'SYNTHETIC MFR A',
  responsibleRole: 'Operations-IOC',
  accountableRole: 'SAPBusinessSupport',
  unavailableReason: null,
  ...over,
});

const CHOICES: FieldChoice[] = [
  choice({}),
  choice({ fieldCode: 'HEAT_DUTY', label: 'Heat duty', dataType: 'DECIMAL', maxLength: null, unit: 'MMBTU/hr', current: '2.5', rawCurrent: '2.5000' }),
  choice({ fieldCode: 'FIRED_UNFIRED', label: 'Fired / unfired', dataType: 'CODE', valuesFromList: true, current: 'FIRED', rawCurrent: 'FIRED' }),
  choice({ fieldCode: 'EQUIP_CLASS', label: 'Equipment class', unavailableReason: 'Only an admin may change this field.' }),
  choice({ fieldCode: 'TAG', label: 'Tag', responsibleRole: null, accountableRole: null }),
];

const ALLOWED = [
  { fieldCode: 'FIRED_UNFIRED', value: 'UNFIRED', order: 2 },
  { fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 },
];

const created = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 'OK',
  error: null,
  errorCode: null,
  requestId: 42,
  requestRef: 'CR-000042',
  outcome: 'CREATED',
  responsibleGroup: 'Operations-IOC-Carlsbad',
  accountableGroup: 'SAPBusinessSupport',
  ...over,
});

function open(over: Partial<RequestDialogProps> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <RequestDialog
      heater={{ equipmentId: 7, functionalLocation: 'SYN-FL-0007', title: 'SYN-TAG-0007' }}
      choices={CHOICES}
      allowedValues={ALLOWED}
      initialFieldCode={null}
      onClose={onClose}
      onCreated={onCreated}
      {...over}
    />
  );
  return { onClose, onCreated };
}

const submitButton = () => screen.getByRole('button', { name: 'Submit request' });
const pick = (label: string) => fireEvent.change(screen.getByLabelText('Field'), { target: { value: label } });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Request dialog', () => {
  beforeEach(() => {
    submitChangeRequest.mockReset();
  });

  it('opens on the chosen field with its current value read-only and who approves', () => {
    open({ initialFieldCode: 'HEAT_DUTY' });
    expect(screen.getByRole('dialog', { name: 'Request a change to SYN-TAG-0007' })).toBeInTheDocument();
    expect(screen.getByLabelText('Field')).toHaveValue('HEAT_DUTY');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2.5 MMBTU/hr')).toBeInTheDocument();
    expect(within(dialog).getByText(/Operations-IOC/)).toBeInTheDocument();
    expect(within(dialog).getByText(/SAPBusinessSupport/)).toBeInTheDocument();
  });

  it('starts with no field when none was chosen, and offers only the fields the person may request', () => {
    open();
    expect(screen.getByLabelText('Field')).toHaveValue('');
    const names = within(screen.getByLabelText('Field')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Choose a field', 'Manufacturer', 'Heat duty', 'Fired / unfired', 'Tag']);
    expect(screen.queryByLabelText('New value')).toBeNull();
    expect(submitButton()).toBeDisabled();
  });

  it('ignores a starting field that the person may not request', () => {
    open({ initialFieldCode: 'EQUIP_CLASS' });
    expect(screen.getByLabelText('Field')).toHaveValue('');
  });

  it('says so when a field has no approval route', () => {
    open({ initialFieldCode: 'TAG' });
    expect(screen.getByText('no route')).toBeInTheDocument();
  });

  it('keeps Submit disabled until the value differs and a reason is given', () => {
    open({ initialFieldCode: 'MANUFACTURER' });
    expect(submitButton()).toBeDisabled();

    type('New value', 'SYNTHETIC MFR A');
    type('Reason for the change', 'nameplate');
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/already has: type a different one/)).toBeInTheDocument();

    type('New value', 'SYNTHETIC MFR B');
    expect(submitButton()).toBeEnabled();

    type('Reason for the change', '   ');
    expect(submitButton()).toBeDisabled();
  });

  it('compares a number field as numbers: 2.50 is the value 2.5000 already there', () => {
    open({ initialFieldCode: 'HEAT_DUTY' });
    type('Reason for the change', 'nameplate');
    type('New value', '2.50');
    expect(submitButton()).toBeDisabled();
    type('New value', '3');
    expect(submitButton()).toBeEnabled();
    type('New value', '3.123456');
    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/Enter a number/)).toBeInTheDocument();
    expect(screen.getByLabelText('New value')).toHaveAttribute('inputmode', 'decimal');
  });

  it('shows a drop-down of the allowed values, in order, for a list field', () => {
    open({ initialFieldCode: 'FIRED_UNFIRED' });
    const value = screen.getByLabelText('New value');
    expect(value.tagName).toBe('SELECT');
    expect(within(value).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a value', 'FIRED', 'UNFIRED']);
    type('Reason for the change', 'it is not fired');
    expect(submitButton()).toBeDisabled();
    fireEvent.change(value, { target: { value: 'FIRED' } });
    expect(submitButton()).toBeDisabled(); // the value it already has
    fireEvent.change(value, { target: { value: 'UNFIRED' } });
    expect(submitButton()).toBeEnabled();
  });

  it('clears the typed value when another field is chosen', () => {
    open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    pick('HEAT_DUTY');
    expect(screen.getByLabelText('New value')).toHaveValue('');
  });

  it('counts the reason against its 400 character limit', () => {
    open({ initialFieldCode: 'MANUFACTURER' });
    type('Reason for the change', 'abc');
    expect(screen.getByText('3 / 400')).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for the change')).toHaveAttribute('maxlength', '400');
  });

  it('sends a manual request for the heater and shows the new request with a link', async () => {
    submitChangeRequest.mockResolvedValue(created());
    const { onCreated } = open({ initialFieldCode: 'HEAT_DUTY' });
    type('New value', '3.5');
    type('Reason for the change', ' bigger burner ');
    await act(async () => {
      fireEvent.click(submitButton());
    });

    expect(submitChangeRequest).toHaveBeenCalledWith({
      source: 'MANUAL',
      entityType: 'EQUIPMENT',
      equipmentId: 7,
      functionalLocation: '',
      fieldCode: 'HEAT_DUTY',
      oldValue: '2.5000',
      newValue: '3.5',
      reason: 'bigger burner',
      comment: '',
      evidenceJson: '',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Request created');
    expect(screen.getByRole('status')).toHaveTextContent('Operations-IOC-Carlsbad');
    expect(screen.getByRole('link', { name: 'CR-000042' })).toHaveAttribute('href', '#/requests/42');
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('closes from the success state', async () => {
    submitChangeRequest.mockResolvedValue(created());
    const { onClose } = open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    // the dialog's own X and the footer button share the name "Close"; the footer one is the last
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(onClose).toHaveBeenCalled();
  });

  it('says an open request already proposes this change, and does not reload the list', async () => {
    submitChangeRequest.mockResolvedValue(created({ outcome: 'DUPLICATE_SUPPRESSED', requestId: 9, requestRef: 'CR-000009' }));
    const { onCreated } = open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(screen.getByRole('status')).toHaveTextContent('An open request already proposes this change');
    expect(screen.getByRole('link', { name: 'CR-000009' })).toHaveAttribute('href', '#/requests/9');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('says another open request proposes a different value for the field', async () => {
    submitChangeRequest.mockResolvedValue(created({ outcome: 'BLOCKED_INCOMPATIBLE', requestId: 11, requestRef: 'CR-000011' }));
    const { onCreated } = open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(screen.getByRole('status')).toHaveTextContent('Another open request proposes a different value for this field');
    expect(screen.getByRole('link', { name: 'CR-000011' })).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and shows the refusal text when the server says no', async () => {
    submitChangeRequest.mockRejectedValue(new Error('Your sign-in is not linked to a person yet. Send the id shown on the screen to an admin.'));
    const { onCreated } = open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(screen.getByRole('alert')).toHaveTextContent('not linked to a person yet');
    expect(screen.getByRole('dialog', { name: /Request a change to/ })).toBeInTheDocument();
    expect(submitButton()).toBeEnabled(); // the person can correct the form and try again
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('is busy while the request runs: no second submit, and it cannot be dismissed', async () => {
    let finish: (value: unknown) => void = () => undefined;
    submitChangeRequest.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { onClose } = open({ initialFieldCode: 'MANUFACTURER' });
    type('New value', 'SYNTHETIC MFR B');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(submitChangeRequest).toHaveBeenCalledTimes(1);
    await act(async () => finish(created()));
    expect(screen.getByRole('status')).toHaveTextContent('Request created');
  });

  it('raises a location field by the heater\'s location with heater id -1', async () => {
    submitChangeRequest.mockResolvedValue(created());
    open({
      choices: [choice({ fieldCode: 'FLOC_CLASS', label: 'FLOC class', entityType: 'FLOC', dataType: 'CODE', current: 'HEATER', rawCurrent: 'HEATER' })],
      initialFieldCode: 'FLOC_CLASS',
    });
    type('New value', 'HEATER2');
    type('Reason for the change', 'why');
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(submitChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'FLOC', equipmentId: -1, functionalLocation: 'SYN-FL-0007', fieldCode: 'FLOC_CLASS' }));
  });

  it('explains an empty picker', () => {
    open({ choices: [choice({ unavailableReason: 'This field cannot be changed by hand.' })] });
    expect(screen.getByText('No field of this heater can be requested by you.')).toBeInTheDocument();
  });

  it('closes with Escape and with Cancel when idle', () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
