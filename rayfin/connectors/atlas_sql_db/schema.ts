import type { GraphQLBackedConnector } from '@microsoft/rayfin-connector-fabric-graphql';
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';

import { TestNote } from './TestNote.js';

export { TestNote } from './TestNote.js';

// ATLAS_SQL_DB (Fabric SQL database): read and create only.
export const connectorConfig = {
  connector: 'fabric-sqldatabase',
  operations: ['read', 'create'],
  entities: { TestNote },
} as const satisfies ConnectorConfig;

export type AtlasSqlDbSchema = GraphQLBackedConnector<
  { TestNote: typeof TestNote },
  typeof connectorConfig
>;
