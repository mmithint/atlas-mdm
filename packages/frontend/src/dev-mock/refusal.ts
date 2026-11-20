/**
 * A procedure saying no, in the demo (`npm run dev:mock` only). The sample handlers throw it; the wrapper in
 * preview-handlers.ts turns it into the same answer the real functions give (`status: 'REFUSED'`, the sentence
 * in `error`, the 50xxx number in `errorCode`), so the pages show it exactly as they will for real.
 */
export class Refusal extends Error {
  constructor(
    message: string,
    readonly errorCode: number
  ) {
    super(message);
    this.name = 'Refusal';
  }
}
