//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROFILE = vi.hoisted(() => ({
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
  responsibleScope: { allOrcm: false, profitCenters: [] },
  accountableScope: { allOrcm: false, profitCenters: [] },
}));

// The app asks the server who is signed in; here the server is a stub.
vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({ functions: { getMyProfile: { invoke: async () => PROFILE } } }),
}));

import App from '@/App';
import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';

const auth = { session: { user: { id: 'u', email: 'tester.one@example.test' }, isAuthenticated: true, isAnonymous: false } } as unknown as AuthContextValue;

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '#/';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('renders the ATLAS shell with its menu', async () => {
    render(
      <AuthContext.Provider value={auth}>
        <App />
      </AuthContext.Provider>
    );
    expect(screen.getByText('ATLAS')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Signed in as')).toHaveTextContent('Tester One');
  });

  it('opens on the home screen', async () => {
    render(
      <AuthContext.Provider value={auth}>
        <App />
      </AuthContext.Provider>
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  });
});
