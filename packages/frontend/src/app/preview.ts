/**
 * True only under `npm run dev:mock` (Vite mode `mock`), where the client demo runs on sample data
 * (FINAL PLAN/11, APP-D). Then every page opens, including the ones a later phase builds for real; anywhere
 * else those pages keep their "arrives in APP-n" placeholder, so the deployed app never shows invented data.
 */
export const PREVIEW_MODE: boolean = import.meta.env.DEV && import.meta.env.MODE === 'mock';
