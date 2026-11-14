import { describe, expect, it } from 'vitest';

import { compareBrowserIdentity } from './browser-identity';

// All values are made up.
const SUB = '/eid1/c/pub/t/TENANT/a/APP/workspaces/WS/projects/PRJ/users/AAAA-1111';

describe('compareBrowserIdentity', () => {
  it('reports a match when the token sub ends with the browser user id', () => {
    const r = compareBrowserIdentity(
      { id: 'aaaa-1111', email: 'someone@example.test' },
      SUB
    );
    expect(r).toEqual({
      signedIn: true,
      userId: 'aaaa-1111',
      emailPresent: true,
      emailDomain: 'example.test',
      userIdFoundInTokenSub: true,
    });
  });

  it('reports a mismatch when the ids differ', () => {
    const r = compareBrowserIdentity({ id: 'bbbb-2222', email: 'a@example.test' }, SUB);
    expect(r.userIdFoundInTokenSub).toBe(false);
  });

  it('does not match an id that only appears in the middle of the sub', () => {
    const r = compareBrowserIdentity({ id: 'WS', email: 'a@example.test' }, SUB);
    expect(r.userIdFoundInTokenSub).toBe(false);
  });

  it('never returns the e-mail address, only its domain', () => {
    const r = compareBrowserIdentity({ id: 'x', email: 'someone@example.test' }, SUB);
    expect(JSON.stringify(r)).not.toContain('someone');
  });

  it('handles a missing e-mail, a missing user and a missing sub', () => {
    expect(compareBrowserIdentity({ id: 'aaaa-1111', email: '' }, SUB)).toMatchObject({
      signedIn: true,
      emailPresent: false,
      emailDomain: null,
    });
    expect(compareBrowserIdentity(null, SUB)).toEqual({
      signedIn: false,
      userId: null,
      emailPresent: false,
      emailDomain: null,
      userIdFoundInTokenSub: null,
    });
    expect(
      compareBrowserIdentity({ id: 'aaaa-1111', email: 'a@example.test' }, undefined)
        .userIdFoundInTokenSub
    ).toBeNull();
  });
});
