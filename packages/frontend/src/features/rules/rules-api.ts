/**
 * The Rules screens' calls (S-9). None of these functions exists yet: APP-5 builds the engine and the
 * read-only catalog, APP-6 the editor (`FINAL PLAN/03` §2.2). Until then they answer from sample data in the
 * client demo only (`previewInvoke`, FINAL PLAN/11). When a function is built, its line here switches to
 * `client.functions.<name>.invoke` and the screens stay as they are.
 */
import { previewInvoke } from '@/lib/preview-invoke';

import type { RuleDraftInput, RuleVersion } from './rules-types';

export const fetchRuleCatalog = () => previewInvoke('getRuleCatalog', {});
export const fetchRule = (ruleId: string) => previewInvoke('getRuleDefinition', { ruleId });
export const saveRuleDraft = async (input: RuleDraftInput): Promise<RuleVersion> => (await previewInvoke('saveRuleDraft', input)).version;
export const createRuleVersion = async (ruleId: string, ruleName: string): Promise<RuleVersion> => (await previewInvoke('createRuleVersion', { ruleId, ruleName })).version;
export const testRule = (ruleId: string, version: number) => previewInvoke('testRule', { ruleId, version });
export const previewRule = (ruleId: string, version: number) => previewInvoke('previewRule', { ruleId, version });
export const publishRule = async (ruleId: string, version: number, reason: string): Promise<RuleVersion> => (await previewInvoke('publishRule', { ruleId, version, reason })).version;
export const runRulesNow = async () => (await previewInvoke('runRulesNow', {})).run;

export type RuleData = Awaited<ReturnType<typeof fetchRule>>;
export type CatalogData = Awaited<ReturnType<typeof fetchRuleCatalog>>;
export type PreviewData = Awaited<ReturnType<typeof previewRule>>;
