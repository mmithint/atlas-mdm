/**
 * TEMPORARY (APP-0 spike S1, removed in APP-10).
 *
 * The server token of a function call carries a per-user id inside `sub`
 * (".../users/<id>") but no e-mail. The browser's own session knows the signed-in
 * user's id and e-mail. This compares the two so the spike can show:
 *   - is the id the browser knows the same id the server sees?
 *   - does the browser session have an e-mail at all?
 *
 * The e-mail address itself is never returned, only whether it exists and its
 * domain, so the result is safe to paste.
 */

export interface BrowserIdentity {
  signedIn: boolean;
  /** The id the browser session holds for the user. */
  userId: string | null;
  emailPresent: boolean;
  /** Part after the `@`, for example the tenant's domain. Never the full address. */
  emailDomain: string | null;
  /**
   * True when the token's `sub` ends with `/users/<the browser's id>`.
   * `null` when either side is missing, so there is nothing to compare.
   */
  userIdFoundInTokenSub: boolean | null;
}

export interface BrowserUser {
  id?: string | null;
  email?: string | null;
}

export function compareBrowserIdentity(
  user: BrowserUser | null | undefined,
  tokenSub: string | null | undefined
): BrowserIdentity {
  const userId = user?.id ? user.id : null;
  const email = user?.email ? user.email : null;
  const at = email ? email.lastIndexOf('@') : -1;

  return {
    signedIn: user != null,
    userId,
    emailPresent: email !== null,
    emailDomain: email && at > 0 ? email.slice(at + 1) : null,
    userIdFoundInTokenSub:
      userId && tokenSub
        ? tokenSub.toLowerCase().endsWith(`/users/${userId.toLowerCase()}`)
        : null,
  };
}
