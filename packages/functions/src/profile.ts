/**
 * `getMyProfile`: who is signed in, and what may they do (APP-2).
 *
 * Two small reads, in the order FINAL PLAN/01 section 6.8 prescribes:
 *   1. app.usp_identity_resolve @external_id  token user id -> e-mail (no row = not registered)
 *   2. app.usp_principal_profile @email       one row per role x profit centre
 * then the rows are folded into one answer for the screen. Nothing is written.
 *
 * What this is for: showing the right menu and the user's name and roles, and (APP-4)
 * greying a button with a reason. It decides nothing: whether a person may really
 * approve, publish or administer is checked again, on the server, by the procedure
 * that does the work (decision D-03). So folding the rows here is presentation.
 *
 * Folding rule (`usp_principal_profile` header): a flag is on when it is on in ANY row;
 * an approval stage covers the profit centres of the rows that carry that stage's flag,
 * or every profit centre when one of those rows has the scope ALL_ORCM.
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

import { callerId } from './identity.js';
import { describeSqlError, openPool } from './sql.js';

/** One row of `app.usp_principal_profile` (bit columns arrive as booleans). */
export interface ProfileRow {
  user_email: string | null;
  display_name: string | null;
  is_registered: boolean | number | null;
  role_name: string | null;
  granted_via: string | null;
  group_key: string | null;
  scope_type: string | null;
  profit_center_name: string | null;
  can_view: boolean | number | null;
  can_submit_requests: boolean | number | null;
  can_request_edit_business_rules: boolean | number | null;
  can_publish_business_rules: boolean | number | null;
  can_responsible_approve: boolean | number | null;
  can_accountable_approve: boolean | number | null;
  can_manage_admin: boolean | number | null;
}

/** Which profit centres an approval stage covers. */
export interface StageScope {
  /** True when the person may act for every ORCM profit centre. */
  allOrcm: boolean;
  /** The profit centres of an explicit list (empty when `allOrcm` or no scope). */
  profitCenters: string[];
}

export interface MyProfile {
  /** OK; NOT_REGISTERED = the id is valid but no admin has linked it to an e-mail; NOT_AUTHENTICATED = no usable id in the token. */
  status: 'OK' | 'NOT_REGISTERED' | 'NOT_AUTHENTICATED';
  /** The caller's own user id from the token (shown to them so an admin can bind it); null when unreadable. */
  userId: string | null;
  email: string | null;
  displayName: string | null;
  /** Distinct role names, sorted. */
  roles: string[];
  /** Distinct groups the roles come through, sorted. */
  groups: string[];
  canView: boolean;
  canSubmitRequests: boolean;
  /** May create and edit rule drafts. */
  canEditRules: boolean;
  canPublishRules: boolean;
  canResponsibleApprove: boolean;
  canAccountableApprove: boolean;
  canManageAdmin: boolean;
  responsibleScope: StageScope;
  accountableScope: StageScope;
}

const on = (value: boolean | number | null | undefined): boolean =>
  value === true || value === 1;

const sortedUnique = (values: Iterable<string>): string[] =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** A profile with nothing allowed: the answer for anyone who is not registered. */
export function emptyProfile(
  status: MyProfile['status'],
  userId: string | null,
  email: string | null = null,
  displayName: string | null = null
): MyProfile {
  return {
    status,
    userId,
    email,
    displayName,
    roles: [],
    groups: [],
    canView: false,
    canSubmitRequests: false,
    canEditRules: false,
    canPublishRules: false,
    canResponsibleApprove: false,
    canAccountableApprove: false,
    canManageAdmin: false,
    responsibleScope: { allOrcm: false, profitCenters: [] },
    accountableScope: { allOrcm: false, profitCenters: [] },
  };
}

function stageScope(
  rows: readonly ProfileRow[],
  flag: (row: ProfileRow) => boolean
): StageScope {
  const carrying = rows.filter(flag);
  const allOrcm = carrying.some((row) => row.scope_type === 'ALL_ORCM');
  const centres = allOrcm
    ? []
    : sortedUnique(
        carrying.flatMap((row) =>
          row.profit_center_name ? [row.profit_center_name] : []
        )
      );
  return { allOrcm, profitCenters: centres };
}

/** Folds the rows of `app.usp_principal_profile` into one profile (see the header). */
export function combineProfileRows(
  userId: string,
  email: string,
  displayName: string | null,
  rows: readonly ProfileRow[]
): MyProfile {
  const base = emptyProfile('OK', userId, email, displayName);
  if (rows.length === 0) return base;

  return {
    ...base,
    displayName: displayName ?? rows[0]?.display_name ?? null,
    roles: sortedUnique(rows.flatMap((r) => (r.role_name ? [r.role_name] : []))),
    groups: sortedUnique(
      rows.flatMap((r) =>
        r.granted_via === 'GROUP' && r.group_key ? [r.group_key] : []
      )
    ),
    canView: rows.some((r) => on(r.can_view)),
    canSubmitRequests: rows.some((r) => on(r.can_submit_requests)),
    canEditRules: rows.some((r) => on(r.can_request_edit_business_rules)),
    canPublishRules: rows.some((r) => on(r.can_publish_business_rules)),
    canResponsibleApprove: rows.some((r) => on(r.can_responsible_approve)),
    canAccountableApprove: rows.some((r) => on(r.can_accountable_approve)),
    canManageAdmin: rows.some((r) => on(r.can_manage_admin)),
    responsibleScope: stageScope(rows, (r) => on(r.can_responsible_approve)),
    accountableScope: stageScope(rows, (r) => on(r.can_accountable_approve)),
  };
}

/** The whole function: identity, two procedure calls, one answer. */
export async function loadMyProfile(
  accessToken: string | null | undefined,
  getSqlToken: () => string
): Promise<MyProfile> {
  const caller = callerId(accessToken);
  if (caller.status !== 'OK') return emptyProfile('NOT_AUTHENTICATED', null);

  let token: string | undefined;
  let pool: ConnectionPool | undefined;
  try {
    token = getSqlToken();
    pool = await openPool(token);

    const who = await pool
      .request()
      .input('external_id', sql.NVarChar(64), caller.id)
      .execute<{ user_email: string; display_name: string | null }>(
        'app.usp_identity_resolve'
      );
    const person = who.recordset[0];
    if (!person?.user_email) return emptyProfile('NOT_REGISTERED', caller.id);

    const rows = await pool
      .request()
      .input('email', sql.NVarChar(256), person.user_email)
      .execute<ProfileRow>('app.usp_principal_profile');

    // Names only in the log: an e-mail address or an id is personal data.
    console.log(`getMyProfile: registered, ${rows.recordset.length} profile row(s)`);
    return combineProfileRows(
      caller.id,
      person.user_email,
      person.display_name,
      rows.recordset
    );
  } catch (err) {
    const info = describeSqlError(err, token);
    console.error(`getMyProfile failed: ${info.number ?? 'no number'}: ${info.message}`);
    throw new Error(
      `Could not load your profile (${info.number ?? 'no error number'}): ${info.message}${info.hint ? ` ${info.hint}` : ''}`
    );
  } finally {
    if (pool) await pool.close().catch(() => undefined);
  }
}
