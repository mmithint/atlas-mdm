/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  whoAmI: {
    input: Record<string, never>;
    output: { tokenKind: 'jwt' | 'opaque' | 'missing'; claimNames: string[]; emailClaim: null | string; email: null | string; claims: { [k: string]: string } };
  };
  sqlPing: {
    input: Record<string, never>;
    output: { ok: boolean; step: 'token' | 'connect' | 'identity' | 'transaction' | 'done'; connectedAs: null | string; database: null | string; serverTimeUtc: null | string; connectMs: null | number; queryMs: null | number; totalMs: number; transaction: null | { rowsBefore: null | number; rowsInsideTransaction: null | number; rowsAfterRollback: null | number; rolledBack: boolean }; error: null | { number: null | number; message: string; hint: null | string } };
  };
};
