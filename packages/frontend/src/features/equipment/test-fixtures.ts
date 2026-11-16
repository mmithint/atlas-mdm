/**
 * Synthetic rows for the equipment tests. Everything here is invented (SYN- identifiers,
 * "SYNTHETIC MFR" manufacturers); nothing comes from the client.
 */
import type { HeaterDetail, SearchRow } from './equipment-api';

export function searchRow(n: number, over: Partial<Record<string, unknown>> = {}): SearchRow {
  const code = String(n).padStart(4, '0');
  return {
    equipmentId: n,
    equipmentNumber: `SYN-EQ-${code}`,
    equipmentDescription: `SYNTHETIC HEATER ${code}`,
    functionalLocation: `SYN-FL-${code}`,
    flocDescription: `SYNTHETIC SLOT ${code}`,
    superiorFunctionalLocation: 'SYN-FL-AREA-01',
    equipmentTagNumber: `SYN-TAG-${code}`,
    equipClass: 'HEATER',
    classType: 'HEATER',
    objectType: 'HEATER',
    flocClass: 'HEATER',
    techObjectType: 'PROCESS_UNIT',
    manufacturer: 'SYNTHETIC MFR A',
    modelNumber: 'SYN-MODEL-1',
    manufacturerSerialNumber: `SYN-SN-${code}`,
    firedUnfired: 'FIRED',
    heatDutyMmbtuHr: 2.5,
    heatDutySource: 'STATED',
    equipmentUserStatus: 'OPER',
    flocUserStatus: 'ACTV',
    profitCenterName: 'ROCKIES-DJ BASIN',
    plannerGroup: 'SYN-PG-01',
    heaterPopulationMethod: 'GHGRP',
    goldenVersionId: 1,
    lastChangedAtUtc: null,
    baselineAsOfUtc: '2000-01-01T00:00:00.000Z', // dates arrive as ISO text from the functions
    openRequestCount: 0,
    invalidRuleCount: null,
    verificationPct: 60,
    ...over,
  } as unknown as SearchRow;
}

export function heaterDetail(over: Partial<HeaterDetail> = {}): HeaterDetail {
  const heater = searchRow(1, { equipmentTagNumber: 'SYN-TAG-0001' });
  return {
    heater: heater as unknown as HeaterDetail['heater'],
    floc: {
      functionalLocation: 'SYN-FL-0001',
      level1Id: 'SYN-ORG',
      level2Id: 'SYN-BU-01',
      level3Id: 'SYN-AREA-01',
    } as unknown as HeaterDetail['floc'],
    fieldValues: [
      { equipmentFieldKey: '1|MANUFACTURER', fieldCode: 'MANUFACTURER', currentValue: 'SYNTHETIC MFR A', baselineValue: 'SYNTHETIC MFR A', valueSource: 'STATED' },
      { equipmentFieldKey: '1|HEAT_DUTY', fieldCode: 'HEAT_DUTY', currentValue: '2.5000', baselineValue: '2.5000', unit: 'MMBTU/hr', valueSource: 'STATED' },
      { equipmentFieldKey: '1|EQUIPMENT_TAG_NUMBER', fieldCode: 'EQUIPMENT_TAG_NUMBER', currentValue: 'SYN-TAG-0001', baselineValue: 'SYN-TAG-0001', valueSource: 'STATED' },
    ] as unknown as HeaterDetail['fieldValues'],
    catalog: [
      { fieldCode: 'MANUFACTURER', label: 'Manufacturer', entityType: 'EQUIPMENT', dataType: 'TEXT', displayGroup: 'KEY', displayOrder: 1, isEditable: true, isKeyVerificationField: true },
      { fieldCode: 'HEAT_DUTY', label: 'Heat duty (MMBTU/hr)', entityType: 'EQUIPMENT', dataType: 'DECIMAL', unit: 'MMBTU/hr', displayGroup: 'KEY', displayOrder: 5, isEditable: true, isKeyVerificationField: true },
      { fieldCode: 'EQUIPMENT_TAG_NUMBER', label: 'Engineering tag', entityType: 'EQUIPMENT', dataType: 'TEXT', displayGroup: 'ADDITIONAL', displayOrder: 6, isEditable: true },
      { fieldCode: 'FLOC_CLASS', label: 'FLOC class', entityType: 'FLOC', dataType: 'CODE', displayGroup: 'ADDITIONAL', displayOrder: 13, isEditable: true },
    ] as unknown as HeaterDetail['catalog'],
    ownership: [
      { fieldOwnershipKey: 'EQUIPMENT|MANUFACTURER', fieldCode: 'MANUFACTURER', responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' },
      { fieldOwnershipKey: 'EQUIPMENT|HEAT_DUTY', fieldCode: 'HEAT_DUTY', responsibleRole: 'Operations-IOC', accountableRole: 'SAPBusinessSupport' },
    ] as unknown as HeaterDetail['ownership'],
    ...over,
  };
}
