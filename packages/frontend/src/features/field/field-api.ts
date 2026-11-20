/**
 * The field view's calls (S-6). None of these functions exists yet: APP-7 builds them (`FINAL PLAN/03` §2.2).
 * Until then they answer from sample data in the client demo only (`previewInvoke`, FINAL PLAN/11). When a
 * function is built, its line here switches to `client.functions.<name>.invoke` and the page stays as it is.
 */
import { previewInvoke } from '@/lib/preview-invoke';

import type { FieldFormSubmit, PhotoType } from './field-types';

export const fetchFieldLookups = () => previewInvoke('getFieldLookups', {});
export const fetchSiteHeaters = async (site: string, subAsset: string) => (await previewInvoke('getSiteHeaters', { site, subAsset })).heaters;
export const fetchFieldForm = (equipmentId: number) => previewInvoke('getFieldForm', { equipmentId });
export const submitFieldForm = (input: FieldFormSubmit) => previewInvoke('submitFieldForm', input);
export const registerPhoto = async (input: { equipmentId: number; fileName: string; contentType: string; photoType: PhotoType; dataUrl: string }) =>
  (await previewInvoke('registerPhoto', input)).photo;
export const readNameplate = (equipmentId: number, fileId: number) => previewInvoke('extractNameplate', { equipmentId, fileId });
