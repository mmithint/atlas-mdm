import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The programme sections come through `previewInvoke`; here it answers from the demo handlers, as under dev:mock.
vi.mock('@/lib/preview-invoke', async () => {
  const { unwrapAct } = await import('@/lib/act-answer');
  const { invokePreview } = await import('@/dev-mock/preview-handlers');
  return { previewInvoke: async (name: never, input: never) => unwrapAct(await invokePreview(name, input)) };
});
const { fetchQueue } = vi.hoisted(() => ({ fetchQueue: vi.fn() }));
vi.mock('@/features/approvals/queue-api', () => ({ fetchQueue }));

import { ProfileContext } from '@/app/profile.context';
import { homeSummary } from '@/dev-mock/demo-home';
import { resetMock } from '@/dev-mock/mock-functions';
import { PERSONAS, profileOf, setPersona, type PersonaId } from '@/dev-mock/personas';
import { queuePage } from '@/features/approvals/queue-fixtures';

import { Home } from './home.component';

function renderAs(id: PersonaId) {
  setPersona(id);
  const profile = profileOf(PERSONAS.find((p) => p.id === id)!);
  render(
    <ProfileContext.Provider value={{ state: { status: 'ready', profile }, reload: () => {} }}>
      <Home />
    </ProfileContext.Provider>
  );
}

describe('S-1 Home (agreed content, 20 Nov)', () => {
  beforeEach(() => {
    resetMock();
    fetchQueue.mockReset();
    fetchQueue.mockResolvedValue(queuePage());
  });

  it('shows My work tiles that open Approvals on their tab', async () => {
    renderAs('admin');
    const returned = await screen.findByRole('link', { name: /Returned to me/ });
    expect(returned).toHaveAttribute('href', '#/approvals?tab=RETURNED');
    expect(screen.getByRole('link', { name: /stage 1/ })).toHaveAttribute('href', '#/approvals');
  });

  it('shows Data quality and Request pipeline to an approver', async () => {
    renderAs('responsible');
    expect(await screen.findByRole('heading', { name: 'Data quality' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Open violations by severity')).toBeInTheDocument();
  });

  it('hides the programme sections from a field lead, and the server sends none', async () => {
    renderAs('field');
    await screen.findByRole('link', { name: /Returned to me/ });
    expect(screen.queryByRole('heading', { name: 'Data quality' })).toBeNull();
    expect(homeSummary()).toEqual({ dataQuality: null, pipeline: null });
  });

  it('counts the pipeline from the demo store', () => {
    setPersona('admin');
    const p = homeSummary().pipeline!;
    expect(p.openByStage.map((s) => s.count)).toEqual([8, 4, 2]);
    expect(p.openTotal).toBe(14);
    expect(p.awaitingExport).toBe(6);
  });
});
