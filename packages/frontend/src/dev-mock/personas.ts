/**
 * The five people the client demo can switch between (FINAL PLAN/11 §4.2; personas from POC_Final/03 §1.1).
 * `npm run dev:mock` only.
 *
 * The roles, groups and profit centres are the client's own names, already in the committed seeds
 * (db/seed/0101-0104): metadata, not row data. The people are invented: "(sample)" names and addresses
 * ending @example.test. Never put a real person here (CLAUDE.md hard rule 2).
 */
import type { AppFunctionsSchema as S } from '@rayfin-app/functions/types';

type Profile = S['getMyProfile']['output'];
type Scope = Profile['responsibleScope'];

export type PersonaId = 'field' | 'responsible' | 'accountable' | 'author' | 'admin';

export interface Persona {
  id: PersonaId;
  /** What the switcher shows: the part this person plays in the demo. */
  title: string;
  displayName: string;
  email: string;
  roles: string[];
  groups: string[];
  canSubmitRequests: boolean;
  canEditRules: boolean;
  canPublishRules: boolean;
  canResponsibleApprove: boolean;
  canAccountableApprove: boolean;
  canManageAdmin: boolean;
  responsibleScope: Scope;
  accountableScope: Scope;
}

const NONE: Scope = { allOrcm: false, profitCenters: [] };
const ALL: Scope = { allOrcm: true, profitCenters: [] };

export const PERSONAS: readonly Persona[] = [
  {
    id: 'field',
    title: 'Field lead',
    displayName: 'Riley Brooks (sample)',
    email: 'riley.brooks@example.test',
    roles: ['Operations-PT'],
    groups: ['Operations-PT'],
    canSubmitRequests: true,
    canEditRules: false,
    canPublishRules: false,
    canResponsibleApprove: false,
    canAccountableApprove: false,
    canManageAdmin: false,
    responsibleScope: NONE,
    accountableScope: NONE,
  },
  {
    id: 'responsible',
    title: 'Responsible approver',
    displayName: 'Sam Carter (sample)',
    email: 'sam.carter@example.test',
    roles: ['Operations-IOC'],
    groups: ['Operations-IOC-Carlsbad'],
    canSubmitRequests: true,
    canEditRules: false,
    canPublishRules: false,
    canResponsibleApprove: true,
    canAccountableApprove: false,
    canManageAdmin: false,
    responsibleScope: { allOrcm: false, profitCenters: ['OP RES DB NM'] },
    accountableScope: NONE,
  },
  {
    id: 'accountable',
    title: 'Accountable approver',
    displayName: 'Jordan Lee (sample)',
    email: 'jordan.lee@example.test',
    roles: ['SAPBusinessSupport'],
    groups: ['SAPBusinessSupport'],
    canSubmitRequests: true,
    canEditRules: true,
    canPublishRules: true,
    canResponsibleApprove: false,
    canAccountableApprove: true,
    canManageAdmin: false,
    responsibleScope: NONE,
    accountableScope: ALL,
  },
  {
    id: 'author',
    title: 'Rule author / data owner',
    displayName: 'Morgan Diaz (sample)',
    email: 'morgan.diaz@example.test',
    roles: ['DataQualityOwner', 'HSESDS'],
    groups: ['DataQualityOwner', 'HSESDS'],
    canSubmitRequests: true,
    canEditRules: true,
    canPublishRules: false,
    canResponsibleApprove: false,
    canAccountableApprove: false,
    canManageAdmin: false,
    responsibleScope: NONE,
    accountableScope: NONE,
  },
  {
    id: 'admin',
    title: 'Admin',
    displayName: 'Alex Kim (sample)',
    email: 'alex.kim@example.test',
    roles: ['Admin'],
    groups: [],
    canSubmitRequests: true,
    canEditRules: true,
    canPublishRules: true,
    canResponsibleApprove: true,
    canAccountableApprove: true,
    canManageAdmin: true,
    responsibleScope: ALL,
    accountableScope: ALL,
  },
];

/** The demo opens as the admin, who sees every page. */
export const DEFAULT_PERSONA: PersonaId = 'admin';

const STORAGE_KEY = 'atlas-demo-persona';

function isPersonaId(value: unknown): value is PersonaId {
  return PERSONAS.some((p) => p.id === value);
}

function readStored(): PersonaId {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return isPersonaId(value) ? value : DEFAULT_PERSONA;
  } catch {
    return DEFAULT_PERSONA;
  }
}

let current: PersonaId = readStored();

export function currentPersona(): Persona {
  return PERSONAS.find((p) => p.id === current) ?? PERSONAS[PERSONAS.length - 1];
}

/** Switches the person the app answers for. Kept for the browser tab, so a reload keeps the persona. */
export function setPersona(id: PersonaId): void {
  current = id;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage blocked (private window): the switch still works until the page is reloaded.
  }
}

export function personaByEmail(email: string | null | undefined): Persona | undefined {
  return PERSONAS.find((p) => p.email === email);
}

/** The `getMyProfile` answer for a persona, shaped exactly like the real function's. */
export function profileOf(p: Persona): Profile {
  return {
    status: 'OK',
    userId: `sample-${p.id}`,
    email: p.email,
    displayName: p.displayName,
    roles: p.roles,
    groups: p.groups,
    canView: true,
    canSubmitRequests: p.canSubmitRequests,
    canEditRules: p.canEditRules,
    canPublishRules: p.canPublishRules,
    canResponsibleApprove: p.canResponsibleApprove,
    canAccountableApprove: p.canAccountableApprove,
    canManageAdmin: p.canManageAdmin,
    responsibleScope: p.responsibleScope,
    accountableScope: p.accountableScope,
  };
}
