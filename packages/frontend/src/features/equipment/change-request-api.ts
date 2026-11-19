/**
 * What the S-5 request dialog and the "Requests on this heater" list call (APP-4).
 *
 * All three are functions of the request path (D-17: the connector cannot read views, and "may this person
 * submit" depends on who is asking). Each answers with the common envelope (`lib/act-answer.ts`), so a refusal
 * or failure comes back as text and `unwrapAct` turns it into an exception carrying the function's own words.
 * The row types are the functions' own output types: a change to an answer shows up here as a compile error.
 */
import type { AppFunctionsSchema } from '@rayfin-app/functions/types';

import { unwrapAct } from '@/lib/act-answer';
import { getRayfinClient } from '@/lib/rayfin-client';

type FormOptionsAnswer = AppFunctionsSchema['getRequestFormOptions']['output'];
type EquipmentRequestsAnswer = AppFunctionsSchema['getEquipmentRequests']['output'];

export type CreateArguments = AppFunctionsSchema['createChangeRequest']['input'];
export type CreateAnswer = AppFunctionsSchema['createChangeRequest']['output'];
export type AllowedValueRow = FormOptionsAnswer['allowedValues'][number];
export type BlockedFieldRow = FormOptionsAnswer['blockedFields'][number];
export type RelatedRequestRow = EquipmentRequestsAnswer['rows'][number];

/** What the request form needs to know about the signed-in person and the catalogue. */
export interface FormOptions {
  /** True when the person is registered and a role of theirs allows submitting requests. */
  canSubmit: boolean;
  isAdmin: boolean;
  /** The active drop-down values of every LIST field. */
  allowedValues: AllowedValueRow[];
  /** Fields this person may not request (the admin-only ones, unless they are an admin), each with the reason. */
  blockedFields: BlockedFieldRow[];
}

export interface EquipmentRequests {
  /** How many requests there are in all; `rows` holds the newest 100. */
  totalCount: number;
  rows: RelatedRequestRow[];
}

export async function fetchFormOptions(): Promise<FormOptions> {
  const answer = unwrapAct(await (await getRayfinClient()).functions.getRequestFormOptions.invoke());
  return {
    canSubmit: answer.canSubmit,
    isAdmin: answer.isAdmin,
    allowedValues: answer.allowedValues,
    blockedFields: answer.blockedFields,
  };
}

/** Creates the request. Resolves with the answer (its `outcome` says created, duplicate or blocked); rejects on a refusal. */
export async function submitChangeRequest(args: CreateArguments): Promise<CreateAnswer> {
  return unwrapAct(await (await getRayfinClient()).functions.createChangeRequest.invoke(args));
}

export async function fetchEquipmentRequests(equipmentId: number): Promise<EquipmentRequests> {
  const answer = unwrapAct(await (await getRayfinClient()).functions.getEquipmentRequests.invoke({ equipmentId }));
  return { totalCount: answer.totalCount, rows: answer.rows };
}
