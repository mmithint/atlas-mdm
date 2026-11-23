import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openPool } = vi.hoisted(() => ({ openPool: vi.fn() }));

vi.mock('./sql.js', () => ({
  openPool,
  describeSqlError: (err: unknown) => ({
    number: (err as { number?: number } | null)?.number ?? null,
    message: err instanceof Error ? err.message : String(err),
    hint: null,
  }),
}));

import { runDeleteSavedView, runListSavedViews, runSaveView } from './saved-views.js';

const ID = '11111111-2222-3333-4444-555555555555';
function jwt(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}
const TOKEN = jwt({ sub: `/eid1/c/pub/t/T/a/A/workspaces/W/projects/P/users/${ID}` });
const getSqlToken = () => 'sql-token';
const EMAIL = 'real.person@example.test';

interface Call {
  proc: string;
  inputs: Record<string, unknown>;
}

/** A stand-in for a connection pool; `answers` maps a procedure to its result or to an Error to throw. */
function makePool(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const all: Record<string, unknown> = { 'app.usp_identity_resolve': { recordset: [{ user_email: EMAIL }] }, ...answers };
  const pool = {
    request() {
      const inputs: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return req;
        },
        async execute(proc: string) {
          calls.push({ proc, inputs });
          const answer = all[proc];
          if (answer instanceof Error) throw answer;
          if (answer === undefined) throw new Error(`no answer set for ${proc}`);
          return answer;
        },
      };
      return req;
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
  openPool.mockResolvedValue(pool);
  return calls;
}

const refusal = (number: number, message: string) => Object.assign(new Error(message), { number });
const business = (calls: Call[]) => calls.filter((c) => c.proc !== 'app.usp_identity_resolve');

const ROW = {
  saved_view_id: 7,
  view_name: 'Carlsbad line heaters',
  definition_json: '{"v":1}',
  is_default: false,
  updated_at_utc: new Date('2026-11-23T10:00:00.000Z'),
};

describe('saved filters (saved views)', () => {
  beforeEach(() => openPool.mockReset());

  it('lists the caller own views for a screen, with the owner taken from the token', async () => {
    const calls = makePool({ 'app.usp_saved_view_list': { recordset: [ROW] } });
    const answer = await runListSavedViews('s-4', TOKEN, getSqlToken);
    expect(answer.status).toBe('OK');
    expect(answer.views).toEqual([
      { savedViewId: 7, viewName: 'Carlsbad line heaters', definitionJson: '{"v":1}', isDefault: false, updatedAtUtc: '2026-11-23T10:00:00.000Z' },
    ]);
    expect(business(calls)).toEqual([{ proc: 'app.usp_saved_view_list', inputs: { actor_email: EMAIL, screen_code: 'S-4' } }]);
  });

  it('refuses an unknown screen before calling the database', async () => {
    const answer = await runListSavedViews('S-9', TOKEN, getSqlToken);
    expect(answer).toMatchObject({ ok: false, status: 'INVALID', views: [] });
    expect(openPool).not.toHaveBeenCalled();
  });

  it('saves under a trimmed name and says whether it replaced one', async () => {
    const calls = makePool({ 'app.usp_saved_view_save': { recordset: [{ ...ROW, outcome: 'REPLACED' }] } });
    const answer = await runSaveView({ screenCode: 'S-4', viewName: '  Carlsbad line heaters ', definitionJson: '{"v":1}' }, TOKEN, getSqlToken);
    expect(answer).toMatchObject({ ok: true, outcome: 'REPLACED', view: { savedViewId: 7 } });
    expect(business(calls)[0]?.inputs).toMatchObject({ actor_email: EMAIL, screen_code: 'S-4', view_name: 'Carlsbad line heaters' });
  });

  it('refuses a blank name and an over-long definition without calling the database', async () => {
    expect((await runSaveView({ screenCode: 'S-4', viewName: '  ', definitionJson: '{}' }, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect((await runSaveView({ screenCode: 'S-4', viewName: 'x', definitionJson: 'x'.repeat(4001) }, TOKEN, getSqlToken)).status).toBe('INVALID');
    expect(openPool).not.toHaveBeenCalled();
  });

  it('passes a procedure refusal on in its own words', async () => {
    makePool({ 'app.usp_saved_view_save': refusal(50345, 'You already have 50 saved filters on this screen. Delete one to save another.') });
    const answer = await runSaveView({ screenCode: 'S-4', viewName: 'One more', definitionJson: '{}' }, TOKEN, getSqlToken);
    expect(answer).toMatchObject({ ok: false, status: 'REFUSED', errorCode: 50345, view: null, outcome: null });
  });

  it('deletes one of the caller views by number', async () => {
    const calls = makePool({ 'app.usp_saved_view_delete': { recordset: [{ saved_view_id: 7 }] } });
    const answer = await runDeleteSavedView(7, TOKEN, getSqlToken);
    expect(answer).toMatchObject({ ok: true, savedViewId: 7 });
    expect(business(calls)[0]).toEqual({ proc: 'app.usp_saved_view_delete', inputs: { actor_email: EMAIL, saved_view_id: 7 } });
  });

  it('answers NOT_AUTHENTICATED without a token', async () => {
    expect((await runDeleteSavedView(7, null, getSqlToken)).status).toBe('NOT_AUTHENTICATED');
  });
});
