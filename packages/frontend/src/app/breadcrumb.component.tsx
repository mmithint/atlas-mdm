import { ChevronRight } from 'lucide-react';

import { hrefFor } from './router';
import { breadcrumbOf, type ScreenId } from './routes';

/**
 * Where this page sits in the header: Home, the list it belongs to, then the page.
 * Every step but the last is a link; the last is the page itself (aria-current).
 */
export function Breadcrumb({ current }: { current: ScreenId }) {
  const trail = breadcrumbOf(current);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-100 text-200 leading-200 text-muted-foreground">
        {trail.map((route, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={route.id} className="flex min-w-0 items-center gap-100">
              {i > 0 ? <ChevronRight aria-hidden="true" className="icon-size-100 shrink-0" /> : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium text-foreground">
                  {route.title}
                </span>
              ) : (
                <a
                  href={hrefFor(route.pattern)}
                  className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {route.title}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
