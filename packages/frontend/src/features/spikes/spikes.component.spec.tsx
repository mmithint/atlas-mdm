import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { whoAmIInvoke, sqlPingInvoke } = vi.hoisted(() => ({
  whoAmIInvoke: vi.fn(),
  sqlPingInvoke: vi.fn(),
}));

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      whoAmI: { invoke: whoAmIInvoke },
      sqlPing: { invoke: sqlPingInvoke },
    },
  }),
}));

import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';

import { Spikes } from './spikes.component';

describe('Spikes page', () => {
  beforeEach(() => {
    whoAmIInvoke.mockReset();
    sqlPingInvoke.mockReset();
  });

  it('shows both spike buttons and calls nothing until clicked', () => {
    render(<Spikes />);
    expect(screen.getByRole('button', { name: 'Who am I' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'SQL ping' })).toBeEnabled();
    expect(whoAmIInvoke).not.toHaveBeenCalled();
    expect(sqlPingInvoke).not.toHaveBeenCalled();
  });

  it('shows the Who am I result as JSON', async () => {
    whoAmIInvoke.mockResolvedValue({
      tokenKind: 'jwt',
      email: 'someone@example.test',
      claimNames: ['email'],
      claims: {},
    });
    render(<Spikes />);

    fireEvent.click(screen.getByRole('button', { name: 'Who am I' }));

    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('someone@example.test');
    expect(whoAmIInvoke).toHaveBeenCalledTimes(1);
    expect(sqlPingInvoke).not.toHaveBeenCalled();
  });

  it('adds what the browser session knows, without showing its e-mail address', async () => {
    whoAmIInvoke.mockResolvedValue({
      tokenKind: 'jwt',
      email: null,
      claimNames: ['sub'],
      claims: { sub: '/eid1/c/pub/t/T/a/A/workspaces/W/projects/P/users/fake-id-1' },
    });
    const auth = {
      session: {
        user: { id: 'fake-id-1', email: 'browser.person@example.test' },
        isAuthenticated: true,
        isAnonymous: false,
      },
    } as unknown as AuthContextValue;

    render(
      <AuthContext.Provider value={auth}>
        <Spikes />
      </AuthContext.Provider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Who am I' }));

    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('"userIdFoundInTokenSub": true');
    expect(result).toHaveTextContent('"emailPresent": true');
    expect(result).toHaveTextContent('"emailDomain": "example.test"');
    expect(result).not.toHaveTextContent('browser.person');
  });

  it('shows a failed call as an alert and keeps the other spike usable', async () => {
    sqlPingInvoke.mockRejectedValue(new Error('boom'));
    render(<Spikes />);

    fireEvent.click(screen.getByRole('button', { name: 'SQL ping' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The call failed: boom'
    );
    expect(screen.getByRole('button', { name: 'Who am I' })).toBeEnabled();
  });
});
