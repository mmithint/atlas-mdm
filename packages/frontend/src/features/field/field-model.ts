/** Shared by the field view's components (S-6). */
import type { Mark } from './field-types';

/** What the person has entered for one block. `mark` null = not touched (nothing is sent). */
export interface BlockEntry {
  mark: Mark | null;
  newValue: string;
  comment: string;
  unreadableReason: string;
  dne: boolean;
}

export const EMPTY_ENTRY: BlockEntry = { mark: null, newValue: '', comment: '', unreadableReason: '', dne: false };

export const MARK_LABEL: Record<Mark, string> = {
  VERIFIED_CORRECT: 'Verified correct',
  CORRECTION_REQUIRED: 'Correction required',
  DID_NOT_VERIFY: 'Did not verify',
};
