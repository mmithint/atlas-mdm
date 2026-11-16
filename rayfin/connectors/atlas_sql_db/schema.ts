import type { GraphQLBackedConnector } from '@microsoft/rayfin-connector-fabric-graphql';
import type { ConnectorConfig } from '@microsoft/rayfin-connectors';

import { FieldCatalog } from './FieldCatalog.js';

export { FieldCatalog } from './FieldCatalog.js';

// ATLAS_SQL_DB (Fabric SQL database): READ ONLY (decision D-02). Every change goes
// through a Rayfin function and a stored procedure, never through the browser.
//
// PLAIN TABLES ONLY. On 14-15 Nov the deployed connector refused every VIEW (spike S7 and
// the table-versus-view probe: the same columns are accepted as a table and refused as a
// view, with a declared key or without), so reads of views go through functions instead
// (read path C, decision D-17, FINAL PLAN/01 section 2.1). Do not add an entity whose
// source is a view: one refused entity makes the whole apply fail.
//
// Keep `operations` identical to rayfin/rayfin.yml and every entity's @role actions
// a subset of it (the entities grant only 'read').
export const connectorConfig = {
  connector: 'fabric-sqldatabase',
  operations: ['read'],
  entities: {
    FieldCatalog,
  },
} as const satisfies ConnectorConfig;

export type AtlasSqlDbSchema = GraphQLBackedConnector<
  {
    FieldCatalog: typeof FieldCatalog;
  },
  typeof connectorConfig
>;
