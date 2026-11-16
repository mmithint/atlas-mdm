import { describe, expect, it } from 'vitest';

import { buildFieldRows, displayValue, flocLevels, type CatalogFieldInput } from './detail-model';

const catalog: CatalogFieldInput[] = [
  { fieldCode: 'EQUIPMENT_TAG_NUMBER', label: 'Engineering tag', displayGroup: 'ADDITIONAL', displayOrder: 6, isEditable: true },
  { fieldCode: 'HEAT_DUTY', label: 'Heat duty (MMBTU/hr)', dataType: 'DECIMAL', unit: 'MMBTU/hr', displayGroup: 'KEY', displayOrder: 5, isEditable: true, isKeyVerificationField: true },
  { fieldCode: 'MANUFACTURER', label: 'Manufacturer', displayGroup: 'KEY', displayOrder: 1, isEditable: true, isKeyVerificationField: true },
  { fieldCode: 'FLOC_CLASS', label: 'FLOC class', entityType: 'FLOC', displayGroup: 'ADDITIONAL', displayOrder: 13 },
];

const values = [
  { fieldCode: 'MANUFACTURER', currentValue: 'SYNTHETIC MFR A', baselineValue: 'SYNTHETIC MFR A', valueSource: 'STATED' },
  { fieldCode: 'HEAT_DUTY', currentValue: '2.5000', baselineValue: '2.5000', unit: 'MMBTU/hr', valueSource: 'STATED' },
  { fieldCode: 'EQUIPMENT_TAG_NUMBER', currentValue: null, baselineValue: null, valueSource: 'MISSING' },
];

const ownership = [
  { fieldCode: 'MANUFACTURER', responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' },
  { fieldCode: 'HEAT_DUTY', responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' },
];

describe('buildFieldRows', () => {
  const rows = buildFieldRows(catalog, values, ownership, { flocClass: 'HEATER' });

  it('lists key fields first, then the additional ones, each in catalogue order', () => {
    expect(rows.map((r) => r.fieldCode)).toEqual(['MANUFACTURER', 'HEAT_DUTY', 'EQUIPMENT_TAG_NUMBER', 'FLOC_CLASS']);
    expect(rows.map((r) => r.group)).toEqual(['KEY', 'KEY', 'ADDITIONAL', 'ADDITIONAL']);
  });

  it('shows decimals without trailing zeros and keeps the unit', () => {
    const duty = rows.find((r) => r.fieldCode === 'HEAT_DUTY');
    expect(duty?.current).toBe('2.5');
    expect(duty?.baseline).toBe('2.5');
    expect(duty?.unit).toBe('MMBTU/hr');
    expect(duty?.isKeyVerificationField).toBe(true);
  });

  it('keeps a missing value null (shown as a dash), never zero', () => {
    const tag = rows.find((r) => r.fieldCode === 'EQUIPMENT_TAG_NUMBER');
    expect(tag?.current).toBeNull();
    expect(tag?.valueSource).toBe('MISSING');
    expect(tag?.changedFromBaseline).toBe(false);
  });

  it('adds who answers first and who signs off second, and leaves them null when no route matches', () => {
    expect(rows.find((r) => r.fieldCode === 'MANUFACTURER')).toMatchObject({ responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' });
    expect(rows.find((r) => r.fieldCode === 'FLOC_CLASS')).toMatchObject({ responsibleRole: null, accountableRole: null });
  });

  it('reads a FLOC field from the heater row when the long-form view has no row for it', () => {
    const floc = rows.find((r) => r.fieldCode === 'FLOC_CLASS');
    expect(floc?.current).toBe('HEATER');
    expect(floc?.baseline).toBeNull();
    expect(floc?.changedFromBaseline).toBe(false);
  });

  it('flags a value that an approved change moved away from the SAP baseline', () => {
    const changed = buildFieldRows(
      catalog,
      [{ fieldCode: 'MANUFACTURER', currentValue: 'NEW MAKER', baselineValue: 'OLD MAKER', valueSource: 'CORRECTED' }],
      [],
      {}
    );
    expect(changed.find((r) => r.fieldCode === 'MANUFACTURER')?.changedFromBaseline).toBe(true);
  });

  it('returns a row for every catalogue field even when no value arrived', () => {
    const empty = buildFieldRows(catalog, [], [], {});
    expect(empty).toHaveLength(catalog.length);
    expect(empty.every((r) => r.current === null)).toBe(true);
  });
});

describe('displayValue', () => {
  it('trims decimals only for DECIMAL fields', () => {
    expect(displayValue('2.5000', 'DECIMAL')).toBe('2.5');
    expect(displayValue('2.5000', 'TEXT')).toBe('2.5000');
    expect(displayValue('  ', 'TEXT')).toBeNull();
    expect(displayValue(undefined, 'DECIMAL')).toBeNull();
  });
});

describe('flocLevels', () => {
  it('returns the filled hierarchy levels, top level first', () => {
    expect(flocLevels({ level1Id: 'ORG', level2Id: 'BU-01', level3Id: '', level4Id: null, level5Id: 'SYS', level6Id: undefined })).toEqual(['ORG', 'BU-01', 'SYS']);
    expect(flocLevels(null)).toEqual([]);
  });
});
