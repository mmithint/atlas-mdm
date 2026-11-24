/**
 * Field view (S-6) configuration and SAMPLE data. Every option, rule and field the screens use comes from here,
 * never from the components: the location hierarchy (node, parent, level), the heaters per location with their
 * SAP values, the field catalogue (group, control, allowed values, unit, admin-only, locked, key field) and the
 * photos each equipment class needs. TODO(backend): replace the sample arrays with the location hierarchy config,
 * the gold heater view and the field catalogue when the Field view functions are built.
 */

export type LocationLevel = 'BU' | 'SUB_ASSET' | 'SITE';
export type SiteKind = 'FACILITY' | 'WELL_PAD';

export interface LocationNode {
  id: string;
  parentId: string | null;
  level: LocationLevel;
  /** Sites only: a facility or a well pad. */
  kind?: SiteKind;
  label: string;
  /** Sites only: the SAP functional location heaters hang under (the "final parent location"). */
  floc?: string;
}

export const LEVELS: readonly { level: LocationLevel; label: string; empty: string }[] = [
  { level: 'BU', label: 'Business unit', empty: 'No business units are set up.' },
  { level: 'SUB_ASSET', label: 'Sub-asset', empty: 'Select a business unit first' },
  { level: 'SITE', label: 'Facility', empty: 'Select a sub-asset first' },
];

export const SITE_KINDS: readonly { kind: SiteKind; label: string; plural: string }[] = [
  { kind: 'FACILITY', label: 'Facility', plural: 'facilities' },
  { kind: 'WELL_PAD', label: 'Well pad', plural: 'well pads' },
];

export const LOCATIONS: readonly LocationNode[] = [
  { id: 'bu-perm', parentId: null, level: 'BU', label: 'Permian Resources' },
  { id: 'bu-rock', parentId: null, level: 'BU', label: 'Rockies' },
  { id: 'sa-dbnm', parentId: 'bu-perm', level: 'SUB_ASSET', label: 'Delaware Basin NM' },
  { id: 'sa-dbtx', parentId: 'bu-perm', level: 'SUB_ASSET', label: 'Delaware Basin TX' },
  { id: 'sa-dj', parentId: 'bu-rock', level: 'SUB_ASSET', label: 'DJ Basin' },
  { id: 'st-cbad', parentId: 'sa-dbnm', level: 'SITE', kind: 'FACILITY', label: 'Carlsbad Central Battery', floc: 'SYN-FL-AREA-01' },
  { id: 'st-lov', parentId: 'sa-dbnm', level: 'SITE', kind: 'FACILITY', label: 'Loving Compressor Station', floc: 'SYN-FL-AREA-02' },
  { id: 'st-wp7', parentId: 'sa-dbnm', level: 'SITE', kind: 'WELL_PAD', label: 'Red Hills Pad 7', floc: 'SYN-FL-PAD-07' },
  { id: 'st-pec', parentId: 'sa-dbtx', level: 'SITE', kind: 'FACILITY', label: 'Pecos Gas Plant', floc: 'SYN-FL-AREA-03' },
  { id: 'st-wp12', parentId: 'sa-dj', level: 'SITE', kind: 'WELL_PAD', label: 'Wattenberg Pad 12', floc: 'SYN-FL-PAD-12' },
];

/** The SAP value of every field, by field key; null = blank in SAP. */
export type SapValues = Readonly<Record<string, string | null>>;

export interface SampleHeater {
  equipmentNo: string;
  tag: string;
  floc: string;
  siteId: string;
  manufacturer: string;
  verifiedPct: number;
  sap: SapValues;
  /** What "Read nameplate with AI" finds on this heater's nameplate photo (sample). */
  nameplate: { manufacturer: string; model: string; serial: string };
}

const sap = (over: Record<string, string | null>): SapValues => ({
  userStatus: 'OPER',
  flocClass: 'HEATER',
  flocClassDesc: 'Fired heater location',
  equipClass: 'HEATER',
  equipClassDesc: 'Fired heater',
  dimensions: '4 x 20',
  classType: 'HEATER',
  tag: null,
  manufacturer: null,
  equipStatus: 'In service',
  burnerCount: '1',
  heatDuty: '2.5',
  service: 'Gas heating',
  length: '20',
  designPressure: '150',
  designTemp: '650',
  material: 'Carbon steel',
  nationalBoard: null,
  equipmentNo: null,
  floc: null,
  userStatusDesc: 'Operating',
  ...over,
});

const heater = (n: number, siteId: string, floc: string, manufacturer: string, verifiedPct: number, over: Record<string, string | null> = {}): SampleHeater => {
  const no = `SYN-EQ-${String(n).padStart(4, '0')}`;
  const tag = `SYN-TAG-${String(n).padStart(4, '0')}`;
  const heaterFloc = `${floc}-H${n}`;
  return {
    equipmentNo: no,
    tag,
    floc: heaterFloc,
    siteId,
    manufacturer,
    verifiedPct,
    sap: sap({ tag, manufacturer, equipmentNo: no, floc: heaterFloc, ...over }),
    nameplate: { manufacturer: manufacturer.toUpperCase(), model: `SYN-MODEL-${(n % 4) + 1}`, serial: `SYN-SN-${String(n).padStart(4, '0')}` },
  };
};

