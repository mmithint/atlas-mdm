import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The field view calls its functions through `previewInvoke`, which answers only under `npm run dev:mock`.
// Here it answers from the same sample-data handlers, so the test shows the page works on the demo data.
vi.mock('@/lib/preview-invoke', async () => {
  const { unwrapAct } = await import('@/lib/act-answer');
  const { invokePreview } = await import('@/dev-mock/preview-handlers');
  return { previewInvoke: async (name: never, input: never) => unwrapAct(await invokePreview(name, input)) };
});

import { demo } from '@/dev-mock/demo-store';
import { resetMock } from '@/dev-mock/mock-functions';

import { FieldView } from './field-view.component';

const pick = (label: string, index = 1) => {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: select.options[index].value } });
};

describe('S-6 Field view on the demo data (TrueContext order)', () => {
  beforeEach(() => resetMock());

  it('walks location → heater → marks → submit, and a catalogue correction becomes a request', async () => {
    render(<FieldView />);
    await screen.findByLabelText('Business unit');
    pick('Business unit');
    await waitFor(() => expect((screen.getByLabelText('Facility') as HTMLSelectElement).options.length).toBeGreaterThan(1));
    pick('Facility');
    if (!(screen.getByLabelText('Sub-asset') as HTMLSelectElement).value) pick('Sub-asset');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    const list = within(await screen.findByRole('radiogroup', { name: 'Heaters at this site' }));
    fireEvent.click(list.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    const serial = within(await screen.findByRole('radiogroup', { name: 'Engineering tag: mark' }));
    fireEvent.click(serial.getByRole('radio', { name: 'Correction required' }));
    const block = serial.getByRole('radio', { name: 'Correction required' }).closest('fieldset') as HTMLElement;
    fireEvent.change(within(block).getByPlaceholderText('Type the value as written'), { target: { value: 'SYN-TAG-NEW-1' } });
    fireEvent.change(within(block).getByLabelText(/Why it needs correcting/), { target: { value: 'Tag plate reads differently' } });

    const service = within(screen.getByRole('radiogroup', { name: 'Burner count: mark' }));
    fireEvent.click(service.getByRole('radio', { name: 'Verified correct' }));

    const before = demo().requests.length;
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(await screen.findByText(/Corrections that become approval requests/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

    expect(await screen.findByText('Form submitted')).toBeInTheDocument();
    expect(demo().requests.length).toBe(before + 1);
    expect(demo().requests[0].fieldCode).toBe('EQUIPMENT_TAG_NUMBER');
    expect(demo().fieldForms).toHaveLength(1);
  });

  it('shows the Proposed (Q-452) note when the equipment is not in the list', async () => {
    render(<FieldView />);
    fireEvent.click(await screen.findByRole('button', { name: /Use my location/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    const existing = within(await screen.findByRole('radiogroup', { name: /existing equipment/ }));
    fireEvent.click(existing.getByRole('radio', { name: 'No' }));
    expect(screen.getByText(/Proposed, only if you confirm it \(Q-452\)/)).toBeInTheDocument();
  });
});
