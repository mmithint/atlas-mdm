/**
 * Connecting to the ATLAS SQL database from a function.
 *
 * Follows `@microsoft/rayfin-guide` functions/connections/add-fabric-resource.md
 * (SQL databases): `mssql`, `encrypt: true`, Microsoft Entra access token from
 * `ctx.Tokens.Sql`. The connection runs as the app identity (the owner of the
 * Fabric App item), not as the signed-in user.
 *
 * APP-0 scope: open a connection, report errors without leaking the token. The
 * typed-parameter helpers for the request procedures are added in APP-3.
 */
import sql from 'mssql';
import type { ConnectionPool } from 'mssql';

import { SQL_DATABASE, SQL_SERVER_FQDN } from './config.js';

/** Fabric's `serverFqdn` is `host,port`; the driver wants them apart. */
export function parseServer(fqdn: string): { host: string; port: number } {
  const [host = '', portText] = fqdn.split(',');
  const port = portText ? Number.parseInt(portText, 10) : 1433;
  return { host: host.trim(), port: Number.isFinite(port) ? port : 1433 };
}

/** Opens a pool on the ATLAS database using the app identity's token. */
export async function openPool(token: string): Promise<ConnectionPool> {
  const { host, port } = parseServer(SQL_SERVER_FQDN);
  const pool = new sql.ConnectionPool({
    server: host,
    port,
    database: SQL_DATABASE,
    connectionTimeout: 15_000,
    requestTimeout: 20_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10_000 },
    options: { encrypt: true, trustServerCertificate: false },
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token },
    },
  });
  await pool.connect();
  return pool;
}

export interface SqlErrorInfo {
  number: number | null;
  message: string;
  hint: string | null;
}

const MAX_MESSAGE_LENGTH = 300;

/** Short, token-free description of a driver error, with a hint for known cases. */
export function describeSqlError(err: unknown, token?: string): SqlErrorInfo {
  const raw = err instanceof Error ? err.message : String(err);
  let message = raw;
  if (token && token.length > 20) message = message.split(token).join('[token]');
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = `${message.slice(0, MAX_MESSAGE_LENGTH)}…`;
  }

  const rawNumber = (err as { number?: unknown } | null)?.number;
  const number = typeof rawNumber === 'number' ? rawNumber : null;

  return { number, message, hint: hintFor(number, message) };
}

function hintFor(number: number | null, message: string): string | null {
  if (number === 208) {
    return 'The table dev.spike is missing. Run db/dev/spike_s2_setup.sql in the SQL database first.';
  }
  if (number === 4060 || /cannot open database/i.test(message)) {
    return 'The database name is not accepted. Compare SQL_DATABASE in packages/functions/src/config.ts with Initial Catalog under SQL database > Settings > Connection strings.';
  }
  if (number === 18456 || /login failed/i.test(message)) {
    return 'The app identity (the owner of the Fabric App item) was refused. Check its role in the workspace and its access to the database.';
  }
  if (/ENOTFOUND|getaddrinfo/i.test(message)) {
    return 'The server name did not resolve. Compare SQL_SERVER_FQDN in packages/functions/src/config.ts with Settings > Connection strings.';
  }
  return null;
}
