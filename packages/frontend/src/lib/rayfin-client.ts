//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import {
  ConnectorsRayfinClient,
  resolveRayfinConfig,
} from '@microsoft/rayfin-client';
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';
import type { UniversalAppSchema } from '@rayfin-app/shared';
import {
  connectorConfigs,
  connectorRuntimes,
  type AppConnectorsSchema,
} from './connectors';

export type AppClient = ConnectorsRayfinClient<
  UniversalAppSchema,
  AppFunctionsSchema,
  AppConnectorsSchema
>;

let _client: Promise<AppClient> | undefined;

export class MissingRayfinConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Missing required Rayfin configuration: ${missing.join(', ')}`);
    this.name = 'MissingRayfinConfigError';
  }
}

/**
 * Returns the app's typed data, auth, functions, and connector client.
 *
 * ATLAS note: the functions pack replaced this file with the plain
 * `RayfinClient` (it does not know about the hand-added `atlas_sql_db`
 * connector). This is the template's connectors-plus-functions shape
 * (`.agents/skills/connectors/kit/rayfin-client.with-functions.ts`), so both
 * `client.connectors.atlas_sql_db` and `client.functions.<name>` are typed.
 */
export async function getRayfinClient(): Promise<AppClient> {
  if (!_client) {
    _client = createClient().catch((error) => {
      _client = undefined;
      throw error;
    });
  }

  return _client;
}

async function createClient(): Promise<AppClient> {
  const resolved = await resolveRayfinConfig({
    apiUrl: import.meta.env.VITE_RAYFIN_API_URL,
    publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY,
    workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID,
    itemId: import.meta.env.VITE_FABRIC_ITEM_ID,
    portalUrl: import.meta.env.VITE_FABRIC_PORTAL_URL,
  });

  if (!resolved.baseUrl || !resolved.publishableKey) {
    throw new MissingRayfinConfigError([
      ...(!resolved.baseUrl ? ['apiUrl'] : []),
      ...(!resolved.publishableKey ? ['publishableKey'] : []),
    ]);
  }

  return new ConnectorsRayfinClient<
    UniversalAppSchema,
    AppFunctionsSchema,
    AppConnectorsSchema
  >(
    {
      baseUrl: resolved.baseUrl,
      publishableKey: resolved.publishableKey,
      authStorage: true,
      runtimeConfig: resolved.runtimeConfig,
      connectors: connectorConfigs,
    },
    connectorRuntimes
  );
}
