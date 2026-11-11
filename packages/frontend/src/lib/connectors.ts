//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import type {
  ConnectorConfig,
  ConnectorsRuntime,
} from '@microsoft/rayfin-connectors';

import type { AtlasSqlDbSchema } from '../../../../rayfin/connectors/atlassqldb/schema';

/**
 * App-owned wiring (the CLI's generated block was removed on purpose).
 *
 * `atlassqldb` must match the connector `name` in rayfin/rayfin.yml. The schema
 * is imported as a type only; the runtime config lists field names instead of
 * the decorated entity classes, which live outside the frontend package and
 * would otherwise be bundled with untransformed decorators.
 */
export type AppConnectorsSchema = { atlassqldb: AtlasSqlDbSchema };

export const connectorConfigs = {
  atlassqldb: {
    connector: 'fabric-sqldatabase',
    operations: ['read', 'create'],
    entities: { TestNote: ['id', 'title', 'createdBy', 'createdAt'] },
  },
} satisfies Record<string, ConnectorConfig>;

export const connectorRuntimes: ConnectorsRuntime = {};
