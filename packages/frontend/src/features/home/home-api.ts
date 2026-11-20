/**
 * The Home page's calls (S-1). "My work" reuses `getRequestQueue` (already built, APP-4): its answer carries the
 * person's tab counts whatever tab is asked for. The programme sections come from `getHomeSummary`, which APP-8
 * builds; until then it answers from sample data in the client demo only (`previewInvoke`, FINAL PLAN/11).
 */
import { fetchQueue } from '@/features/approvals/queue-api';
import { criteriaFromQuery } from '@/features/approvals/queue-model';
import { previewInvoke } from '@/lib/preview-invoke';

import type { HomeSummary } from './home-types';

export const fetchMyCounts = async () => (await fetchQueue(criteriaFromQuery(new URLSearchParams()), 0)).counts;

export const fetchHomeSummary = async (): Promise<HomeSummary> => {
  const { dataQuality, pipeline } = await previewInvoke('getHomeSummary', {});
  return { dataQuality, pipeline };
};
