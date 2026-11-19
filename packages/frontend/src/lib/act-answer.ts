/**
 * Turns the answer of a function that acts for a person (the request functions of APP-3 and the
 * read functions of APP-4) into either its data or an exception that carries the function's own words.
 *
 * Every such function answers with the same envelope (`packages/functions/src/runner.ts`):
 * `ok`, `status`, `error`, `errorCode`. A failure comes back INSIDE the answer, never thrown, because
 * the platform replaces the message of a thrown error with "InternalError ..." (found 15 Nov, APP-2).
 *
 *   status  OK | INVALID | NOT_AUTHENTICATED | NOT_REGISTERED | REFUSED | FAILED
 *   REFUSED means a stored procedure said no with its own message (error numbers 50xxx):
 *   `errorCode` is that number, `error` is the sentence to show.
 */
export interface ActAnswer {
  ok: boolean;
  status: string;
  error: string | null;
  errorCode: number | null;
}

/** An answer that was not `ok`. `status` and `errorCode` let a screen react to a particular refusal. */
export class ActError extends Error {
  readonly status: string;
  readonly errorCode: number | null;

  constructor(answer: ActAnswer) {
    super(answer.error ?? `The server answered ${answer.status}.`);
    this.name = 'ActError';
    this.status = answer.status;
    this.errorCode = answer.errorCode;
  }
}

/** Returns the answer when it worked; throws an `ActError` carrying the function's message when it did not. */
export function unwrapAct<T extends ActAnswer>(answer: T): T {
  if (!answer.ok) throw new ActError(answer);
  return answer;
}

/** The sentence to show for any caught error. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
