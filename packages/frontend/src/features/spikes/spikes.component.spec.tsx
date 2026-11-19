import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { whoAmIInvoke, sqlPingInvoke, storageProbeInvoke, searchInvoke, detailInvoke, createInvoke, checksInvoke, decideInvoke } = vi.hoisted(() => ({
  whoAmIInvoke: vi.fn(),
  sqlPingInvoke: vi.fn(),
  storageProbeInvoke: vi.fn(),
  searchInvoke: vi.fn(),
  detailInvoke: vi.fn(),
  createInvoke: vi.fn(),
  checksInvoke: vi.fn(),
  decideInvoke: vi.fn(),
}));

vi.mock('@/lib/rayfin-client', () => ({
  getRayfinClient: async () => ({
    functions: {
      whoAmI: { invoke: whoAmIInvoke },
      sqlPing: { invoke: sqlPingInvoke },
      storageProbe: { invoke: storageProbeInvoke },
      searchEquipment: { invoke: searchInvoke },
      getEquipmentDetail: { invoke: detailInvoke },
      createChangeRequest: { invoke: createInvoke },
      getRequestChecks: { invoke: checksInvoke },
      decideRequest: { invoke: decideInvoke },
    },
  }),
}));

import { AuthContext, type AuthContextValue } from '@/hooks/auth.context';

import { Spikes } from './spikes.component';

