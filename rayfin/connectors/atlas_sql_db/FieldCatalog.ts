import { entity, int, text, boolean, role } from '@microsoft/rayfin-core';
import { Source } from '@microsoft/rayfin-connectors';

// app.field_catalog: the fields the app shows, verifies and lets users change
// (FINAL PLAN/09 section 2.2; the 13 rows of version 1 are in 01 section 6.2).
// A TABLE with a real primary key (field_code). Read only (decision D-02).
// Only the columns the screens need are mapped: the SAP mapping columns the data
// engineer fills (sap_object, sap_table, sap_column, characteristic_name, gold_column)
// stay out of the browser.
@role('authenticated', ['read'])
@entity()
export class FieldCatalog extends Source({
  schema: 'app',
  table: 'field_catalog',
  primaryKey: ['fieldCode'],
}) {
  @text({ column: 'field_code', max: 64 }) fieldCode!: string;
  @text({ column: 'label', optional: true, max: 100 }) label?: string;
  @text({ column: 'entity_type', optional: true, max: 10 }) entityType?: string;
  @text({ column: 'data_type', optional: true, max: 10 }) dataType?: string;
  @int({ column: 'max_length', optional: true }) maxLength?: number;
  @text({ column: 'unit', optional: true, max: 20 }) unit?: string;
  @text({ column: 'allowed_values_source', optional: true, max: 30 }) allowedValuesSource?: string;
  @boolean({ column: 'is_key_verification_field', optional: true }) isKeyVerificationField?: boolean;
  @boolean({ column: 'is_editable', optional: true }) isEditable?: boolean;
  @text({ column: 'display_group', optional: true, max: 12 }) displayGroup?: string;
  @int({ column: 'display_order', optional: true }) displayOrder?: number;
  @boolean({ column: 'is_mandatory_for_submission', optional: true }) isMandatoryForSubmission?: boolean;
  @boolean({ column: 'is_active', optional: true }) isActive?: boolean;
}
