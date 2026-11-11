//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/auth.context', () => ({
  useAuth: () => ({ session: { user: { id: 'u1', email: 'nitej.mithinti@bizmetric.com' } } }),
}));

const execute = vi.fn().mockResolvedValue([{ id: 'n1', title: 'hello from test', createdBy: 'nitej', createdAt: new Date() }]);
const create = vi.fn().mockResolvedValue({});
vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: () =>
    Promise.resolve({
      connectors: { atlassqldb: { TestNote: { select: () => ({ orderBy: () => ({ first: () => ({ execute }) }) }), create: (x: unknown) => create(x) } } },
    }),
}));

import App from '@/App';

describe('App', () => {
  it('welcomes the signed-in user by first name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome, Nitej' })).toBeInTheDocument();
    expect(screen.getByText('Signed in as nitej.mithinti@bizmetric.com')).toBeInTheDocument();
  });

  it('reads comments back from ATLAS_SQL_DB', async () => {
    render(<App />);
    expect(await screen.findByText('hello from test')).toBeInTheDocument();
  });

  it('submits the comment as title, with the signed-in email and the time', async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: '  Heater RB-218 checked  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const row = create.mock.calls[0][0] as { title: string; createdBy: string; createdAt: Date; id: string };
    expect(row.title).toBe('Heater RB-218 checked');
    expect(row.createdBy).toBe('nitej.mithinti@bizmetric.com');
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(await screen.findByText('Saved to ATLAS_SQL_DB.')).toBeInTheDocument();
  });
});
