import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchNotifications } = vi.hoisted(() => ({ fetchNotifications: vi.fn() }));
vi.mock('./notifications-api', () => ({ fetchNotifications }));

import { NotificationBell } from './notification-bell.component';

const item = (n: number, over: Record<string, unknown> = {}) => ({
  notificationId: n,
  topic: 'REQUEST_PENDING_RESPONSIBLE',
  requestId: 40 + n,
  requestRef: `CR-0000${40 + n}`,
  title: `Request CR-0000${40 + n} needs your approval`,
  body: 'Heat duty of SYN-EQ-0001 waits for you.',
  createdAtUtc: '2026-11-17T09:30:00.000Z',
  isRead: false,
  ...over,
});

const bell = (name: RegExp | string) => screen.getByRole('button', { name });

describe('Notification bell', () => {
  beforeEach(() => {
    fetchNotifications.mockReset();
  });

  it('shows how many notifications are not yet marked read, on the button and in its name', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 3, items: [item(1), item(2), item(3)] });
    render(<NotificationBell refreshKey="/" />);
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toHaveTextContent('3');
    expect(fetchNotifications).toHaveBeenCalledWith(10);
  });

  it('shows no number when there is nothing unread, and caps a large one', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 0, items: [] });
    const { unmount } = render(<NotificationBell refreshKey="/" />);
    await screen.findByRole('button', { name: 'Notifications' });
    expect(bell('Notifications')).toHaveTextContent('');
    unmount();

    fetchNotifications.mockResolvedValue({ unreadCount: 250, items: [] });
    render(<NotificationBell refreshKey="/" />);
    expect(await screen.findByRole('button', { name: 'Notifications, 250 unread' })).toHaveTextContent('99+');
  });

  it('opens a list with title, body, time and a link to the request; unread ones are marked', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 1, items: [item(1), item(2, { isRead: true, title: 'Request CR-000042 was approved' })] });
    render(<NotificationBell refreshKey="/" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));

    const list = screen.getByRole('region', { name: 'Your notifications' });
    expect(within(list).getByText(/1 not yet marked as read/)).toBeInTheDocument();
    const unread = within(list).getByRole('link', { name: /needs your approval/ });
    expect(unread).toHaveAttribute('href', '#/requests/41');
    expect(unread).toHaveTextContent('Unread:');
    expect(unread).toHaveTextContent('Heat duty of SYN-EQ-0001 waits for you.');
    expect(unread).toHaveTextContent('17 Nov 2026');
    const read = within(list).getByRole('link', { name: /was approved/ });
    expect(read).not.toHaveTextContent('Unread:');
  });

  it('says plainly that nothing can be marked read yet', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 1, items: [item(1)] });
    render(<NotificationBell refreshKey="/" />);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(screen.getByText(/does not go down yet/)).toBeInTheDocument();
  });

  it('has a quiet empty state', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 0, items: [] });
    render(<NotificationBell refreshKey="/" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });

  it('reloads every time it opens', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 0, items: [] });
    render(<NotificationBell refreshKey="/" />);
    await screen.findByRole('button', { name: 'Notifications' });
    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    fetchNotifications.mockResolvedValue({ unreadCount: 2, items: [item(1), item(2)] });
    await act(async () => {
      fireEvent.click(bell('Notifications'));
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
  });

  it('reloads when the page changes (refreshKey), keeping the old count meanwhile', async () => {
    fetchNotifications.mockResolvedValueOnce({ unreadCount: 1, items: [item(1)] });
    const { rerender } = render(<NotificationBell refreshKey="/approvals" />);
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });

    let finish: (value: unknown) => void = () => undefined;
    fetchNotifications.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    rerender(<NotificationBell refreshKey="/requests/5" />);
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
    expect(bell('Notifications, 1 unread')).toBeInTheDocument(); // not blanked while reloading

    await act(async () => finish({ unreadCount: 4, items: [] }));
    expect(bell('Notifications, 4 unread')).toBeInTheDocument();
  });

  it('shows a failure as a line inside the popover and never blocks the header', async () => {
    fetchNotifications.mockRejectedValue(new Error('Your sign-in is not linked to a person yet.'));
    render(<NotificationBell refreshKey="/" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded: Your sign-in is not linked to a person yet.');
    expect(bell('Notifications')).toBeEnabled();
  });

  it('keeps the earlier list when a later reload fails', async () => {
    fetchNotifications.mockResolvedValueOnce({ unreadCount: 1, items: [item(1)] });
    render(<NotificationBell refreshKey="/" />);
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fetchNotifications.mockRejectedValueOnce(new Error('timeout'));
    await act(async () => {
      fireEvent.click(bell('Notifications, 1 unread'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('timeout');
  });

  it('closes with Escape, with a click outside, and when a link is followed', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 1, items: [item(1)] });
    render(
      <div>
        <p>outside</p>
        <NotificationBell refreshKey="/" />
      </div>
    );
    const trigger = await screen.findByRole('button', { name: 'Notifications, 1 unread' });

    fireEvent.click(trigger);
    expect(screen.getByRole('region', { name: 'Your notifications' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Your notifications' })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('region', { name: 'Your notifications' })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('region', { name: 'Your notifications' }));
    expect(screen.getByRole('region', { name: 'Your notifications' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /needs your approval/ }));
    expect(screen.queryByRole('region', { name: 'Your notifications' })).toBeNull();
  });

  it('lists a notification without a request as plain text', async () => {
    fetchNotifications.mockResolvedValue({ unreadCount: 1, items: [item(1, { requestId: null, requestRef: null, title: 'Welcome' })] });
    render(<NotificationBell refreshKey="/" />);
    fireEvent.click(await screen.findByRole('button', { name: /Notifications/ }));
    expect(screen.getByText(/Welcome/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
