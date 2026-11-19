import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: async () => ({}) }));
// The bell in the header reads the person's notifications; the shell tests do not need real ones.
vi.mock('@/features/notifications/notifications-api', () => ({
  fetchNotifications: async () => ({ unreadCount: 0, items: [] }),
}));

import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';

import { AppShell } from './app-shell.component';
import type { MyProfile } from './profile.context';
import { ProfileProvider } from './profile.provider';

const NO_SCOPE = { allOrcm: false, profitCenters: [] };
const PROFILE: MyProfile = {
  status: 'OK',
  userId: '11111111-2222-3333-4444-555555555555',
  email: 'tester.one@example.test',
  displayName: 'Tester One',
  roles: ['GeneralViewer', 'Operations-IOC'],
  groups: ['Operations-IOC-Midland'],
  canView: true,
  canSubmitRequests: true,
  canEditRules: false,
  canPublishRules: false,
  canResponsibleApprove: true,
  canAccountableApprove: false,
  canManageAdmin: false,
  responsibleScope: { allOrcm: false, profitCenters: ['OP RES MB'] },
  accountableScope: NO_SCOPE,
};

const auth = { session: { user: { id: 'u', email: 'session.person@example.test' }, isAuthenticated: true, isAnonymous: false } } as unknown as AuthContextValue;

function renderShell(load: () => Promise<MyProfile>) {
  return render(
    <AuthContext.Provider value={auth}>
      <ProfileProvider load={load}>
        <AppShell />
      </ProfileProvider>
    </AuthContext.Provider>
  );
}

const menu = () => screen.getByRole('navigation', { name: 'Main' });

describe('App shell', () => {
  beforeEach(() => {
    // A screen that is not built yet, so the shell is tested without a screen's own reads.
    window.location.hash = '#/rules';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('shows the person, their roles and a menu with every screen except admin', async () => {
    renderShell(async () => PROFILE);
    expect(await screen.findByLabelText('Signed in as')).toHaveTextContent('Tester One');
    expect(screen.getByLabelText('Your roles')).toHaveTextContent('GeneralViewer, Operations-IOC');

    const names = within(menu()).getAllByRole('link').map((a) => a.textContent?.replace(/soon$/, '').trim());
    expect(names).toEqual(['Home', 'Approvals', 'Equipment', 'Field view', 'New field request', 'Rules', 'Verification', 'EVOLVE export', 'Notifications']);
    expect(within(menu()).queryByRole('link', { name: /Admin/ })).toBeNull();
  });

  it('shows the admin entry to a person with the admin right', async () => {
    renderShell(async () => ({ ...PROFILE, roles: ['Admin'], canManageAdmin: true }));
    expect(await within(menu()).findByRole('link', { name: /Admin/ })).toBeInTheDocument();
  });

  it('marks the current page, and marks screens that are not built yet', async () => {
    renderShell(async () => PROFILE);
    await screen.findByLabelText('Signed in as');
    expect(within(menu()).getByRole('link', { name: /Rules/ })).toHaveAttribute('aria-current', 'page');
    expect(within(menu()).getByRole('link', { name: /Rules/ })).toHaveAttribute('title', 'Built in APP-5');
    expect(within(menu()).getByRole('link', { name: /Equipment/ })).not.toHaveAttribute('title');
    expect(within(menu()).getByRole('link', { name: /Approvals/ })).not.toHaveAttribute('title');
  });

  it('shows a placeholder, with the phase, for a screen that is not built yet', async () => {
    renderShell(async () => PROFILE);
    expect(await screen.findByRole('heading', { level: 1, name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByText(/It arrives in/)).toHaveTextContent('APP-5');
  });

  it('keeps a person without the admin right out of the admin screen', async () => {
    window.location.hash = '#/admin';
    renderShell(async () => PROFILE);
    expect(await screen.findByText('You do not have access to this screen.')).toBeInTheDocument();
  });

  it('opens the admin screen for an admin', async () => {
    window.location.hash = '#/admin';
    renderShell(async () => ({ ...PROFILE, roles: ['Admin'], canManageAdmin: true }));
    expect(await screen.findByText(/This screen is not built yet/)).toBeInTheDocument();
    expect(screen.queryByText('You do not have access to this screen.')).toBeNull();
  });

  it('shows the notification bell to a registered person, and not to one who is not registered yet', async () => {
    const first = renderShell(async () => PROFILE);
    expect(await screen.findByRole('button', { name: /Notifications/ })).toBeInTheDocument();
    first.unmount();
    renderShell(async () => ({ ...PROFILE, status: 'NOT_REGISTERED', email: null, displayName: null, roles: [] }));
    await screen.findByLabelText('Your roles');
    expect(screen.queryByRole('button', { name: /Notifications/ })).toBeNull();
  });

  it('says so for an address that is no screen', async () => {
    window.location.hash = '#/nothing-here';
    renderShell(async () => PROFILE);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('tells a signed-in but unregistered person what to do, with their id to copy', async () => {
    renderShell(async () => ({ ...PROFILE, status: 'NOT_REGISTERED', email: null, displayName: null, roles: [], canView: false, canSubmitRequests: false, canResponsibleApprove: false }));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('has not linked your account to ATLAS yet');
    expect(notice).toHaveTextContent('11111111-2222-3333-4444-555555555555');
    expect(screen.getByLabelText('Signed in as')).toHaveTextContent('session.person@example.test');
    expect(screen.getByLabelText('Your roles')).toHaveTextContent('Not registered yet');
    expect(within(menu()).queryByRole('link', { name: /Admin/ })).toBeNull();
  });

  it('checks the profile again on request', async () => {
    const load = vi
      .fn<() => Promise<MyProfile>>()
      .mockResolvedValueOnce({ ...PROFILE, status: 'NOT_REGISTERED', email: null, displayName: null, roles: [] })
      .mockResolvedValueOnce(PROFILE);
    renderShell(load);
    fireEvent.click(await screen.findByRole('button', { name: 'I was added: check again' }));
    expect(await screen.findByLabelText('Signed in as')).toHaveTextContent('Tester One');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps working when the profile cannot be loaded, and offers to try again', async () => {
    const load = vi.fn<() => Promise<MyProfile>>().mockRejectedValueOnce(new Error('function failed')).mockResolvedValueOnce(PROFILE);
    renderShell(load);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('function failed');
    expect(screen.getByLabelText('Your roles')).toHaveTextContent('Roles unavailable');
    expect(menu()).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Signed in as')).toHaveTextContent('Tester One');
  });

  it('opens the menu on a small screen and closes it with Escape', async () => {
    renderShell(async () => PROFILE);
    await screen.findByLabelText('Signed in as');
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    expect(screen.getByRole('button', { name: 'Open the menu' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open the menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('puts the screen name in the page title', async () => {
    renderShell(async () => PROFILE);
    await screen.findByLabelText('Signed in as');
    expect(document.title).toBe('Rules · ATLAS');
  });
});
