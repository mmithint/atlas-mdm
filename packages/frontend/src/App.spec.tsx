//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/hooks/auth.context', () => ({
  useAuth: () => ({ session: { user: { id: '1', email: 'nitej.mithinti@bizmetric.com' } } }),
}));

import App from '@/App';

describe('App', () => {
  it('welcomes the signed-in user by first name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome, Nitej' })).toBeInTheDocument();
    expect(screen.getByText('Signed in as nitej.mithinti@bizmetric.com')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<App />);
    expect(screen.getByText('No data is available')).toBeInTheDocument();
  });
});
