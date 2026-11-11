//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/auth.context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', email: 'nitej.mithinti@bizmetric.com' } } }),
}));

const execute = vi.fn().mockResolvedValue([{ id: 'n1', title: 'hello from test', createdBy: 'nitej', createdAt: new Date() }]);
vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: () =>
    Promise.resolve({
      connectors: { atlassqldb: { TestNote: { select: () => ({ orderBy: () => ({ first: () => ({ execute }) }) }), create: vi.fn() } } },
    }),
}));

import App from '@/App';

describe('App', () => {
  it('welcomes the signed-in user by first name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome, Nitej' })).toBeInTheDocument();
    expect(screen.getByText('Signed in as nitej.mithinti@bizmetric.com')).toBeInTheDocument();
  });

  it('reads notes back from ATLAS_SQL_DB', async () => {
    render(<App />);
    expect(await screen.findByText('hello from test')).toBeInTheDocument();
  });
});