describe('Spikes page', () => {
  beforeEach(() => {
    whoAmIInvoke.mockReset();
    sqlPingInvoke.mockReset();
    storageProbeInvoke.mockReset();
    searchInvoke.mockReset();
    detailInvoke.mockReset();
    createInvoke.mockReset();
    checksInvoke.mockReset();
    decideInvoke.mockReset();
  });

  it('shows every spike button and calls nothing until clicked', () => {
    render(<Spikes />);
    for (const name of ['Who am I', 'SQL ping', 'Run timing test', 'Run OneLake test', 'Create test request']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    // no request number yet: nothing to check or decide
    expect(screen.getByRole('button', { name: 'Show checks' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decide request' })).toBeDisabled();
    expect(createInvoke).not.toHaveBeenCalled();
    expect(checksInvoke).not.toHaveBeenCalled();
    expect(decideInvoke).not.toHaveBeenCalled();
    expect(whoAmIInvoke).not.toHaveBeenCalled();
    expect(sqlPingInvoke).not.toHaveBeenCalled();
    expect(storageProbeInvoke).not.toHaveBeenCalled();
    expect(searchInvoke).not.toHaveBeenCalled();
    expect(detailInvoke).not.toHaveBeenCalled();
  });

  it('times the read functions (the latency gate) page by page and shows counts and timings only', async () => {
    const total = 250;
    const timing = { connectMs: 40, queryMs: 20, totalMs: 65 };
    searchInvoke.mockImplementation(async (args: { mode: string; offset: number; pageSize: number }) => {
      if (args.mode === 'MATCH') {
        return { rows: Array.from({ length: 8 }, (_, i) => ({ equipmentId: i + 1 })), totalMatches: 8, hasMore: false, truncated: false, timing, error: null };
      }
      const start = args.offset;
      const end = Math.min(total, start + args.pageSize);
      return {
        rows: Array.from({ length: end - start }, (_, i) => ({ equipmentId: start + i + 1 })),
        totalMatches: total,
        hasMore: end < total,
        truncated: false,
        timing,
        error: null,
      };
    });
    detailInvoke.mockResolvedValue({ found: true, heater: {}, floc: null, fieldValues: [], ownership: [], timing, error: null });

    render(<Spikes />);
    fireEvent.click(screen.getByRole('button', { name: 'Run timing test' }));

    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('"ok": true');
    expect(result).toHaveTextContent('"rows": 250');
    expect(result).toHaveTextContent('"pages": 3');
    expect(result).toHaveTextContent('"duplicateKeys": 0');
    expect(result).toHaveTextContent('"stopped": "last page"');
    expect(result).toHaveTextContent('"detailFound": true');
    expect(result).toHaveTextContent('"firstPageServerMs": 65');
    expect(detailInvoke).toHaveBeenCalledTimes(1);
    // the pages were read by offset, 100 rows per call
    const paging = searchInvoke.mock.calls.map((c) => c[0]).filter((a) => a.mode === 'SORTED' && a.searchText === '' && a.pageSize === 100);
    expect(paging.map((a) => a.offset)).toEqual([0, 100, 200]);
  });

  it('shows the function\'s own error text when the detail read fails (the platform hides thrown messages)', async () => {
    const timing = { connectMs: 0, queryMs: 0, totalMs: 5 };
    searchInvoke.mockResolvedValue({ rows: [{ equipmentId: 1 }], totalMatches: 1, hasMore: false, truncated: false, timing, error: null });
    detailInvoke.mockResolvedValue({ found: false, heater: null, floc: null, fieldValues: [], ownership: [], timing, error: 'Could not read the equipment (229): permission denied.' });

    render(<Spikes />);
    fireEvent.click(screen.getByRole('button', { name: 'Run timing test' }));

    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('"ok": false');
    expect(result).toHaveTextContent('permission denied');
    expect(result).toHaveTextContent('the browser sent equipmentId as number 1');
  });

  it('APP-3 scratch card: creates a request from the heater\'s current value without sending any e-mail, then fills in the request number', async () => {
    detailInvoke.mockResolvedValue({ found: true, heater: { manufacturer: 'SYNTHETIC MFR A' }, floc: null, fieldValues: [], ownership: [], timing: { connectMs: 0, queryMs: 0, totalMs: 1 }, error: null });
    createInvoke.mockResolvedValue({ ok: true, status: 'OK', error: null, requestId: 77, requestRef: 'CR-000077', outcome: 'CREATED' });

    render(<Spikes />);
    fireEvent.change(screen.getByLabelText('Heater id'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create test request' }));

    const result = await screen.findByText(/CR-000077/);
    expect(result).toBeInTheDocument();
    expect(detailInvoke).toHaveBeenCalledWith({ equipmentId: 5 });
    const sent = createInvoke.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({ source: 'MANUAL', entityType: 'EQUIPMENT', equipmentId: 5, fieldCode: 'MANUFACTURER', oldValue: 'SYNTHETIC MFR A' });
    expect(String(sent['newValue'])).toMatch(/^SCRATCH \d{6}$/);
    expect(Object.keys(sent).some((k) => /mail|user|actor|requestedBy/i.test(k))).toBe(false);
    // the new number is offered to the other buttons
    expect(screen.getByLabelText('Request number')).toHaveValue('77');
    expect(screen.getByRole('button', { name: 'Show checks' })).toBeEnabled();
  });

  it('APP-3 scratch card: shows the checks and sends the decision with the comment', async () => {
    checksInvoke.mockResolvedValue({ ok: true, status: 'OK', checks: [{ code: 'OLD_VALUE_CURRENT', checkStatus: 'PASS' }] });
    decideInvoke.mockResolvedValue({ ok: false, status: 'REFUSED', errorCode: 50141, error: 'You are not an active member of the group for this stage (X).' });

    render(<Spikes />);
    fireEvent.change(screen.getByLabelText('Request number'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show checks' }));
    expect(await screen.findByText(/OLD_VALUE_CURRENT/)).toBeInTheDocument();
    expect(checksInvoke).toHaveBeenCalledWith({ requestId: 9 });

    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'RETURN' } });
    fireEvent.change(screen.getByLabelText('Comment (needed to reject or return)'), { target: { value: 'check the nameplate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Decide request' }));
    expect(await screen.findByText(/not an active member/)).toBeInTheDocument();
    expect(decideInvoke).toHaveBeenCalledWith({ requestId: 9, decision: 'RETURN', comment: 'check the nameplate', expectedStatus: '', returnTo: '' });
  });

  it('APP-3 scratch card: says so when the heater does not exist, without creating anything', async () => {
    detailInvoke.mockResolvedValue({ found: false, heater: null, floc: null, fieldValues: [], ownership: [], timing: { connectMs: 0, queryMs: 0, totalMs: 1 }, error: null });
    render(<Spikes />);
    fireEvent.change(screen.getByLabelText('Heater id'), { target: { value: '999999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create test request' }));
    expect(await screen.findByText(/was not found/)).toBeInTheDocument();
    expect(createInvoke).not.toHaveBeenCalled();
  });

  it('runs the OneLake probe (S4) only when asked and shows its answer', async () => {
    storageProbeInvoke.mockResolvedValue({ ok: false, step: 'create', path: 'ATLAS/ATLAS_LH.Lakehouse/Files/photos/_probe/x', httpStatus: 403, readBackMatches: null, totalMs: 120, error: 'Forbidden (403).' });
    render(<Spikes />);
    fireEvent.click(screen.getByRole('button', { name: 'Run OneLake test' }));
    const result = await screen.findByRole('status');
    expect(result).toHaveTextContent('"httpStatus": 403');
    expect(storageProbeInvoke).toHaveBeenCalledTimes(1);
    expect(whoAmIInvoke).not.toHaveBeenCalled();
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
