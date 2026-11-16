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

import type { AtlasSqlDbSchema } from '../../../../rayfin/connectors/atlas_sql_db/schema';

/**
 * App-owned wiring (the CLI's generated block was removed on purpose).
 *
 * `atlas_sql_db` must match the connector `name` in rayfin/rayfin.yml. The schema
 * is imported as a type only; the runtime config lists field names instead of
 * the decorated entity classes, which live outside the frontend package and
 * would otherwise be bundled with untransformed decorators.
 *
 * PLAIN TABLES ONLY: the deployed connector refuses views (spike S7, 14-15 Nov), so the
 * equipment screens read their views through functions (D-17). Only the field catalogue,
 * a table with a real primary key, is read through this connector.
 *
 * The field lists below must equal the properties of the entity files in
 * rayfin/connectors/atlas_sql_db/ (same names, same order). `connectors.spec.ts`
 * compares them, checks that every text column has a length and every entity a
 * declared key, that no entity reads a view, and that the connector can only read.
 */
export type AppConnectorsSchema = { atlas_sql_db: AtlasSqlDbSchema };

export const connectorConfigs = {
  atlas_sql_db: {
    connector: 'fabric-sqldatabase',
    // Read only (decision D-02): writes go through functions and stored procedures.
    operations: ['read'],
    entities: {
      FieldCatalog: [
        'fieldCode',
        'label',
        'entityType',
        'dataType',
        'maxLength',
        'unit',
        'allowedValuesSource',
        'isKeyVerificationField',
        'isEditable',
        'displayGroup',
        'displayOrder',
        'isMandatoryForSubmission',
        'isActive',
      ],
    },
  },
} satisfies Record<string, ConnectorConfig>;

export const connectorRuntimes: ConnectorsRuntime = {};
