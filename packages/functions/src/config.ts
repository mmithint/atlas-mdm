/**
 * Where the functions find the ATLAS SQL database.
 *
 * Identifiers only, no secrets. The access token comes from `ctx.Tokens.Sql` at
 * run time. Values come from the environment register (`FINAL PLAN/01` §8 in the
 * project folder) and `rayfin/rayfin.yml`.
 *
 * Fabric names the real database `<display name>-<database item id>`; the item
 * id is the connector's `itemId` in `rayfin/rayfin.yml`. Spike S2 (`sqlPing`)
 * proves the pair by returning `DB_NAME()`.
 */

/** `serverFqdn` as Fabric shows it (host, comma, port). Split in `sql.ts`. */
export const SQL_SERVER_FQDN =
  'vm2n6jcyunrexoqu4xp3io45mm-zasitelkuwuudmp662742b6dyu.database.fabric.microsoft.com,1433';

/** "Initial Catalog" from SQL database > Settings > Connection strings. */
export const SQL_DATABASE = 'ATLAS_SQL_DB-a832d11c-c075-46a5-95c5-8473cff8bf44';

/**
 * OneLake, for the photo-storage probe (spike S4, `storage.ts`). Display names, as
 * in the environment register (`FINAL PLAN/01` section 8): workspace `ATLAS`,
 * lakehouse `ATLAS_LH`. OneLake accepts names in both places; it does not reliably
 * accept a name in one and an id in the other. If the probe answers 404, switch both
 * to ids (workspace id and lakehouse item id from the portal URLs).
 */
export const ONELAKE_WORKSPACE = 'ATLAS';
export const ONELAKE_LAKEHOUSE_ITEM = 'ATLAS_LH.Lakehouse';

/**
 * OxyGPT, the client's internal AI service (spike S5, `oxygpt.ts`). Identifiers and limits only: the API key is NOT
 * here, it is the secret `OXY_GPT_API_KEY`, which the project team set in Fabric (RB-06).
 *
 * `baseUrl`   the documented development address (Getting Started guide; the client gave the same one). Confirm the
 *             production address with Ops AI before the app goes live. Fixed here on purpose: no browser input can
 *             change where the key is sent.
 * `modelId`   only a FALLBACK for the agent's ID. The ID is normally read from the secret `OXYGPT_AGENT_MODEL_ID`
 *             (the exact ID OxyGPT prints; Secure guide 4.5: never guess one from a display name), which wins when
 *             it is set. Not a secret either way. With neither set, the text test answers NOT_CONFIGURED.
 * Timeouts are per request. A Fabric function is stopped at 250 s (Rayfin guide `invoking-from-frontend.md`), so the
 * longest wait stays well below it and a slow agent shows up as TIMEOUT instead of as a platform error.
 *
 * The `agent` values are for the saved-chat flow (`oxygpt-agent.ts`): many short requests instead of one long one.
 * `agentTotalMs` is the whole call, from the first line of the function; the wait for the agent ends
 * `agentCleanupMs` earlier, so there is still time to delete the chat before Fabric's 250 s limit.
 */
export const OXYGPT = {
  // The documented API address: the client's script (`oxy_agent.py` line 176), the Getting Started examples and the
  // Secure guide (4.3, 4.4) all use it. `https://chat.oxy.com` was tried on 18 Nov only as a diagnostic (it resolves
  // from Fabric but answers 404 on every path, so it is not the API address).
  baseUrl: 'https://ai-dev.oxy.com',
  modelId: '',
  listTimeoutMs: 20_000,
  textTimeoutMs: 150_000,
  agentStepTimeoutMs: 20_000,
  agentStartTimeoutMs: 30_000,
  agentTotalMs: 220_000,
  agentCleanupMs: 15_000,
  agentPollMs: 1_000,
  /** Longest question the test accepts (characters). */
  maxPromptChars: 500,
  /** Longest answer returned to the page (characters); the rest is cut and the result says so. */
  maxReplyChars: 4_000,
} as const;

/**
 * Verifying the invocation token's signature (spike S8, decision D-19, `FINAL PLAN/01` section 6.8; code in
 * `tokenverify.ts`). Identifiers only, no secrets.
 *
 * `mode`
 *   report   verify and log, but still accept the token (how it shipped, until S8 run 2 had passed).
 *   enforce  a token that does not verify is NOT_AUTHENTICATED. Needs `rayfinEndpoint` and all three pins.
 *
 * `rayfinEndpoint`  base URL of THIS app's Rayfin service, where the signing keys are published
 *   (`<url>/.well-known/jwks.json`). Pinned here on purpose: the endpoint in the request travels beside the
 *   token, so a forger could name their own. Copy it from `tokenCheck.requestEndpoint` in the S8 result.
 * `issuer`, `audience`, `subScope`  pins on the token's `iss`, `aud` and the part of `sub` before `/users/<id>`
 *   (tenant, app, workspace, project). The signing keys are the identity provider's, not this app's, so the
 *   signature alone does not say a token was issued for this app: these pins do. Fill from the S8 result
 *   (never paste a user id here: `subScope` stops before `/users/`).
 *
 * Pinned from the first S8 run (17 Nov 2026). The second run showed `VALID` with these pins on the deployed app (real
 * token, real key set, tamper probe refused), and `mode` was switched to `enforce` the same day. To go back at once
 * if real users are refused ("You are not signed in" while signed in): set `mode: 'report'` and deploy.
 *
 * If the app item is ever recreated (a redeploy under a new item), its endpoint and `subScope` change: update
 * them here, or every call is refused in `enforce` mode.
 */
export type TokenCheckMode = 'report' | 'enforce';

export interface TokenCheckConfig {
  readonly mode: TokenCheckMode;
  readonly rayfinEndpoint: string;
  readonly issuer: string;
  readonly audience: string;
  readonly subScope: string;
}

export const TOKEN_CHECK: TokenCheckConfig = {
  mode: 'enforce',
  rayfinEndpoint:
    'https://northcentralus.pbidedicated.windows.net/v1/tenants/24df34ab-a358-4b62-ba14-e5dfb43b9d63/workspaces/918924c8-a56a-41a9-b1fe-f6bfcd07c3c5/appbackends/46cedde1-9918-4e7a-ac33-4ebb39a68bdc/BaaSService',
  issuer: 'https://sts.windows.net/975f013f-7f24-47e8-a7d3-abc4752bf346/',
  audience: 'ef403b6c-5f3e-40ac-8685-28eed2922ad5',
  subScope:
    '/eid1/c/pub/t/PwFflyR_6Een06vEdSvzRg/a/bDtA7z5frECGhSju0pIq1Q/workspaces/918924c8-a56a-41a9-b1fe-f6bfcd07c3c5/projects/46cedde1-9918-4e7a-ac33-4ebb39a68bdc',
};
