import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPool } = vi.hoisted(() => ({ openPool: vi.fn() }));

vi.mock('./sql.js', () => ({
  openPool,
  describeSqlError: (err: unknown) => ({
    number: null,
    message: err instanceof Error ? err.message : String(err),
    hint: null,
  }),
}));

import {
  combineProfileRows,
  emptyProfile,
  loadMyProfile,
  type ProfileRow,
} from './profile.js';

const ID = '11111111-2222-3333-4444-555555555555';
const EMAIL = 'tester.one@example.test';

const NO_FLAGS = {
  can_view: false,
  can_submit_requests: false,
  can_request_edit_business_rules: false,
  can_publish_business_rules: false,
  can_responsible_approve: false,
  can_accountable_approve: false,
  can_manage_admin: false,
};

function row(over: Partial<ProfileRow>): ProfileRow {
  return {
    user_email: EMAIL,
    display_name: 'Tester One',
    is_registered: true,
    role_name: 'GeneralViewer',
    granted_via: 'IMPLICIT',
    group_key: null,
    scope_type: 'ALL_ORCM',
    profit_center_name: null,
    ...NO_FLAGS,
    can_view: true,
    can_submit_requests: true,
    ...over,
  };
}

function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}
const TOKEN = jwt({ sub: `/eid1/c/pub/t/T/a/A/workspaces/W/projects/P/users/${ID}` });

describe('combineProfileRows', () => {
  it('gives a registered person with no assignment the viewer rights only', () => {
    const p = combineProfileRows(ID, EMAIL, 'Tester One', [row({})]);
    expect(p.status).toBe('OK');
    expect(p.roles).toEqual(['GeneralViewer']);
    expect(p.groups).toEqual([]);
    expect(p.canView && p.canSubmitRequests).toBe(true);
    expect(p.canResponsibleApprove).toBe(false);
    expect(p.canAccountableApprove).toBe(false);
    expect(p.canManageAdmin).toBe(false);
    expect(p.responsibleScope).toEqual({ allOrcm: false, profitCenters: [] });
  });

  it('turns a flag on when any row has it, and keeps the stages apart', () => {
    const p = combineProfileRows(ID, EMAIL, 'Tester One', [
      row({}),
      row({
        role_name: 'Operations-IOC',
        granted_via: 'GROUP',
        group_key: 'Operations-IOC-Midland',
        scope_type: 'PROFIT_CENTER_LIST',
        profit_center_name: 'OP RES MB',
        can_responsible_approve: true,
      }),
      row({
        role_name: 'Operations-IOC',
        granted_via: 'GROUP',
        group_key: 'Operations-IOC-Midland',
        scope_type: 'PROFIT_CENTER_LIST',
        profit_center_name: 'OP RES DB TX',
        can_responsible_approve: true,
      }),
      row({
        role_name: 'SAPBusinessSupport',
        granted_via: 'GROUP',
        group_key: 'SAPBusinessSupport',
        scope_type: 'ALL_ORCM',
        can_accountable_approve: true,
        can_publish_business_rules: true,
      }),
      row({ role_name: 'Admin', granted_via: 'USER', can_manage_admin: true }),
    ]);

    expect(p.roles).toEqual(['Admin', 'GeneralViewer', 'Operations-IOC', 'SAPBusinessSupport']);
    expect(p.groups).toEqual(['Operations-IOC-Midland', 'SAPBusinessSupport']);
    expect(p.canResponsibleApprove).toBe(true);
    expect(p.canAccountableApprove).toBe(true);
    expect(p.canPublishRules).toBe(true);
    expect(p.canEditRules).toBe(false);
    expect(p.canManageAdmin).toBe(true);
    // first stage: the two listed profit centres, sorted; second stage: everywhere
    expect(p.responsibleScope).toEqual({ allOrcm: false, profitCenters: ['OP RES DB TX', 'OP RES MB'] });
    expect(p.accountableScope).toEqual({ allOrcm: true, profitCenters: [] });
  });

  it('does not let a profit centre of a non-approving role widen an approval scope', () => {
    const p = combineProfileRows(ID, EMAIL, null, [
      row({ role_name: 'Reader', scope_type: 'PROFIT_CENTER_LIST', profit_center_name: 'OP EOR' }),
      row({
        role_name: 'Approver',
        scope_type: 'PROFIT_CENTER_LIST',
        profit_center_name: 'OP RES MB',
        can_responsible_approve: true,
      }),
    ]);
    expect(p.responsibleScope.profitCenters).toEqual(['OP RES MB']);
  });

  it('accepts bit values that arrive as 0 and 1', () => {
    const p = combineProfileRows(ID, EMAIL, null, [
      row({ can_view: 1, can_submit_requests: 0, can_manage_admin: 1 }),
    ]);
    expect(p.canView).toBe(true);
    expect(p.canSubmitRequests).toBe(false);
    expect(p.canManageAdmin).toBe(true);
  });

  it('returns a profile with nothing allowed when the procedure gave no rows', () => {
    const p = combineProfileRows(ID, EMAIL, 'Tester One', []);
    expect(p).toEqual(emptyProfile('OK', ID, EMAIL, 'Tester One'));
    expect(p.canView).toBe(false);
  });

  it('falls back to the display name on the rows when the identity has none', () => {
    expect(combineProfileRows(ID, EMAIL, null, [row({ display_name: 'From Row' })]).displayName).toBe('From Row');
  });
});

