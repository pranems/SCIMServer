/**
 * NotificationsButton (Phase N1).
 *
 * Bell icon in AppHeader with unread-count badge. Toggles the
 * NotificationsDrawer via ui-store. Badge caps at "99+" so it
 * doesn't overflow the icon when a Bulk POST fires 200 events.
 *
 * @see web/src/layout/NotificationsDrawer.tsx
 * @see web/src/store/notifications-store.ts
 */
import React from 'react';
import {
  Button,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Alert24Regular } from '@fluentui/react-icons';
import { useUIStore } from '../store/ui-store';
import { useNotificationsStore } from '../store/notifications-store';

const useStyles = makeStyles({
  wrapper: {
    position: 'relative',
    display: 'inline-block',
  },
  badge: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '8px',
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundOnBrand,
    fontSize: '10px',
    lineHeight: '16px',
    textAlign: 'center',
    fontWeight: 600,
    pointerEvents: 'none',
  },
});

function formatCount(n: number): string {
  if (n >= 100) return '99+';
  return String(n);
}

export const NotificationsButton: React.FC = () => {
  const classes = useStyles();
  const open = useUIStore((s) => s.notificationsDrawerOpen);
  const toggle = useUIStore((s) => s.toggleNotificationsDrawer);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);

  const tooltipText = open ? 'Hide notifications' : 'Show notifications';
  const ariaLabel = unreadCount > 0
    ? `${tooltipText} (${unreadCount} unread)`
    : tooltipText;

  return (
    <Tooltip content={tooltipText} relationship="label">
      <span className={classes.wrapper}>
        <Button
          appearance={open ? 'primary' : 'subtle'}
          icon={<Alert24Regular />}
          onClick={toggle}
          aria-label={ariaLabel}
          aria-pressed={open}
          data-testid="notifications-button"
          style={{ color: 'inherit' }}
        />
        {unreadCount > 0 && (
          <span className={classes.badge} data-testid="notifications-badge" aria-hidden>
            {formatCount(unreadCount)}
          </span>
        )}
      </span>
    </Tooltip>
  );
};
