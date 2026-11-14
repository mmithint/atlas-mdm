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
