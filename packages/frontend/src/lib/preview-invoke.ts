import type { PreviewFunctionName, PreviewFunctions } from './preview-functions';

/** A page asked for a function no phase has built yet, outside `npm run dev:mock`. */
export class NotBuiltError extends Error {
  constructor(readonly functionName: string) {
    super(`"${functionName}" is not built yet. This page runs only on sample data (npm run dev:mock) until its phase builds it.`);
    this.name = 'NotBuiltError';
  }
}

/**
 * Calls a function listed in `preview-functions.ts`. These functions do not exist on the server, so the call
 * never goes through the Rayfin client: under `npm run dev:mock` the sample-data handler answers
 * (`dev-mock/preview-handlers.ts`); anywhere else it refuses. The condition is written out so a production
 * build drops the import and the dev-mock folder with it.
 */
export async function previewInvoke<K extends PreviewFunctionName>(
  name: K,
  input: PreviewFunctions[K]['input']
): Promise<PreviewFunctions[K]['output']> {
  if (!(import.meta.env.DEV && import.meta.env.MODE === 'mock')) throw new NotBuiltError(name);
  const { invokePreview } = await import('@/dev-mock/preview-handlers');
  return invokePreview(name, input);
}
