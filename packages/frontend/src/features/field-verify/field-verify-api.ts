import type { Draft, Photo } from './model';

/**
 * Sends the visit for approval. SAMPLE ONLY: answers a made-up request number after a short wait.
 * TODO(backend): one createChangeRequest per correction (source FIELD_VIEW, the photos as evidence), plus a
 * "Missing equipment" or "New equipment" request, through the existing approval flow; answer the first request ref.
 */
export async function submitVerification(draft: Draft, photos: readonly Photo[]): Promise<{ requestRef: string }> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  const seq = 1000 + ((Object.keys(draft.answers).length * 7 + photos.length) % 900);
  return { requestRef: `CR-SAMPLE-${seq}` };
}
