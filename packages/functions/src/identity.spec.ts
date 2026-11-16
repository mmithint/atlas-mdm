import { describe, expect, it } from 'vitest';

import { callerId, userIdFromSub } from './identity.js';

const ID = '11111111-2222-3333-4444-555555555555';
const SUB = `/eid1/c/pub/t/TENANT/a/APP/workspaces/WS/projects/PROJ/users/${ID}`;

/** A readable token (header.payload.signature) with the given claims. */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.signature`;
}

describe('userIdFromSub', () => {
  it('takes the GUID after /users/ at the end of sub and lower-cases it', () => {
    expect(userIdFromSub(SUB)).toBe(ID);
    expect(userIdFromSub(SUB.toUpperCase().replace('/USERS/', '/users/'))).toBe(ID);
  });

  it('ignores surrounding spaces', () => {
    expect(userIdFromSub(`  ${SUB}  `)).toBe(ID);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a number', 42],
    ['an empty string', ''],
    ['no /users/ part', `/eid1/c/pub/t/T/projects/P/${ID}`],
    ['text that is not a GUID', '/eid1/c/pub/t/T/users/alice'],
    ['a GUID that is too short', '/eid1/users/1111-2222'],
    ['the GUID not at the end', `/eid1/users/${ID}/extra`],
    ['a trailing slash', `/eid1/users/${ID}/`],
  ])('refuses %s', (_label, sub) => {
    expect(userIdFromSub(sub)).toBeNull();
  });
});

describe('callerId', () => {
  it('returns the id of a readable token', () => {
    expect(callerId(jwt({ sub: SUB }))).toEqual({ status: 'OK', id: ID });
  });

  it('is NOT_AUTHENTICATED without a token, with an unreadable one, or without a usable sub', () => {
    expect(callerId(undefined)).toEqual({ status: 'NOT_AUTHENTICATED' });
    expect(callerId('not-a-jwt')).toEqual({ status: 'NOT_AUTHENTICATED' });
    expect(callerId(jwt({ name: 'someone' }))).toEqual({ status: 'NOT_AUTHENTICATED' });
    expect(callerId(jwt({ sub: 'alice' }))).toEqual({ status: 'NOT_AUTHENTICATED' });
  });

  it('never treats an e-mail-looking claim as the identity', () => {
    expect(callerId(jwt({ email: 'someone@example.test' }))).toEqual({
      status: 'NOT_AUTHENTICATED',
    });
  });
});
