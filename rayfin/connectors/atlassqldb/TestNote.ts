import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

/**
 * ATLAS_SQL_DB `dbo.TestNote` — backend test table (read + create).
 * Matches metadata.json from `rayfin connector add`; `id` and `createdAt` have
 * database defaults, so the app only sends `title` and `createdBy`.
 */
@role('authenticated', ['read', 'create'])
@entity()
export class TestNote extends Source({ schema: 'dbo', table: 'TestNote', primaryKey: ['id'] }) {
  @uuid() id!: string;
  @text({ min: 1, max: 200 }) title!: string;
  @text({ optional: true, max: 200 }) createdBy?: string;
  @date({ optional: true }) createdAt?: Date;
}
