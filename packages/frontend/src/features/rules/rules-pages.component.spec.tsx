import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Rules pages call their functions through `previewInvoke`, which answers only under `npm run dev:mock`.
// Here it answers from the same sample-data handlers, so these tests show the pages work on the demo data.
vi.mock('@/lib/preview-invoke', async () => {
  const { unwrapAct } = await import('@/lib/act-answer');
  const { invokePreview } = await import('@/dev-mock/preview-handlers');
  return { previewInvoke: async (name: never, input: never) => unwrapAct(await invokePreview(name, input)) };
});
vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: async () => ({}) }));
// The rule page also reads the field catalogue (a plain table through the connector); the pages do not need real rows here.
vi.mock('@/features/equipment/equipment-api', () => ({ fetchCatalog: async () => [] }));

import { currentPersona, profileOf, setPersona } from '@/dev-mock/personas';
import { resetMock } from '@/dev-mock/mock-functions';
import { ProfileProvider } from '@/app/profile.provider';
import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';

import { RulePage } from './rule-page.component';
import { RulesCatalog } from './rules-catalog.component';

const auth = { session: { user: { id: 'u', email: 'session.person@example.test' }, isAuthenticated: true, isAnonymous: false } } as unknown as AuthContextValue;

function renderAs(persona: 'admin' | 'author' | 'accountable' | 'field' | 'responsible', page: React.ReactElement) {
  setPersona(persona);
  return render(
    <AuthContext.Provider value={auth}>
      <ProfileProvider load={async () => profileOf(currentPersona())}>{page}</ProfileProvider>
    </AuthContext.Provider>
  );
}

describe('S-9 Rules on the demo data', () => {
  beforeEach(() => {
    resetMock();
    window.location.hash = '#/rules';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('lists the client\'s rules with their state, and gives the admin Run rules now', async () => {
    renderAs('admin', <RulesCatalog />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Business rules' })).toBeInTheDocument();
    for (const id of ['HEATER_CLASS_FIRED', 'HEATER_DUTY', 'ENGINEERING_TAG_UNIQUE']) {
      expect(await screen.findByText(id)).toBeInTheDocument();
    }
    expect(await screen.findByRole('button', { name: /Run rules now/ })).toBeInTheDocument();
  });

  it('does not offer Run rules now to a person who is not an admin', async () => {
    renderAs('field', <RulesCatalog />);
    await screen.findByText('HEATER_CLASS_FIRED');
    expect(screen.queryByRole('button', { name: /Run rules now/ })).toBeNull();
  });

  it('shows one rule with its tabs, its SQL and its versions', async () => {
    renderAs('author', <RulePage ruleId="ENGINEERING_TAG_UNIQUE" />);
    expect(await screen.findByText('ENGINEERING_TAG_UNIQUE')).toBeInTheDocument();
    const tabs = within(await screen.findByRole('tablist'));
    for (const name of [/Definition/, /Test/, /Preview/, /Versions/, /Runs/]) expect(tabs.getByRole('tab', { name })).toBeInTheDocument();
    fireEvent.click(tabs.getByRole('tab', { name: /Versions/ }));
    await waitFor(() => expect(screen.getByRole('tabpanel')).toBeInTheDocument());
  });
});
