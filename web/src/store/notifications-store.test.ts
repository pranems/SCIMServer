/**
 * Phase N1 - notifications-store tests.
 *
 * Zustand global slice (independent of ui-store) that holds the last
 * 50 SSE notifications, persisted to localStorage with 7-day TTL,
 * deduplicated by (type+endpointId+second-bucket) to prevent SSE
 * burst floods from spamming the inbox.
 *
 * Properties under test:
 *   1. Empty initial state (first run)
 *   2. append() adds an entry, lifts unreadCount, newest-first ordering
 *   3. Ring buffer cap MAX_NOTIFICATIONS (50) - oldest dropped
 *   4. TTL prune: entries older than 7 days are dropped on load
 *   5. Dedupe: identical (type, endpointId, second-bucket) -> no second append
 *   6. markAllRead() zeroes unreadCount but preserves entries
 *   7. clear() empties entries + unreadCount
 *   8. severity classification: errors / warnings / info per type prefix
 *   9. Persist key matches the documented constant
 *  10. Corrupt persisted payload -> graceful empty (no throw)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useNotificationsStore,
  appendNotification,
  markAllRead,
  clearNotifications,
  pruneExpired,
  classifySeverity,
  bucketKey,
  MAX_NOTIFICATIONS,
  TTL_DAYS,
  NOTIFICATIONS_STORAGE_KEY,
  type NotificationEntry,
} from './notifications-store';

function sample(overrides: Partial<NotificationEntry> = {}): NotificationEntry {
  // Distinct random id by default so test entries don't accidentally dedupe.
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

describe('Phase N1 - notifications-store (Zustand + localStorage)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store between tests so the persisted-state singleton
    // doesn't leak across describe blocks.
    useNotificationsStore.setState({ entries: [], unreadCount: 0 });
  });

  it('exposes the documented constants', () => {
    expect(NOTIFICATIONS_STORAGE_KEY).toBe('scimserver.notifications.v1');
    expect(MAX_NOTIFICATIONS).toBe(50);
    expect(TTL_DAYS).toBe(7);
  });

  it('empty initial state', () => {
    const s = useNotificationsStore.getState();
    expect(s.entries).toEqual([]);
    expect(s.unreadCount).toBe(0);
  });

  it('appendNotification adds entry; unreadCount climbs; newest-first ordering', () => {
    appendNotification(sample({ id: 'n-1' }));
    appendNotification(sample({ id: 'n-2' }));
    const s = useNotificationsStore.getState();
    expect(s.entries).toHaveLength(2);
    expect(s.entries[0].id).toBe('n-2');
    expect(s.entries[1].id).toBe('n-1');
    expect(s.unreadCount).toBe(2);
  });

  it('caps at MAX_NOTIFICATIONS; oldest dropped', () => {
    for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) {
      appendNotification(sample({ id: `n-${i}` }));
    }
    const s = useNotificationsStore.getState();
    expect(s.entries).toHaveLength(MAX_NOTIFICATIONS);
    expect(s.entries[0].id).toBe(`n-${MAX_NOTIFICATIONS + 4}`);
    expect(s.entries.find((e) => e.id === 'n-0')).toBeUndefined();
    expect(s.entries.find((e) => e.id === 'n-4')).toBeUndefined();
    expect(s.entries.find((e) => e.id === 'n-5')).toBeDefined();
  });

  it('pruneExpired drops entries older than TTL_DAYS', () => {
    const now = Date.now();
    const old = new Date(now - (TTL_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date(now - 60 * 1000).toISOString();
    useNotificationsStore.setState({
      entries: [
        sample({ id: 'n-old', timestamp: old }),
        sample({ id: 'n-fresh', timestamp: fresh }),
      ],
      unreadCount: 2,
    });
    pruneExpired();
    const s = useNotificationsStore.getState();
    expect(s.entries.map((e) => e.id)).toEqual(['n-fresh']);
    // unreadCount reflects remaining unread entries only.
    expect(s.unreadCount).toBe(1);
  });

  it('dedupe: identical id only appends once (the SSE bridge uses bucketKey-derived ids so bursts collapse naturally)', () => {
    const ts = '2026-05-15T10:00:00.500Z';
    const ts2 = '2026-05-15T10:00:00.900Z';
    // Both ids derived from the same (type, endpointId, second-bucket) -> equal -> dedupe.
    const id = bucketKey('scim.user.created', 'ep-1', ts);
    const id2 = bucketKey('scim.user.created', 'ep-1', ts2);
    expect(id).toBe(id2);
    appendNotification(sample({ id, type: 'scim.user.created', endpointId: 'ep-1', timestamp: ts }));
    appendNotification(sample({ id: id2, type: 'scim.user.created', endpointId: 'ep-1', timestamp: ts2 }));
    expect(useNotificationsStore.getState().entries).toHaveLength(1);
  });

  it('dedupe: different second-bucket -> different bucketKey id -> appends normally', () => {
    const id1 = bucketKey('scim.user.created', 'ep-1', '2026-05-15T10:00:00.500Z');
    const id2 = bucketKey('scim.user.created', 'ep-1', '2026-05-15T10:00:02.500Z');
    expect(id1).not.toBe(id2);
    appendNotification(sample({ id: id1, type: 'scim.user.created', endpointId: 'ep-1', timestamp: '2026-05-15T10:00:00.500Z' }));
    appendNotification(sample({ id: id2, type: 'scim.user.created', endpointId: 'ep-1', timestamp: '2026-05-15T10:00:02.500Z' }));
    expect(useNotificationsStore.getState().entries).toHaveLength(2);
  });

  it('markAllRead zeroes unreadCount + flips per-entry read=true; preserves entries', () => {
    appendNotification(sample({ id: 'n-1' }));
    appendNotification(sample({ id: 'n-2' }));
    expect(useNotificationsStore.getState().unreadCount).toBe(2);
    markAllRead();
    const s = useNotificationsStore.getState();
    expect(s.unreadCount).toBe(0);
    expect(s.entries).toHaveLength(2);
    expect(s.entries.every((e) => e.read === true)).toBe(true);
  });

  it('clearNotifications empties entries + unreadCount', () => {
    appendNotification(sample({ id: 'n-1' }));
    appendNotification(sample({ id: 'n-2' }));
    clearNotifications();
    const s = useNotificationsStore.getState();
    expect(s.entries).toEqual([]);
    expect(s.unreadCount).toBe(0);
  });

  // ─── classifySeverity ─────────────────────────────────────────────

  it('classifySeverity returns "error" for error-suffixed types', () => {
    expect(classifySeverity('scim.bulk.error')).toBe('error');
    expect(classifySeverity('scim.endpoint.deploy.error')).toBe('error');
  });

  it('classifySeverity returns "warning" for config-change-like types', () => {
    expect(classifySeverity('scim.endpoint.updated')).toBe('warning');
    expect(classifySeverity('scim.credential.revoked')).toBe('warning');
  });

  it('classifySeverity returns "info" for routine CRUD events', () => {
    expect(classifySeverity('scim.user.created')).toBe('info');
    expect(classifySeverity('scim.user.updated')).toBe('info');
    expect(classifySeverity('scim.user.deleted')).toBe('info');
    expect(classifySeverity('scim.group.created')).toBe('info');
    expect(classifySeverity('scim.resource.created')).toBe('info');
  });

  // ─── Corrupt storage tolerance ────────────────────────────────────

  it('corrupt persisted payload -> graceful empty (no throw on next append)', () => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, 'not json {{{');
    // appendNotification must NOT throw even when persisted state is broken.
    expect(() => appendNotification(sample({ id: 'n-1' }))).not.toThrow();
    const s = useNotificationsStore.getState();
    expect(s.entries.find((e) => e.id === 'n-1')).toBeDefined();
  });
});
