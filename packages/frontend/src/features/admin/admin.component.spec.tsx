import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Admin page calls its functions through `previewInvoke`, which answers only under `npm run dev:mock`.
// Here it answers from the same sample-data handlers.
vi.mock('@/lib/preview-invoke', async () => {
  const { unwrapAct } = await import('@/lib/act-answer');
  const { invokePreview } = await import('@/dev-mock/preview-handlers');
  return { previewInvoke: async (name: never, input: never) => unwrapAct(await invokePreview(name, input)) };
});

import * as admin from '@/dev-mock/demo-admin';
import * as fieldForm from '@/dev-mock/demo-field-form';
import { activeValues } from '@/dev-mock/demo-store';
import { resetMock } from '@/dev-mock/mock-functions';

import { Admin } from './admin.component';

describe('S-13 Admin on the demo data', () => {
  beforeEach(() => resetMock());

  it('shows the six tabs and the 16 x 10 role table from the seeds', async () => {
    render(<Admin />);
    const tabs = within(await screen.findByRole('tablist', { name: 'Admin' }));
    for (const name of [/User roles/, /Role definitions/, /Field governance/, /Drop-down values/, /Mandatory fields/, /Route check/]) expect(tabs.getByRole('tab', { name })).toBeInTheDocument();
    fireEvent.click(tabs.getByRole('tab', { name: /Role definitions/ }));
    expect(await screen.findByText('16 roles × 10 permissions', { exact: false })).toBeInTheDocument();
  });

  it('flags DenverCity (no member) in the route check, and adding members clears it', () => {
    const denver = () => admin.adminData().routeCheck.find((r) => r.profitCenter === 'OP EOR');
    expect(denver()?.responsibleGroup).toBe('Operations-IOC-DenverCity');
    expect(denver()?.status).toBe('UNROUTED');
    admin.addMember('Operations-IOC-DenverCity', 'Kim One', 'kim.one@example.test');
    expect(denver()?.status).toBe('FEW_MEMBERS');
    expect(() => admin.addMember('Operations-IOC-DenverCity', 'Real Person', 'real@company.com')).toThrow(/example\.test/);
  });

  it('adds a member through the page', async () => {
    render(<Admin />);
    const row = (await screen.findByText('Operations-IOC-DenverCity')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Add member/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kim One' } });
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'kim.one@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to Operations-IOC-DenverCity/ }));
    expect(await screen.findByText('Kim One (sample)')).toBeInTheDocument();
  });

  it('makes a field mandatory on the Field view, and a switched-off value leaves the list', () => {
    admin.setMandatory('SERIAL_NUMBER', true);
    expect(fieldForm.form(1).fields.find((f) => f.fieldCode === 'SERIAL_NUMBER')?.mandatory).toBe(true);
    admin.setDropdown('EQUIPMENT_USER_STATUS', 'DECM', false);
    expect(activeValues('EQUIPMENT_USER_STATUS')).not.toContain('DECM');
    expect(fieldForm.form(1).fields.find((f) => f.fieldCode === 'EQUIPMENT_USER_STATUS')?.options).not.toContain('DECM');
  });

  it('refuses a route whose two stages have the same role', async () => {
    expect(() => admin.setRoute(3, 'SAPBusinessSupport', 'SAPBusinessSupport')).toThrow(/different roles/);
    await waitFor(() => expect(admin.adminData().routes[2].responsibleRole).toBe('Operations-IOC - NMD'));
  });
});
