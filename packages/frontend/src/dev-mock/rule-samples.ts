/**
 * The client's ten draft rules (REF-46 §4.4, L0265-L0274) as the demo's starting rule set (`npm run dev:mock`
 * only; FINAL PLAN/11 §6 S-9). IDs, names and descriptions are the client's; the SQL is SAMPLE SQL written for
 * the demo against the gold contract views (`FINAL PLAN/01` §6.1, output contract §6.4), not a published rule.
 *
 * The demo does not run SQL: each rule's `evaluate` finds in the sample heaters what its SQL would find. Three
 * rules carry SQL: HEATER_CLASS_FIRED (published, AUTO_ROUTE, the M1 rule), HEATER_DUTY (published, MANUAL)
 * and ENGINEERING_TAG_UNIQUE (a draft whose first test fails on duplicate rows; uncommenting its GROUP BY line
 * fixes it, demo script step 7). The other seven have no SQL yet, as in the client's workbook.
 */
import type { SearchRow } from '@/features/equipment/equipment-api';
import type { RoutingMode } from '@/features/rules/rules-types';

import { fieldValueOf } from './catalog';

export interface Violation {
  equipmentId: number;
  entityKey: string;
  tag: string | null;
  profitCenter: string | null;
  fieldCode: string | null;
  oldValue: string | null;
  proposedValue: string | null;
  violation: string;
  note: string | null;
  evidence: Record<string, unknown>;
}

export interface SampleRule {
  ruleId: string;
  ruleName: string;
  description: string;
  queryText: string;
  routingMode: RoutingMode;
  allowedTargets: string[];
  applicability: string[];
  /** How the demo starts: published, a draft with SQL, or a draft without SQL. */
  start: 'PUBLISHED' | 'DRAFT';
  /** What the SQL finds, one row per result. `grouped` = the query has its GROUP BY (tag rule). */
  evaluate: (heaters: readonly SearchRow[], grouped: boolean) => Violation[];
}

const base = (h: SearchRow) => ({
  equipmentId: h.equipmentId,
  entityKey: h.equipmentNumber ?? String(h.equipmentId),
  tag: h.equipmentTagNumber,
  profitCenter: h.profitCenterName,
});

const isHeater = (h: SearchRow) => h.flocClass === 'HEATER';

/** The client's normalisation for tags: trim, no hyphens or slashes, any case (REF-46 L0265). */
const normalTag = (tag: string | null) => (tag ?? '').trim().replace(/[-/]/g, '').toUpperCase();

const SQL_FIRED = `-- SAMPLE SQL for the demo (not the published rule).
-- Heaters classed HEATER whose fuel type is not FIRED: propose FIRED,
-- marked TBD so a person confirms it (PTD-06). One row per heater.
SELECT
    'EQUIPMENT'                           AS entity_type,
    e.equipment_number                    AS entity_key,
    e.equipment_id                        AS equipment_id,
    e.profit_center_name                  AS profit_center_name,
    'Classed HEATER but not marked FIRED' AS violation_description,
    'FIRED_UNFIRED'                       AS field_code,
    e.fired_unfired                       AS old_value,
    'FIRED'                               AS proposed_value,
    'TBD'                                 AS note,
    CONCAT('{"equip_class":"', e.equip_class,
           '","fired_unfired":"', e.fired_unfired, '"}') AS evidence_json
FROM gold.vw_equipment_current AS e
WHERE e.floc_class  = 'HEATER'
  AND e.equip_class = 'HEATER'
  AND ISNULL(e.fired_unfired, '') <> 'FIRED'`;

const SQL_DUTY = `-- SAMPLE SQL for the demo (not the published rule).
-- Heaters must have a heat duty in MMBTU/hr. MANUAL: reports only.
SELECT
    'EQUIPMENT'                          AS entity_type,
    e.equipment_number                   AS entity_key,
    e.equipment_id                       AS equipment_id,
    e.profit_center_name                 AS profit_center_name,
    'Heater has no heat duty (MMBTU/hr)' AS violation_description,
    CAST(NULL AS nvarchar(64))           AS field_code,
    CAST(NULL AS nvarchar(400))          AS old_value,
    CAST(NULL AS nvarchar(400))          AS proposed_value,
    CAST(NULL AS nvarchar(200))          AS note,
    CONCAT('{"heat_duty_source":"', e.heat_duty_source, '"}') AS evidence_json
FROM gold.vw_equipment_current AS e
WHERE e.floc_class = 'HEATER'
  AND e.heat_duty_mmbtu_hr IS NULL`;

