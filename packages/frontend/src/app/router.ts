/**
 * Hash-address helpers: read the address, build links, move to another page.
 * The route table is in `routes.ts`.
 */

export interface HashLocation {
  /** `/equipment/12` (always starts with `/`, no trailing slash except the root). */
  path: string;
  query: URLSearchParams;
}

/** Reads `#/equipment/12?field=tag` into a path and a query. Garbage becomes the root. */
export function parseHash(hash: string): HashLocation {
  const body = hash.replace(/^#/, '');
  const cut = body.indexOf('?');
  const rawPath = cut === -1 ? body : body.slice(0, cut);
  const rawQuery = cut === -1 ? '' : body.slice(cut + 1);
  const clean = rawPath.replace(/\/+$/, '');
  const path = clean === '' ? '/' : clean.startsWith('/') ? clean : `/${clean}`;
  return { path, query: new URLSearchParams(rawQuery) };
}

/** Builds a link target for `<a href>`; empty and undefined query values are left out. */
export function hrefFor(
  path: string,
  query?: Record<string, string | number | null | undefined>
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && String(value) !== '') {
      params.set(key, String(value));
    }
  }
  const text = params.toString();
  return `#${path}${text ? `?${text}` : ''}`;
}

/** Moves to another page; `replace` swaps the history entry instead of adding one. */
export function navigate(
  path: string,
  query?: Record<string, string | number | null | undefined>,
  options: { replace?: boolean } = {}
): void {
  const target = hrefFor(path, query);
  if (options.replace) {
    window.history.replaceState(null, '', target);
    // replaceState does not fire `hashchange`; tell the listeners ourselves.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target.slice(1);
  }
}
