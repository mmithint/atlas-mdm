import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { isBuilt, matchRoute, ROUTES } from './routes';
import { Screen } from './screens';

const at = (path: string) => ({ path, match: matchRoute(path) }) as Parameters<typeof Screen>[0]['route'];

describe('Screen and the demo preview (FINAL PLAN/11 APP-D)', () => {
  const unbuilt = ROUTES.filter((r) => !isBuilt(r) && r.id !== 'spikes' && !r.pattern.includes(':'));

  it.each(unbuilt.map((r) => [r.pattern, r.builtIn]))('outside the demo, %s shows its placeholder (arrives in %s)', (pattern, phase) => {
    render(<Screen route={at(pattern)} canManageAdmin preview={false} />);
    expect(screen.getByText(phase)).toBeInTheDocument();
    expect(screen.getByText(/not built yet/)).toBeInTheDocument();
  });

  it('the rule page has a route under Rules', () => {
    const m = matchRoute('/rules/HEATER_DUTY');
    expect(m?.route.id).toBe('rule');
    expect(m?.params['id']).toBe('HEATER_DUTY');
  });

  it('admin pages stay closed to non-admins in the demo too', () => {
    render(<Screen route={at('/admin')} canManageAdmin={false} preview />);
    expect(screen.getByText(/do not have access/)).toBeInTheDocument();
  });
});
