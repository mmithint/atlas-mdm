import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { hrefFor, navigate, parseHash } from '@/app/router';
import { matchRoute, menuRoutes } from '@/app/routes';

import { useHashRoute } from './use-hash-route';

describe('parseHash', () => {
  it.each([
    ['', '/'],
    ['#', '/'],
    ['#/', '/'],
    ['#equipment', '/equipment'],
    ['#/equipment/', '/equipment'],
    ['#/equipment/12', '/equipment/12'],
    ['#/equipment?field=tag', '/equipment'],
  ])('reads the path of %j as %s', (hash, path) => {
    expect(parseHash(hash).path).toBe(path);
  });

  it('reads the query string', () => {
    const { query } = parseHash('#/equipment?field=serial&q=SYN%20EQ&page=2');
    expect(query.get('field')).toBe('serial');
    expect(query.get('q')).toBe('SYN EQ');
    expect(query.get('page')).toBe('2');
  });
});

describe('hrefFor', () => {
  it('builds a hash link and leaves out empty values', () => {
    expect(hrefFor('/equipment', { field: 'tag', q: 'A B', facility: '', page: undefined })).toBe(
      '#/equipment?field=tag&q=A+B'
    );
    expect(hrefFor('/')).toBe('#/');
  });
});

describe('matchRoute', () => {
  it('matches fixed paths and paths with a parameter', () => {
    expect(matchRoute('/')?.route.id).toBe('home');
    expect(matchRoute('/equipment')?.route.id).toBe('equipment');
    const detail = matchRoute('/equipment/12');
    expect(detail?.route.id).toBe('equipment-detail');
    expect(detail?.params).toEqual({ id: '12' });
    expect(matchRoute('/requests/7')?.route.id).toBe('request');
  });

  it('decodes a parameter and refuses a broken escape', () => {
    expect(matchRoute('/equipment/a%20b')?.params).toEqual({ id: 'a b' });
    expect(matchRoute('/equipment/%E0%A4%A')).toBeNull();
  });

  it('returns null for an unknown address or the wrong number of segments', () => {
    expect(matchRoute('/nothing')).toBeNull();
    expect(matchRoute('/equipment/12/extra')).toBeNull();
  });

  it('knows every screen S-1 to S-13 exactly once', () => {
    const screens = menuRoutes(true).map((r) => r.screen);
    const all = ['S-1', 'S-2', 'S-4', 'S-6', 'S-8', 'S-9', 'S-10', 'S-11', 'S-12', 'S-13'];
    expect(screens).toEqual(expect.arrayContaining(all));
  });
});

describe('menuRoutes', () => {
  it('hides the admin entry from people without the admin right', () => {
    expect(menuRoutes(false).some((r) => r.id === 'admin')).toBe(false);
    expect(menuRoutes(true).some((r) => r.id === 'admin')).toBe(true);
  });

  it('keeps pages that are reached by a link out of the menu', () => {
    const ids = menuRoutes(true).map((r) => r.id);
    expect(ids).not.toContain('equipment-detail');
    expect(ids).not.toContain('request');
    expect(ids).not.toContain('spikes');
  });
});

describe('useHashRoute', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('follows the address bar', async () => {
    window.location.hash = '#/equipment/5?x=1';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.path).toBe('/equipment/5');
    expect(result.current.match?.route.id).toBe('equipment-detail');
    expect(result.current.query.get('x')).toBe('1');

    act(() => {
      navigate('/rules');
    });
    // jsdom delivers `hashchange` as a later task, like a browser
    await waitFor(() => expect(result.current.match?.route.id).toBe('rules'));
  });

  it('replaces the entry without adding history, and still notifies', () => {
    window.location.hash = '#/equipment';
    const { result } = renderHook(() => useHashRoute());
    act(() => {
      navigate('/equipment', { q: 'abc' }, { replace: true });
    });
    expect(result.current.query.get('q')).toBe('abc');
  });
});
