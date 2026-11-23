import { describe, expect, it } from 'vitest';

import { DEFAULT_COLUMNS } from './columns';
import { definitionOf, viewOf, type ViewState } from './saved-view-model';
import { criteriaFromQuery } from './search-model';

const view: ViewState = {
  criteria: criteriaFromQuery(new URLSearchParams('f.manufacturer=demo&facility=SYN-FL-AREA-01&sort=equipClass&dir=desc&size=25')),
  selection: { equipClass: ['LINE_HEATER', 'HEATER'], verificationPct: ['low'] },
  columns: ['manufacturer', 'equipmentTagNumber', 'equipClass'],
};

describe('saved filter definitions', () => {
  it('keeps the whole view and gives it back', () => {
    const back = viewOf(definitionOf(view))!;
    expect(back.criteria).toEqual(view.criteria);
    expect(back.selection).toEqual({ equipClass: ['HEATER', 'LINE_HEATER'], verificationPct: ['low'] });
    // in the table's own column order
    expect(back.columns).toEqual(['equipmentTagNumber', 'manufacturer', 'equipClass']);
  });

  it('writes equal views as equal text, whatever order things were ticked in', () => {
    const reordered: ViewState = { ...view, selection: { verificationPct: ['low'], equipClass: ['HEATER', 'LINE_HEATER'] }, columns: [...view.columns].reverse() };
    expect(definitionOf(reordered)).toBe(definitionOf(view));
    expect(definitionOf({ ...view, selection: {} })).not.toBe(definitionOf(view));
  });

  it('drops what it does not know, and falls back to the default columns', () => {
    const json = JSON.stringify({
      v: 1,
      query: { 'f.manufacturer': 'demo', 'f.nope': 'x', size: '999', sort: 'nope' },
      selection: { equipClass: ['HEATER', 7], nope: ['x'] },
      columns: ['nope'],
    });
    const back = viewOf(json)!;
    expect(back.criteria.filters).toEqual([{ column: 'manufacturer', text: 'demo' }]);
    expect(back.criteria.sort).toBeNull();
    expect(back.criteria.pageSize).toBe(criteriaFromQuery(new URLSearchParams()).pageSize);
    expect(back.selection).toEqual({ equipClass: ['HEATER'] });
    expect(back.columns).toEqual(DEFAULT_COLUMNS);
  });

  it('cannot read text that is not a definition', () => {
    expect(viewOf('not json')).toBeNull();
    expect(viewOf('[1,2]')).toBeNull();
  });
});
