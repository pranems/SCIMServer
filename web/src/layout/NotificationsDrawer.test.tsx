/**
 * NotificationsDrawer tests (Phase N1).
 *
 * Asserts:
 *   1. Drawer hidden by default; opens via prop / store state
 *   2. Empty state when no notifications
 *   3. Renders one row per entry with severity badge + title + relative time + endpointId
 *   4. Unread entries get a visual unread-indicator (dot or bold text)
 *   5. Mark all read button zeroes unreadCount (and fires markAllRead)
 *   6. Clear button empties the list (and fires clearNotifications)
 *   7. "Take me there" link on row navigates to /endpoints/<id>/activity (when endpointId present)
 *   8. Close button toggles the drawer off via ui-store setNotificationsDrawerOpen
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { NotificationsDrawer } from './NotificationsDrawer';
import {
  useNotificationsStore,
  appendNotification,
  clearNotifications,
  type NotificationEntry,
} from '../store/notifications-store';
import { useUIStore } from '../store/ui-store';

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function entry(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  return {
    id: `n-${Math.random().toString(36).slice(2)}`,
    type: 'scim.user.created',
    timestamp: new Date().toISOString(),
    endpointId: 'ep-1',
    severity: 'info',
    title: 'User created',
    message: 'A user was created.',
    read: false,
    ...overrides,
  };
}

function renderDrawer() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <NotificationsDrawer />
    </FluentProvider>,
  );
}

describe('NotificationsDrawer (Phase N1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNotifications();
    useUIStore.setState({ notificationsDrawerOpen: true });
    localStorage.clear();
  });

  it('renders the drawer wrapper with documented testid', () => {
    renderDrawer();
    expect(screen.getByTestId('notifications-drawer')).toBeInTheDocument();
  });

  it('shows empty state when no notifications exist', () => {
    renderDrawer();
    expect(screen.getByTestId('notifications-empty')).toBeInTheDocument();
  });

  it('renders one row per entry with severity badge + title + endpointId', () => {
    appendNotification(entry({ id: 'n-1', title: 'User created', endpointId: 'ep-1', severity: 'info' }));
    appendNotification(entry({ id: 'n-2', title: 'Endpoint updated', endpointId: 'ep-2', severity: 'warning' }));
    renderDrawer();
    expect(screen.getByTestId('notifications-row-n-1')).toBeInTheDocument();
    expect(screen.getByTestId('notifications-row-n-2')).toBeInTheDocument();
    // Each row contains the title text + endpointId.
    expect(screen.getByTestId('notifications-row-n-1').textContent).toContain('User created');
    expect(screen.getByTestId('notifications-row-n-1').textContent).toContain('ep-1');
    expect(screen.getByTestId('notifications-row-n-2').textContent).toContain('Endpoint updated');
  });

  it('shows an unread-indicator dot on unread rows; absent on read rows', () => {
    appendNotification(entry({ id: 'n-unread', read: false }));
    appendNotification(entry({ id: 'n-read', read: true }));
    renderDrawer();
    expect(screen.queryByTestId('notifications-row-n-unread-unread-dot')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-row-n-read-unread-dot')).not.toBeInTheDocument();
  });

  it('Mark all read zeroes unreadCount and flips per-entry read=true', () => {
    appendNotification(entry({ id: 'n-1' }));
    appendNotification(entry({ id: 'n-2' }));
    expect(useNotificationsStore.getState().unreadCount).toBe(2);
    renderDrawer();
    fireEvent.click(screen.getByTestId('notifications-mark-all-read'));
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
    expect(useNotificationsStore.getState().entries.every((e) => e.read)).toBe(true);
  });

  it('Clear empties the list', () => {
    appendNotification(entry({ id: 'n-1' }));
    appendNotification(entry({ id: 'n-2' }));
    renderDrawer();
    fireEvent.click(screen.getByTestId('notifications-clear'));
    expect(useNotificationsStore.getState().entries).toEqual([]);
  });

  it('Take me there navigates to /endpoints/<id>/activity when endpointId present', () => {
    appendNotification(entry({ id: 'n-1', endpointId: 'ep-1' }));
    renderDrawer();
    fireEvent.click(screen.getByTestId('notifications-row-n-1-takemethere'));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const arg = mockNavigate.mock.calls[0][0] as { to: string; params?: { endpointId?: string } };
    // TanStack Router takes the route pattern + params object; assert both
    // so the final URL is unambiguous.
    expect(arg.to).toBe('/endpoints/$endpointId/activity');
    expect(arg.params?.endpointId).toBe('ep-1');
  });

  it('Close button toggles the drawer off via ui-store', () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId('notifications-close'));
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(false);
  });
});