describe('loadMyProfile', () => {
  const executed: string[] = [];

  function poolAnswering(answers: Record<string, unknown[]>) {
    return {
      request: () => {
        const r = {
          input: () => r,
          execute: async (name: string) => {
            executed.push(name);
            return { recordset: answers[name] ?? [] };
          },
        };
        return r;
      },
      close: vi.fn(async () => undefined),
    };
  }

  beforeEach(() => {
    executed.length = 0;
    openPool.mockReset();
  });

  it('answers NOT_AUTHENTICATED without touching the database when the token has no usable id', async () => {
    const getSqlToken = vi.fn(() => 'sql-token');
    const p = await loadMyProfile('garbage', getSqlToken);
    expect(p.status).toBe('NOT_AUTHENTICATED');
    expect(p.userId).toBeNull();
    expect(getSqlToken).not.toHaveBeenCalled();
    expect(openPool).not.toHaveBeenCalled();
  });

  it('answers NOT_REGISTERED with the id, and stops after the first procedure', async () => {
    const pool = poolAnswering({ 'app.usp_identity_resolve': [] });
    openPool.mockResolvedValue(pool);
    const p = await loadMyProfile(TOKEN, () => 'sql-token');
    expect(p.status).toBe('NOT_REGISTERED');
    expect(p.userId).toBe(ID);
    expect(p.email).toBeNull();
    expect(executed).toEqual(['app.usp_identity_resolve']);
    expect(pool.close).toHaveBeenCalled();
  });

  it('resolves the id, then reads the profile of that e-mail', async () => {
    const pool = poolAnswering({
      'app.usp_identity_resolve': [{ user_email: EMAIL, display_name: 'Tester One' }],
      'app.usp_principal_profile': [row({})],
    });
    openPool.mockResolvedValue(pool);
    const p = await loadMyProfile(TOKEN, () => 'sql-token');
    expect(executed).toEqual(['app.usp_identity_resolve', 'app.usp_principal_profile']);
    expect(p).toMatchObject({ status: 'OK', userId: ID, email: EMAIL, displayName: 'Tester One' });
    expect(p.roles).toEqual(['GeneralViewer']);
    expect(pool.close).toHaveBeenCalled();
  });

  it('turns a database failure into an error that names the problem, and still closes the pool', async () => {
    const pool = {
      request: () => ({
        input() { return this; },
        execute: async () => { throw new Error('connection refused'); },
      }),
      close: vi.fn(async () => undefined),
    };
    openPool.mockResolvedValue(pool);
    await expect(loadMyProfile(TOKEN, () => 'sql-token')).rejects.toThrow(/Could not load your profile.*connection refused/);
    expect(pool.close).toHaveBeenCalled();
  });
});
