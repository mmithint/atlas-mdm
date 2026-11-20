import { describe, expect, it } from 'vitest';

import { buildFieldRows } from './detail-model';
import {
  REASON_MAX,
  allowedFor,
  buildCreateArguments,
  buildFieldChoices,
  canSubmit,
  sameValue,
  submitBlockReason,
  valueHint,
  valueProblem,
  type FieldChoice,
} from './request-dialog-model';
import { heaterDetail } from './test-fixtures';

function choice(over: Partial<FieldChoice> = {}): FieldChoice {
  return {
    fieldCode: 'MANUFACTURER',
    label: 'Manufacturer',
    unit: null,
    entityType: 'EQUIPMENT',
    dataType: 'TEXT',
    maxLength: 30,
    valuesFromList: false,
    current: 'SYNTHETIC MFR A',
    rawCurrent: 'SYNTHETIC MFR A',
    baseline: null,
    responsibleRole: 'Operations-IOC',
    accountableRole: 'SAPBusinessSupport',
    unavailableReason: null,
    ...over,
  };
}

const decimal = (over: Partial<FieldChoice> = {}) =>
  choice({ fieldCode: 'HEAT_DUTY', label: 'Heat duty', dataType: 'DECIMAL', maxLength: null, unit: 'MMBTU/hr', current: '2.5', rawCurrent: '2.5000', ...over });
const list = (over: Partial<FieldChoice> = {}) =>
  choice({ fieldCode: 'FIRED_UNFIRED', label: 'Fired / unfired', dataType: 'CODE', valuesFromList: true, current: 'FIRED', rawCurrent: 'FIRED', ...over });

