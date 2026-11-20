/**
 * Sample-data answers for the functions no phase has built yet (`lib/preview-functions.ts`), used ONLY by
 * `npm run dev:mock`. Each handler reads and writes the demo store, like the mock handlers of the built
 * functions. A phase that builds a function for real deletes its handler here.
 */
import type { ActAnswer } from '@/lib/act-answer';
import type { PreviewFunctions } from '@/lib/preview-functions';

import * as field from './demo-field';
import * as rules from './demo-rules';
import { inboxOf, isReadBy, me } from './demo-store';
import { Refusal } from './refusal';

type Output<K extends keyof PreviewFunctions> = PreviewFunctions[K]['output'];
type PreviewHandlers = { [K in keyof PreviewFunctions]: (input: PreviewFunctions[K]['input']) => Output<K> };

const OK = { ok: true, status: 'OK', error: null, errorCode: null } as const;

/** Runs one handler body; a `Refusal` becomes the REFUSED answer the real functions give. */
function answer<T extends object>(body: () => T): ActAnswer & T {
  try {
    return { ...OK, ...body() };
  } catch (error) {
    if (error instanceof Refusal) {
      return { ok: false, status: 'REFUSED', error: error.message, errorCode: error.errorCode } as ActAnswer & T;
    }
    throw error;
  }
}

export const previewHandlers: PreviewHandlers = {
  getRuleCatalog: () => answer(() => rules.catalog()),
  getRuleDefinition: ({ ruleId }) => answer(() => rules.definition(ruleId)),
  saveRuleDraft: (input) => answer(() => ({ version: rules.saveDraft(input) })),
  createRuleVersion: ({ ruleId, ruleName }) => answer(() => ({ version: rules.createVersion(ruleId, ruleName) })),
  testRule: ({ ruleId, version }) => answer(() => rules.test(ruleId, version)),
  previewRule: ({ ruleId, version }) => answer(() => rules.preview(ruleId, version)),
  publishRule: ({ ruleId, version, reason }) => answer(() => ({ version: rules.publish(ruleId, version, reason) })),
  runRulesNow: () => answer(() => ({ run: rules.runNow() })),
  getEquipmentRuleStatus: ({ equipmentId }) => answer(() => rules.ruleStatus(equipmentId)),

  getHeaterVerification: ({ equipmentId }) => answer(() => field.verification(equipmentId)),
  getEquipmentEvidence: ({ equipmentId, requestId }) => answer(() => field.evidence(equipmentId, requestId)),
  registerPhoto: (input) => answer(() => ({ photo: field.registerPhoto(input) })),
  extractNameplate: ({ equipmentId, fileId }) => answer(() => field.extractNameplate(equipmentId, fileId)),
  submitFieldVerification: ({ equipmentId, entries, photoIds }) => answer(() => field.submit(equipmentId, entries, photoIds)),
  getVerificationScorecard: ({ profitCenter }) => answer(() => field.scorecard(profitCenter)),

  markNotificationsRead: ({ notificationIds }) =>
    answer(() => {
      const wanted = new Set(
        notificationIds
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
      const email = me();
      let marked = 0;
      for (const n of inboxOf()) {
        if ((wanted.size === 0 || wanted.has(n.notificationId)) && !isReadBy(n, email)) {
          n.readBy.push(email);
          marked += 1;
        }
      }
      return { marked, unreadCount: inboxOf().filter((n) => !isReadBy(n, email)).length };
    }),
};

/** A short pause so loading states are visible, like a real call (same as mock-client). */
const LATENCY_MS = 150;

/** What `lib/preview-invoke.ts` calls under `npm run dev:mock`. Answers a copy, so a page cannot change the store by accident. */
export async function invokePreview<K extends keyof PreviewFunctions>(name: K, input: PreviewFunctions[K]['input']): Promise<Output<K>> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  const handler = previewHandlers[name] as (i: PreviewFunctions[K]['input']) => Output<K>;
  return structuredClone(handler(input));
}