export const HEATERS: readonly SampleHeater[] = [
  heater(1, 'st-cbad', 'SYN-FL-AREA-01', 'Example Heater Co.', 80, { nationalBoard: 'NB-10231' }),
  heater(2, 'st-cbad', 'SYN-FL-AREA-01', 'Demo Thermal Inc.', 40, { equipClass: 'LINE_HEATER', equipClassDesc: 'Line heater', heatDuty: null }),
  heater(3, 'st-cbad', 'SYN-FL-AREA-01', 'Sample Burner Works', 100),
  heater(4, 'st-lov', 'SYN-FL-AREA-02', 'Demo Thermal Inc.', 60, { equipClass: 'HEATER_TREATER', equipClassDesc: 'Heater treater' }),
  heater(5, 'st-wp7', 'SYN-FL-PAD-07', 'Example Heater Co.', 20, { equipClass: 'LINE_HEATER', equipClassDesc: 'Line heater' }),
  heater(6, 'st-pec', 'SYN-FL-AREA-03', 'Sample Burner Works', 0),
];

export type FieldGroup = 'EQUIPMENT' | 'CHARACTERISTICS' | 'SAP';
export type FieldControl = 'list' | 'number' | 'text' | 'dimensions';

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  control: FieldControl;
  /** Choices of a list field. */
  options?: readonly string[];
  unit?: string;
  /** Only an admin may change it; others see the SAP value only. */
  adminOnly?: boolean;
  /** SAP information: shown, never verified here. */
  locked?: boolean;
  /** A key field: counted in the progress bar, and must be Correct or corrected before Submit. */
  keyField?: boolean;
}

export const GROUPS: readonly { group: FieldGroup; label: string }[] = [
  { group: 'EQUIPMENT', label: 'Equipment' },
  { group: 'CHARACTERISTICS', label: 'Equipment characteristics' },
  { group: 'SAP', label: 'SAP information' },
];

const CLASSES = ['HEATER', 'HEATER_TREATER', 'LINE_HEATER'];

export const FIELDS: readonly FieldDef[] = [
  { key: 'userStatus', label: 'User status', group: 'EQUIPMENT', control: 'list', options: ['OPER', 'AVFS', 'NOPE', 'DECM'] },
  { key: 'flocClass', label: 'FLOC class', group: 'EQUIPMENT', control: 'list', options: CLASSES, adminOnly: true },
  { key: 'flocClassDesc', label: 'FLOC class description', group: 'EQUIPMENT', control: 'text' },
  { key: 'equipClass', label: 'Equipment class', group: 'EQUIPMENT', control: 'list', options: CLASSES, adminOnly: true, keyField: true },
  { key: 'equipClassDesc', label: 'Equipment class description', group: 'EQUIPMENT', control: 'text' },
  { key: 'dimensions', label: 'Equipment size/dimensions', group: 'EQUIPMENT', control: 'dimensions', unit: 'ft' },
  { key: 'classType', label: 'Class type', group: 'EQUIPMENT', control: 'list', options: CLASSES },
  { key: 'tag', label: 'Equipment tag number', group: 'EQUIPMENT', control: 'text', keyField: true },
  { key: 'manufacturer', label: 'Equipment manufacturer', group: 'EQUIPMENT', control: 'text', keyField: true },
  { key: 'equipStatus', label: 'Equipment status', group: 'EQUIPMENT', control: 'list', options: ['In service', 'Out of service', 'Removed'], keyField: true },
  { key: 'burnerCount', label: 'Burner count (internals)', group: 'CHARACTERISTICS', control: 'number' },
  { key: 'heatDuty', label: 'Heat duty', group: 'CHARACTERISTICS', control: 'number', unit: 'MMBTU/hr', keyField: true },
  { key: 'service', label: 'Service', group: 'CHARACTERISTICS', control: 'text' },
  { key: 'length', label: 'Length', group: 'CHARACTERISTICS', control: 'number', unit: 'ft' },
  { key: 'designPressure', label: 'Design pressure', group: 'CHARACTERISTICS', control: 'number', unit: 'PSIG' },
  { key: 'designTemp', label: 'Design temperature', group: 'CHARACTERISTICS', control: 'number', unit: 'deg F' },
  { key: 'material', label: 'Material of construction', group: 'CHARACTERISTICS', control: 'list', options: ['Carbon steel', 'Stainless steel', 'Alloy steel'] },
  { key: 'nationalBoard', label: 'National board number', group: 'CHARACTERISTICS', control: 'text' },
  { key: 'equipmentNo', label: 'Equipment number', group: 'SAP', control: 'text', locked: true },
  { key: 'floc', label: 'Functional location', group: 'SAP', control: 'text', locked: true },
  { key: 'userStatusDesc', label: 'User status description', group: 'SAP', control: 'text', locked: true },
];

/** The photos each equipment class needs before Submit; classes not listed need the default set. */
export const REQUIRED_PHOTOS: Readonly<Record<string, readonly string[]>> = {
  DEFAULT: ['Nameplate'],
  HEATER: ['Nameplate', 'Overall view'],
  HEATER_TREATER: ['Nameplate', 'Overall view', 'Burner'],
};

/** The minimal fields of a new equipment request (step 2, on site but not in the list). */
export const NEW_EQUIPMENT_CLASSES = CLASSES;
