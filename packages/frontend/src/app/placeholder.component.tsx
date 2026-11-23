import { hrefFor } from './router';
import type { RouteDef } from './routes';
import { badge, button, card } from '@/components/ui';

/**
 * A screen a later phase builds. It says what the screen is for and when it arrives, and
 * never shows invented figures (design rule: the shell stays honest).
 */
export function Placeholder({ route }: { route: RouteDef }) {
  return (
    <div className="space-y-400">
      <header className="flex flex-wrap items-center gap-300">
        <h1 className="text-600 font-semibold">{route.title}</h1>
        {route.screen ? <span className={badge.neutral}>{route.screen}</span> : null}
      </header>
      <section className={`${card} max-w-2xl p-600`} aria-label="Not built yet">
        <p className="text-400">{route.summary}</p>
        <p className="mt-300 text-300 text-muted-foreground">
          This screen is not built yet. It arrives in <strong>{route.builtIn}</strong>.
        </p>
        <a
          className={`${button.secondary} mt-400`}
          href={hrefFor('/equipment')}
        >
          Find a heater meanwhile
        </a>
      </section>
    </div>
  );
}

export function NotFound({ path }: { path: string }) {
  return (
    <div className="space-y-400">
      <h1 className="text-600 font-semibold">Page not found</h1>
      <section className={`${card} max-w-2xl p-600`}>
        <p className="text-300 text-muted-foreground">
          There is no page at <span className="id-plate">{path}</span>.
        </p>
        <a className={`${button.primary} mt-400`} href={hrefFor('/')}>
          Go to the home page
        </a>
      </section>
    </div>
  );
}

export function NoAccess({ route }: { route: RouteDef }) {
  return (
    <div className="space-y-400">
      <h1 className="text-600 font-semibold">{route.title}</h1>
      <section className={`${card} max-w-2xl p-600`} role="alert">
        <p className="text-400">You do not have access to this screen.</p>
        <p className="mt-200 text-300 text-muted-foreground">
          It is for administrators. If you need it, ask an administrator to give your account the admin right.
        </p>
      </section>
    </div>
  );
}
