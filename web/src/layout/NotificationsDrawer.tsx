/**
 * NotificationsDrawer (Phase N1).
 *
 * Right-anchored OverlayDrawer mirroring the K4 LogStreamDrawer
 * pattern. Renders the notifications-store entries newest-first with
 * severity badge + title + endpointId + relative-time + Take-me-there
 * link. Top bar carries Mark all read + Clear + Close actions.
 *
 * Triggered from the AppHeader Bell button (NotificationsButton); the
 * drawer open state lives in ui-store so the toggle survives across
 * tabs and the drawer stays open across in-app navigation.
 *
 * Out of scope for M3: per-row dismiss (clearing one entry; covered
 * by "clear all" which is sufficient for the M3 minimal viable
 * surface), toast for high-severity events (deferred to N1 follow-up),
 * Web Push API integration (deferred indefinitely per analysis-doc
 * S5.5 - browser-push needs a service worker which we don't ship).
 *
 * @see docs/PHASE_N1_NOTIFICATIONS_INBOX.md
 * @see web/src/store/notifications-store.ts
 * @see web/src/layout/NotificationsButton.tsx (the Bell trigger)
 */
import React, { useEffect } from 'react';
import {
  OverlayDrawer,
  makeStyles,
  tokens,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  Button,
  Badge,
} from '@fluentui/react-components';
import {
  Dismiss20Regular,
  Delete20Regular,
  CheckmarkCircle20Regular,
  Alert24Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useNavigate } from '@tanstack/react-router';
import { useUIStore } from '../store/ui-store';
import {
  useNotificationsStore,
  markAllRead,
  clearNotifications,
  pruneExpired,
  type NotificationEntry,
  type NotificationSeverity,
} from '../store/notifications-store';

const useStyles = makeStyles({
  drawer: {
    minWidth: '380px',
    width: '420px',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  toolbar: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  },
  body: {
    overflow: 'auto',
    padding: '4px 0',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '32px 16px',
    color: tokens.colorNeutralForeground3,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr auto',
    columnGap: '8px',
    padding: '10px 16px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
    alignItems: 'start',
  },
  rowUnread: {
    backgroundColor: tokens.colorNeutralBackground1Hover,
  },
  unreadDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: tokens.colorBrandBackground,
    marginTop: '6px',
  },
  rowMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  rowMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    color: tokens.colorNeutralForeground3,
  },
  monoChip: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
  },
});

function severityColor(s: NotificationSeverity): 'danger' | 'warning' | 'success' {
  if (s === 'error') return 'danger';
  if (s === 'warning') return 'warning';
  return 'success';
}

function relativeTime(timestamp: string): string {
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const diffMs = Date.now() - t;
  const diffS = Math.floor(diffMs / 1000);
  if (diffS < 5) return 'just now';
  if (diffS < 60) return `${diffS}s ago`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

export const NotificationsDrawer: React.FC = () => {
  const classes = useStyles();
  const navigate = useNavigate();
  const open = useUIStore((s) => s.notificationsDrawerOpen);
  const setOpen = useUIStore((s) => s.setNotificationsDrawerOpen);
  const entries = useNotificationsStore((s) => s.entries);

  // Prune TTL-expired entries on every mount (cheap, covers the case
  // where the operator left a tab open for >7 days).
  useEffect(() => {
    pruneExpired();
  }, []);

  if (!open) {
    // Render the marker even when closed so test queries don't crash;
    // the OverlayDrawer handles visibility itself.
    return <div data-testid="notifications-drawer" data-open="false" hidden />;
  }

  const handleNavigateToActivity = (e: NotificationEntry): void => {
    if (!e.endpointId) return;
    navigate({ to: '/endpoints/$endpointId/activity', params: { endpointId: e.endpointId } });
    setOpen(false);
  };

  return (
    <OverlayDrawer
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      position="end"
      size="medium"
      modalType="non-modal"
      data-testid="notifications-drawer"
      className={classes.drawer}
    >
      <div className={classes.header}>
        <div className={classes.headerRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Alert24Regular />
            <Subtitle1>Notifications</Subtitle1>
          </div>
          <Button
            appearance="subtle"
            icon={<Dismiss20Regular />}
            aria-label="Close notifications"
            data-testid="notifications-close"
            onClick={() => setOpen(false)}
          />
        </div>
        <div className={classes.toolbar}>
          <Button
            appearance="subtle"
            icon={<CheckmarkCircle20Regular />}
            data-testid="notifications-mark-all-read"
            onClick={markAllRead}
            disabled={entries.every((e) => e.read)}
          >
            Mark all read
          </Button>
          <Button
            appearance="subtle"
            icon={<Delete20Regular />}
            data-testid="notifications-clear"
            onClick={clearNotifications}
            disabled={entries.length === 0}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className={classes.body}>
        {entries.length === 0 ? (
          <div className={classes.empty} data-testid="notifications-empty">
            <Alert24Regular />
            <Subtitle2>No notifications yet</Subtitle2>
            <Caption1>
              SCIM events fired by any endpoint will appear here as they happen.
              Last 50, kept for 7 days.
            </Caption1>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`${classes.row} ${entry.read ? '' : classes.rowUnread}`}
              data-testid={`notifications-row-${entry.id}`}
            >
              <div>
                {!entry.read && (
                  <div
                    className={classes.unreadDot}
                    data-testid={`notifications-row-${entry.id}-unread-dot`}
                    aria-label="Unread"
                  />
                )}
              </div>
              <div className={classes.rowMain}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <Badge appearance="filled" color={severityColor(entry.severity)} size="small">
                    {entry.severity}
                  </Badge>
                  <Text weight={entry.read ? 'regular' : 'semibold'}>{entry.title}</Text>
                </div>
                <div className={classes.rowMeta}>
                  <Caption1 className={classes.monoChip}>{entry.type}</Caption1>
                  {entry.endpointId && (
                    <Caption1 className={classes.monoChip}>endpoint: {entry.endpointId}</Caption1>
                  )}
                  <Caption1>{relativeTime(entry.timestamp)}</Caption1>
                </div>
                {entry.message && <Caption1>{entry.message}</Caption1>}
              </div>
              <div>
                {entry.endpointId && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<Open16Regular />}
                    data-testid={`notifications-row-${entry.id}-takemethere`}
                    onClick={() => handleNavigateToActivity(entry)}
                    title="Take me there"
                  >
                    Take me there
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </OverlayDrawer>
  );
};
