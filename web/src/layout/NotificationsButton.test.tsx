/**
 * NotificationsButton tests (Phase N1).
 *
 * Asserts:
 *   1. Bell icon renders with documented testid
 *   2. Click toggles ui-store.notificationsDrawerOpen
 *   3. Unread badge shows the unreadCount when > 0
 *   4. Unread badge hidden when 0
 *   5. Badge caps at "99+" when count >= 100
 *   6. aria-label reflects open / unread state for screen readers
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { NotificationsButton } from './NotificationsButton';
import { useUIStore } from '../store/ui-store';
import {
  useNotificationsStore,
  clearNotifications,
} from '../store/notifications-store';

function renderButton() {
  return render(
    <FluentProvider theme={webLightTheme}>
      <NotificationsButton />
    </FluentProvider>,
  );
}

describe('NotificationsButton (Phase N1)', () => {
  beforeEach(() => {
    clearNotifications();
    useUIStore.setState({ notificationsDrawerOpen: false });
    localStorage.clear();
  });

  it('renders with documented testid', () => {
    renderButton();
    expect(screen.getByTestId('notifications-button')).toBeInTheDocument();
  });

  it('Click toggles notificationsDrawerOpen', () => {
    renderButton();
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(false);
    fireEvent.click(screen.getByTestId('notifications-button'));
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(true);
    fireEvent.click(screen.getByTestId('notifications-button'));
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(false);
  });

  it('Badge hidden when unreadCount is 0', () => {
    renderButton();
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  });

  it('Badge shows the unread count when > 0', () => {
    useNotificationsStore.setState({
      entries: [
        { id: 'n-1', type: 'scim.user.created', timestamp: new Date().toISOString(), severity: 'info', title: 'User created', read: false },
        { id: 'n-2', type: 'scim.user.created', timestamp: new Date().toISOString(), severity: 'info', title: 'User created', read: false },
        { id: 'n-3', type: 'scim.user.created', timestamp: new Date().toISOString(), severity: 'info', title: 'User created', read: false },
      ],
      unreadCount: 3,
    });
    renderButton();
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3');
  });

  it('Badge caps at "99+" when unread count >= 100', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      id: `n-${i}`,
      type: 'scim.user.created' as const,
      timestamp: new Date().toISOString(),
      severity: 'info' as const,
      title: 'User created',
      read: false,
    }));
    useNotificationsStore.setState({ entries: entries.slice(0, 50), unreadCount: 100 });
    renderButton();
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('99+');
  });

  it('aria-label includes the unread count for screen readers', () => {
    useNotificationsStore.setState({
      entries: [{ id: 'n-1', type: 'scim.user.created', timestamp: new Date().toISOString(), severity: 'info', title: 'User created', read: false }],
      unreadCount: 1,
    });
    renderButton();
    const btn = screen.getByTestId('notifications-button');
    expect(btn.getAttribute('aria-label')).toContain('1');
    expect(btn.getAttribute('aria-label')?.toLowerCase()).toContain('unread');
  });
});
