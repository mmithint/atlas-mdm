import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { connectorConfigs } from './connectors';

/**
 * Guards the connector rules of FINAL PLAN/01 sections 2.1 and 5 and CLAUDE.md rule 6,
 * so a later edit cannot quietly break them:
 *  - the connector is READ ONLY everywhere (yml, schema, runtime config, every entity)
 *  - NO entity reads a view: the deployed connector refuses views (spike S7, 14-15 Nov;
 *    decision D-17), and one refused entity makes the whole apply fail
 *  - every entity declares a key, and the key is a required property
 *  - every text column has an explicit length (never nvarchar(max))
 *  - every property is mapped to a named column
 *  - the field lists kept by hand in `connectors.ts` equal the entity files
 */
const root = resolve(import.meta.dirname, '../../../..');
const connectorDir = resolve(root, 'rayfin/connectors/atlas_sql_db');

interface Property {
  decorator: string;
  options: string;
  name: string;
  required: boolean;
}
interface EntityFile {
  file: string;
  className: string;
  table: string;
  key: string[];
  roleActions: string;
  properties: Property[];
}

function parseEntity(file: string): EntityFile {
  const text = readFileSync(resolve(connectorDir, file), 'utf8');
  const className = /export class (\w+) extends Source\(/.exec(text)?.[1] ?? '';
  const table = /table:\s*'([^']+)'/.exec(text)?.[1] ?? '';
  const key = [...(/primaryKey:\s*\[([^\]]*)\]/.exec(text)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
  const roleActions = /@role\('authenticated',\s*\[([^\]]*)\]\)/.exec(text)?.[1] ?? '';
  const properties = [...text.matchAll(/@(\w+)\(\{([^}]*)\}\)\s+(\w+)(\?|!):/g)].map((m) => ({
    decorator: m[1] ?? '',
    options: m[2] ?? '',
    name: m[3] ?? '',
    required: m[4] === '!',
  }));
  return { file, className, table, key, roleActions, properties };
}

const entityFiles = readdirSync(connectorDir)
  .filter((f) => f.endsWith('.ts') && f !== 'schema.ts')
  .sort();
const entities = entityFiles.map(parseEntity);
const configured = connectorConfigs.atlas_sql_db.entities as Record<string, readonly string[]>;

describe('connector atlas_sql_db: read only', () => {
  it('allows only read in rayfin.yml', () => {
    const yml = readFileSync(resolve(root, 'rayfin/rayfin.yml'), 'utf8');
    const connectors = yml.slice(yml.indexOf('connectors:'));
    // only the entries under `operations:` (the connector's own `- name:` line comes before it)
    const block = connectors.slice(connectors.indexOf('operations:'));
    const operations = [...block.matchAll(/^\s*-\s*name:\s*(\w+)\s*$/gm)].map((m) => m[1]);
    expect(operations).toEqual(['read']);
  });

  it('allows only read in the runtime config and in schema.ts', () => {
    expect(connectorConfigs.atlas_sql_db.operations).toEqual(['read']);
    const schema = readFileSync(resolve(connectorDir, 'schema.ts'), 'utf8');
    expect(/operations:\s*\['read'\]/.test(schema)).toBe(true);
  });

  it('grants only read on every entity', () => {
    for (const e of entities) expect(e.roleActions.replace(/\s/g, ''), e.file).toBe("'read'");
  });
});

describe('connector entities', () => {
  it('finds the one entity left after spike S7: the field catalogue (a table)', () => {
    expect(entities.map((e) => e.className)).toEqual(['FieldCatalog']);
  });

  it('reads no view: views are refused by the deployed connector (use a function and a procedure)', () => {
    for (const e of entities) {
      expect(e.table, `${e.file} must name a table, not a view`).not.toMatch(/^vw_/);
    }
  });

  it.each(entities.map((e) => [e.className, e] as const))('%s declares a required key that is one of its properties', (_name, e) => {
    expect(e.key.length, 'a key').toBeGreaterThan(0);
    for (const k of e.key) {
      const property = e.properties.find((p) => p.name === k);
      expect(property, `key ${k} is a property`).toBeDefined();
      expect(property?.required, `key ${k} is required`).toBe(true);
    }
  });

  it.each(entities.map((e) => [e.className, e] as const))('%s maps every property to a column and gives every text a length', (_name, e) => {
    expect(e.properties.length).toBeGreaterThan(0);
    for (const p of e.properties) {
      expect(p.options, `${p.name} has column:`).toMatch(/column:\s*'[a-z0-9_]+'/);
      if (p.decorator === 'text') {
        expect(p.options, `${p.name} has max:`).toMatch(/max:\s*[1-9]\d*\b/);
      }
    }
  });

  it('points each entity at a schema.table of the ATLAS database', () => {
    for (const e of entities) {
      const source = /schema:\s*'(gold|app)'/.exec(readFileSync(resolve(connectorDir, e.file), 'utf8'))?.[1];
      expect(source, e.file).toBeDefined();
      expect(e.table, e.file).toMatch(/^field_catalog$/);
    }
  });

  it('is listed in schema.ts, once, in the entities map and in the schema type', () => {
    const schema = readFileSync(resolve(connectorDir, 'schema.ts'), 'utf8');
    for (const e of entities) {
      expect(schema, e.className).toContain(`import { ${e.className} } from './${e.className}.js';`);
      expect(schema, e.className).toContain(`export { ${e.className} } from './${e.className}.js';`);
      expect(schema, e.className).toContain(`${e.className}: typeof ${e.className};`);
    }
  });
});

describe('connectors.ts field lists', () => {
  it('has one list per entity file', () => {
    expect(Object.keys(configured).sort()).toEqual(entities.map((e) => e.className).sort());
  });

  it.each(entities.map((e) => [e.className, e] as const))('%s: the list equals the entity properties, in order', (_name, e) => {
    expect(configured[e.className]).toEqual(e.properties.map((p) => p.name));
  });
});