const SQL_TAG = `-- SAMPLE SQL for the demo (draft).
-- Tags must be unique within the parent FLOC: compare case-insensitively,
-- trimmed, without hyphens and slashes (client rule text, REF-46).
SELECT
    'EQUIPMENT'                 AS entity_type,
    a.equipment_number          AS entity_key,
    a.equipment_id              AS equipment_id,
    a.profit_center_name        AS profit_center_name,
    CONCAT('Tag ', a.equipment_tag_number,
           ' is used by another heater under the same parent FLOC') AS violation_description,
    'EQUIPMENT_TAG_NUMBER'      AS field_code,
    a.equipment_tag_number      AS old_value,
    CAST(NULL AS nvarchar(400)) AS proposed_value,
    CAST(NULL AS nvarchar(200)) AS note,
    CONCAT('{"tag":"', a.equipment_tag_number, '"}') AS evidence_json
FROM gold.vw_equipment_current AS a
JOIN gold.vw_equipment_current AS b
  ON  b.superior_functional_location = a.superior_functional_location
  AND b.equipment_id <> a.equipment_id
  AND UPPER(REPLACE(REPLACE(TRIM(b.equipment_tag_number), '-', ''), '/', ''))
    = UPPER(REPLACE(REPLACE(TRIM(a.equipment_tag_number), '-', ''), '/', ''))
-- GROUP BY a.equipment_number, a.equipment_id, a.profit_center_name, a.equipment_tag_number`;

const none = () => [] as Violation[];

const classDraft = (ruleId: string, ruleName: string, description: string, classes: string[]): SampleRule => ({
  ruleId,
  ruleName,
  description,
  queryText: '',
  routingMode: 'MANUAL',
  allowedTargets: [],
  applicability: classes,
  start: 'DRAFT',
  evaluate: none,
});

