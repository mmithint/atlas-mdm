/**
 * A heater's latest rule results (`app.vw_equipment_rule_status`: latest result per heater × published rule).
 * Shape used by the APP-D preview (FINAL PLAN/11); APP-5 builds the function and may adjust it.
 */
export interface RuleStatusRow {
  ruleId: string;
  ruleName: string;
  version: number;
  routingMode: 'MANUAL' | 'AUTO_ROUTE';
  result: 'VALID' | 'INVALID';
  /** The rule's plain-English reason when INVALID. */
  message: string | null;
  /** The field a fix would change (a MANUAL rule may name one for the Fix button). */
  fieldCode: string | null;
  proposedValue: string | null;
  detectedAtUtc: string;
}
