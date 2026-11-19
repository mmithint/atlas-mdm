import { describe, expect, it } from 'vitest';

import { NotBuiltError, previewInvoke } from './preview-invoke';

describe('previewInvoke', () => {
  it('refuses outside npm run dev:mock, naming the function, so no page can reach a function that does not exist', async () => {
    await expect(previewInvoke('markNotificationsRead', { notificationIds: '' })).rejects.toBeInstanceOf(NotBuiltError);
    await expect(previewInvoke('markNotificationsRead', { notificationIds: '' })).rejects.toThrow(/markNotificationsRead/);
  });
});