describe('buildFieldChoices', () => {
  const detail = heaterDetail();
  const rows = buildFieldRows(detail.catalog, detail.fieldValues, detail.ownership, detail.heater);

  it('offers every editable field and carries the catalogue facts the form needs', () => {
    const choices = buildFieldChoices(rows, detail.catalog, detail.fieldValues, []);
    expect(choices.map((c) => c.fieldCode)).toEqual(['MANUFACTURER', 'HEAT_DUTY', 'EQUIPMENT_TAG_NUMBER', 'FLOC_CLASS']);
    expect(choices.every((c) => c.unavailableReason === null)).toBe(true);
    const duty = choices.find((c) => c.fieldCode === 'HEAT_DUTY');
    expect(duty).toMatchObject({ dataType: 'DECIMAL', unit: 'MMBTU/hr', entityType: 'EQUIPMENT', current: '2.5', rawCurrent: '2.5000' });
    expect(choices.find((c) => c.fieldCode === 'FLOC_CLASS')?.entityType).toBe('FLOC');
    expect(choices.find((c) => c.fieldCode === 'MANUFACTURER')).toMatchObject({ responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' });
  });

  it('reads the length and the drop-down source from the catalogue', () => {
    const choices = buildFieldChoices(
      rows,
      [
        { fieldCode: 'MANUFACTURER', dataType: 'TEXT', maxLength: 30, allowedValuesSource: 'NONE' },
        { fieldCode: 'HEAT_DUTY', dataType: 'DECIMAL', maxLength: null, allowedValuesSource: 'LIST' },
      ],
      detail.fieldValues,
      []
    );
    expect(choices.find((c) => c.fieldCode === 'MANUFACTURER')).toMatchObject({ maxLength: 30, valuesFromList: false });
    expect(choices.find((c) => c.fieldCode === 'HEAT_DUTY')).toMatchObject({ maxLength: null, valuesFromList: true });
  });

  it('leaves a field out when the catalogue says it cannot be edited, with the reason', () => {
    const noEdit = buildFieldRows(
      detail.catalog.map((c) => (c.fieldCode === 'MANUFACTURER' ? { ...c, isEditable: false } : c)),
      detail.fieldValues,
      detail.ownership,
      detail.heater
    );
    const choices = buildFieldChoices(noEdit, detail.catalog, detail.fieldValues, []);
    expect(choices.find((c) => c.fieldCode === 'MANUFACTURER')?.unavailableReason).toBe('This field cannot be changed by hand.');
    expect(choices.find((c) => c.fieldCode === 'HEAT_DUTY')?.unavailableReason).toBeNull();
  });

  it("blocks the fields the server lists, with the server's own reason", () => {
    const choices = buildFieldChoices(rows, detail.catalog, detail.fieldValues, [
      { fieldCode: 'FLOC_CLASS', reason: 'Only an admin may ask to change this field by hand.' },
      { fieldCode: 'MANUFACTURER', reason: '  ' },
    ]);
    expect(choices.find((c) => c.fieldCode === 'FLOC_CLASS')?.unavailableReason).toBe('Only an admin may ask to change this field by hand.');
    expect(choices.find((c) => c.fieldCode === 'MANUFACTURER')?.unavailableReason).toBe('Only an admin may change this field.');
  });

  it('keeps a blank current value blank (never a made-up zero)', () => {
    const blank = buildFieldRows(detail.catalog, [], detail.ownership, detail.heater);
    const choices = buildFieldChoices(blank, detail.catalog, [], []);
    expect(choices.find((c) => c.fieldCode === 'HEAT_DUTY')).toMatchObject({ current: null, rawCurrent: null });
  });
});

describe('submitBlockReason', () => {
  const ready = { status: 'ready', canSubmit: true } as const;
  it('is null for a registered person who may submit', () => {
    expect(submitBlockReason({ person: 'registered', options: ready })).toBeNull();
  });
  it('says why when the person is not known, not allowed, or the options are not there', () => {
    expect(submitBlockReason({ person: 'loading', options: ready })).toMatch(/Checking who you are/);
    expect(submitBlockReason({ person: 'unavailable', options: ready })).toMatch(/roles could not be loaded/);
    expect(submitBlockReason({ person: 'not-registered', options: ready })).toMatch(/not linked to a person/);
    expect(submitBlockReason({ person: 'registered', options: { status: 'loading' } })).toMatch(/Checking what you may request/);
    expect(submitBlockReason({ person: 'registered', options: { status: 'error', message: 'down' } })).toMatch(/could not be loaded: down/);
    expect(submitBlockReason({ person: 'registered', options: { status: 'ready', canSubmit: false } })).toBe('You are not allowed to submit change requests.');
  });
});

describe('allowedFor', () => {
  it('lists the values of one field in the catalogue order', () => {
    const all = [
      { fieldCode: 'FIRED_UNFIRED', value: 'UNFIRED', order: 2 },
      { fieldCode: 'EQUIPMENT_USER_STATUS', value: 'AVFS', order: 1 },
      { fieldCode: 'FIRED_UNFIRED', value: 'FIRED', order: 1 },
    ];
    expect(allowedFor(all, 'FIRED_UNFIRED')).toEqual(['FIRED', 'UNFIRED']);
    expect(allowedFor(all, 'NONE')).toEqual([]);
  });
});

describe('sameValue', () => {
  it('compares text exactly, ignoring only outer spaces (letter case counts: codes go to SAP as typed)', () => {
    expect(sameValue('FIRED', ' FIRED ', 'CODE')).toBe(true);
    expect(sameValue('FIRED', 'fired', 'CODE')).toBe(false);
  });
  it('compares a number field as numbers, so 2.5 is 2.5000', () => {
    expect(sameValue('2.5000', '2.5', 'DECIMAL')).toBe(true);
    expect(sameValue('2.5', '2.50', 'DECIMAL')).toBe(true);
    expect(sameValue('2.5', '2.6', 'DECIMAL')).toBe(false);
    expect(sameValue('10', '10.0', 'DECIMAL')).toBe(true);
  });
  it('treats text in a number field as different, and a blank current as different from any value', () => {
    expect(sameValue('2.5', 'abc', 'DECIMAL')).toBe(false);
    expect(sameValue(null, '0', 'DECIMAL')).toBe(false);
    expect(sameValue(null, 'X', 'TEXT')).toBe(false);
    expect(sameValue(null, '', 'TEXT')).toBe(true);
  });
});

describe('valueProblem and valueHint', () => {
  it('has no complaint about a blank value (the form just cannot be submitted yet)', () => {
    expect(valueProblem(choice(), '   ', [])).toBeNull();
  });
  it('stops a text value longer than the SAP field', () => {
    expect(valueProblem(choice({ maxLength: 5 }), '123456', [])).toMatch(/Too long: 6 of 5/);
    expect(valueProblem(choice({ maxLength: 5 }), ' 12345 ', [])).toBeNull();
  });
  it('mirrors the number rule of the server: digits, one point, at most 4 decimals', () => {
    for (const ok of ['2', '2.5', '.5', '5.', '10.1234']) expect(valueProblem(decimal(), ok, [])).toBeNull();
    for (const bad of ['abc', '1.2.3', '-1', '1,5', '1.23456', '.']) expect(valueProblem(decimal(), bad, [])).toMatch(/Enter a number/);
  });
  it('wants a value from the list for a drop-down field', () => {
    expect(valueProblem(list(), 'FIRED', ['FIRED', 'UNFIRED'])).toBeNull();
    expect(valueProblem(list(), 'SEMI', ['FIRED', 'UNFIRED'])).toBe('Choose one of the allowed values.');
    expect(valueProblem(list(), 'FIRED', [])).toBe('Choose one of the allowed values.');
  });
  it('says what is expected for each kind of field', () => {
    expect(valueHint(list())).toMatch(/allowed values/);
    expect(valueHint(decimal())).toMatch(/A number in MMBTU\/hr/);
    expect(valueHint(choice())).toMatch(/Up to 30 characters/);
    expect(valueHint(choice({ maxLength: null }))).toBe('Type the new value.');
  });
});

describe('canSubmit', () => {
  const reason = 'The nameplate says so';
  it('needs a field, a value that differs, and a reason', () => {
    expect(canSubmit(null, 'X', reason, [])).toBe(false);
    expect(canSubmit(choice(), 'SYNTHETIC MFR B', reason, [])).toBe(true);
    expect(canSubmit(choice(), '', reason, [])).toBe(false);
    expect(canSubmit(choice(), 'SYNTHETIC MFR B', '   ', [])).toBe(false);
  });
  it('stays off while the value equals the current one (a number field compares as numbers)', () => {
    expect(canSubmit(choice(), 'SYNTHETIC MFR A', reason, [])).toBe(false);
    expect(canSubmit(decimal(), '2.50', reason, [])).toBe(false);
    expect(canSubmit(decimal(), '3', reason, [])).toBe(true);
  });
  it('stays off for a value that breaks the format, and for a value outside the list', () => {
    expect(canSubmit(choice({ maxLength: 4 }), 'TOO LONG', reason, [])).toBe(false);
    expect(canSubmit(decimal(), 'abc', reason, [])).toBe(false);
    expect(canSubmit(list(), 'UNFIRED', reason, ['FIRED', 'UNFIRED'])).toBe(true);
    expect(canSubmit(list(), 'SEMI', reason, ['FIRED', 'UNFIRED'])).toBe(false);
  });
  it('limits the reason to what the procedure accepts', () => {
    expect(canSubmit(choice(), 'B', 'x'.repeat(REASON_MAX), [])).toBe(true);
    expect(canSubmit(choice(), 'B', 'x'.repeat(REASON_MAX + 1), [])).toBe(false);
  });
  it('stays off for a field the person may not request', () => {
    expect(canSubmit(choice({ unavailableReason: 'Only an admin may change this field.' }), 'B', reason, [])).toBe(false);
  });
});

describe('buildCreateArguments', () => {
  const heater = { equipmentId: 7, functionalLocation: 'SYN-FL-0007' };

  it('raises a heater field by heater id, as a manual request, with the value as gold holds it', () => {
    expect(buildCreateArguments(heater, decimal(), ' 3.5 ', ' bigger burner ')).toEqual({
      source: 'MANUAL',
      entityType: 'EQUIPMENT',
      equipmentId: 7,
      functionalLocation: '',
      fieldCode: 'HEAT_DUTY',
      oldValue: '2.5000',
      newValue: '3.5',
      reason: 'bigger burner',
      comment: '',
      evidenceJson: '',
    });
  });

  it('raises a location field by the heater\'s functional location, with heater id -1', () => {
    const args = buildCreateArguments(heater, choice({ fieldCode: 'FLOC_CLASS', entityType: 'FLOC', current: 'HEATER', rawCurrent: 'HEATER' }), 'HEATER2', 'why');
    expect(args).toMatchObject({ entityType: 'FLOC', equipmentId: -1, functionalLocation: 'SYN-FL-0007', fieldCode: 'FLOC_CLASS', oldValue: 'HEATER' });
  });

  it('sends a blank current value as empty text', () => {
    expect(buildCreateArguments(heater, choice({ current: null, rawCurrent: null }), 'X', 'why').oldValue).toBe('');
  });
});
