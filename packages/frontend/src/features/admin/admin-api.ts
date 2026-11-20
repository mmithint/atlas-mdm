/**
 * The Admin page's calls (S-13). None of these functions exists yet: APP-9 builds them (`FINAL PLAN/03` §2.2).
 * Until then they answer from sample data in the client demo only (`previewInvoke`, FINAL PLAN/11).
 */
import { previewInvoke } from '@/lib/preview-invoke';

export const fetchAdminData = () => previewInvoke('getAdminData', {});
export const addMember = (groupKey: string, displayName: string, email: string) => previewInvoke('adminAddMember', { groupKey, displayName, email });
export const removeMember = (groupKey: string, email: string) => previewInvoke('adminRemoveMember', { groupKey, email });
export const setRoute = (routeId: number, responsibleRole: string, accountableRole: string) => previewInvoke('adminSetRoute', { routeId, responsibleRole, accountableRole });
export const setDropdownValue = (fieldCode: string, value: string, active: boolean) => previewInvoke('adminSetDropdownValue', { fieldCode, value, active });
export const setMandatory = (fieldCode: string, mandatory: boolean) => previewInvoke('adminSetMandatory', { fieldCode, mandatory });