export const SAMPLE_RULES: readonly SampleRule[] = [
  {
    ruleId: 'HEATER_CLASS_FIRED',
    ruleName: 'Fired heater classification',
    description:
      'Heater Classifications; equipment designed solely to heat process material utilizing natural gas; Floc_Class == HEATER, Equip_Class == HEATER, Class_Type == HEATER, HB_TYPE == FIRED',
    queryText: SQL_FIRED,
    routingMode: 'AUTO_ROUTE',
    allowedTargets: ['FIRED_UNFIRED'],
    applicability: ['HEATER'],
    start: 'PUBLISHED',
    evaluate: (heaters) =>
      heaters
        .filter((h) => isHeater(h) && h.equipClass === 'HEATER' && h.firedUnfired !== 'FIRED')
        .map((h) => ({
          ...base(h),
          fieldCode: 'FIRED_UNFIRED',
          oldValue: fieldValueOf(h, 'FIRED_UNFIRED'),
          proposedValue: 'FIRED',
          violation: 'Classed HEATER but not marked FIRED',
          note: 'TBD',
          evidence: { equip_class: h.equipClass, fired_unfired: h.firedUnfired },
        })),
  },
  {
    ruleId: 'HEATER_DUTY',
    ruleName: 'Heater heat duty',
    description: 'Heater heat duty; heaters must have an associated heat duty; units are MMBTU/hr; F.when(Floc_Class == HEATER), HB_DUTY.isNotNull()',
    queryText: SQL_DUTY,
    routingMode: 'MANUAL',
    allowedTargets: ['HEAT_DUTY'],
    applicability: ['HEATER'],
    start: 'PUBLISHED',
    evaluate: (heaters) =>
      heaters
        .filter((h) => isHeater(h) && h.heatDutyMmbtuHr === null)
        .map((h) => ({
          ...base(h),
          fieldCode: null,
          oldValue: null,
          proposedValue: null,
          violation: 'Heater has no heat duty (MMBTU/hr)',
          note: null,
          evidence: { heat_duty_source: h.heatDutySource },
        })),
  },
  {
    ruleId: 'ENGINEERING_TAG_UNIQUE',
    ruleName: 'Engineering tag unique within Parent FLOC',
    description:
      'Current/proposed tags must be unique within Parent FLOC across classes; compare case-insensitively, trim outer whitespace, remove hyphens and slashes.',
    queryText: SQL_TAG,
    routingMode: 'MANUAL',
    allowedTargets: ['EQUIPMENT_TAG_NUMBER'],
    applicability: ['HEATER', 'BOILER', 'REBOILER'],
    start: 'DRAFT',
    evaluate: (heaters, grouped) => {
      const out: Violation[] = [];
      for (const a of heaters) {
        const twins = heaters.filter(
          (b) => b.equipmentId !== a.equipmentId && b.superiorFunctionalLocation === a.superiorFunctionalLocation && normalTag(b.equipmentTagNumber) === normalTag(a.equipmentTagNumber)
        );
        // Without the GROUP BY the join gives one row per matching twin: a tag shared by three heaters
        // returns two rows per heater, which breaks the one-row-per-heater-and-field rule.
        const rows = grouped ? Math.min(twins.length, 1) : twins.length;
        for (let i = 0; i < rows; i += 1) {
          out.push({
            ...base(a),
            fieldCode: 'EQUIPMENT_TAG_NUMBER',
            oldValue: a.equipmentTagNumber,
            proposedValue: null,
            violation: `Tag ${a.equipmentTagNumber ?? ''} is used by another heater under the same parent FLOC`,
            note: null,
            evidence: { tag: a.equipmentTagNumber },
          });
        }
      }
      return out;
    },
  },
  classDraft(
    'HEATER_CLASS_ELECTRIC',
    'Electric heater classification',
    'Heater Classifications; equipment designed solely to heat process material utilizing electricity; Floc_Class == HEATER, Equip_Class == HEATER, Class_Type == HEATER, HB_TYPE == ELECTRIC',
    ['HEATER']
  ),
  classDraft(
    'HEATER_CLASS_STEAM',
    'Steam heater classification',
    'Heater Classifications; equipment designed solely to heat process material utilizing steam - effectively functioning as a heat exchanger; Floc_Class == HEATER, Equip_Class == HEAT_EXCHANGER, Class_Type == HEAT_EXCHANGER, HE_TYPE == STEAM or HE_FLUID_TUBE_SIDE == STEAM',
    ['HEATER', 'HEAT_EXCHANGER']
  ),
  classDraft(
    'ASSOCIATED_BOILER_HEATER',
    'Associated boiler for steam heaters',
    'Heater/Boiler relationship; if a heater follows HEATER_CLASS_STEAM - there must be an associated boiler within the same parent FLOC',
    ['HEATER', 'BOILER']
  ),
  classDraft(
    'BOILER_CLASS_FIRED',
    'Fired boiler classification',
    'Boiler Classifications; equipment designed solely to heat water to produce steam to be used as a heating medium; Floc_Class == BOILER, Equip_Class == BOILER, Class_Type == BOILER, HB_TYPE == FIRED',
    ['BOILER']
  ),
  classDraft(
    'BOILER_CLASS_ELECTRIC',
    'Electric boiler classification',
    'Boiler Classifications; equipment designed solely to heat water to produce steam to be used as a heating medium; Floc_Class == BOILER, Equip_Class == BOILER, Class_Type == BOILER, HB_TYPE == ELECTRIC',
    ['BOILER']
  ),
  classDraft(
    'BOILER_DUTY',
    'Boiler heat duty',
    'Boiler heat duty; boilers must have an associated heat duty; units are MMBTU/hr; F.when(Floc_Class == BOILER), HB_DUTY.isNotNull()',
    ['BOILER']
  ),
  classDraft(
    'REBOILER_CLASS_FIRED',
    'Fired reboiler classification',
    'Reboiler Classifications; equipment designed solely to heat process material utilizing natural gas; Floc_Class == REBOILER, Equip_Class == REBOILER, Class_Type == REBOILER_FIRED, HB_TYPE == FIRED',
    ['REBOILER']
  ),
];

export function sampleRule(ruleId: string): SampleRule | undefined {
  return SAMPLE_RULES.find((r) => r.ruleId === ruleId);
}

/** SQL text without `--` comments, as the checks read it. */
export function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Whether a (possibly edited) rule text has its aggregation, which makes the tag rule one row per heater. */
export const hasGroupBy = (sql: string): boolean => /\bGROUP\s+BY\b/i.test(stripComments(sql));

/** A short fingerprint of a definition (the server uses SHA-256 of the exact text). */
export function fingerprint(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
