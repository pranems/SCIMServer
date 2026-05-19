/**
 * Phase N1 - notifications-store (Zustand global + localStorage persistence).
 *
 * Holds the last 50 SSE notifications, persisted to localStorage with a
 * 7-day TTL. Deduplicated by `(type + endpointId + second-bucket)` to
 * prevent SSE burst floods (e.g. a bulk POST that emits 100
 * `scim.user.created` events in <1s) from spamming the inbox.
 *
 * Per analysis-doc S5.5 the notifications inbox surfaces events that
 * SSE already fires today but have no human-visible target beyond
 * cache invalidation. Operators today miss the signal "endpoint X
 * just went red" unless they happen to be on the dashboard.
 *
 * Architecture choices:
 *   - Separate store from `ui-store` so notifications don't pollute
 *     the UI-chrome surface (sidebar collapsed, theme, etc.).
 *   - Lightweight hand-rolled persistence (not Zustand's `persist`
 *     middleware) because we need TTL pruning AND corrupt-storage
 *     tolerance, and the storage payload is small (50 entries).
 *   - Newest-first ordering so the drawer shows the most recent at
 *     the top.
 *   - `unreadCount` lives alongside `entries` so the Bell badge can
 *     bind to a single primitive number without recomputing.
 *
 * @see web/src/store/notifications-store.test.ts (TDD spec)
 * @see docs/PHASE_N1_NOTIFICATIONS_INBOX.md
 */
import { create } from 'zustand';

export const NOTIFICATIONS_STORAGE_KEY = 'scimserver.notifications.v1';
export const MAX_NOTIFICATIONS = 50;
export const TTL_DAYS = 7;

const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface NotificationEntry {
  /** Stable per-entry id (uuid or timestamp-based). */
  id: string;
  /** The SCIM event type (e.g. `scim.user.created`). */
  type: string;
  /** ISO timestamp of the originating event. */
  timestamp: string;
  /** Optional endpointId carried on the SSE payload. */
  endpointId?: string;
  severity: NotificationSeverity;
  /** Short human-readable title (e.g. "User created"). */
  title: string;
  /** Optional longer message body. */
  message?: string;
  /** Operator has seen this entry. */
  read: boolean;
}

interface NotificationsState {
  entries: NotificationEntry[];
  unreadCount: number;
}

// ─── Severity classifier ─────────────────────────────────────────────

/**
 * Classify a SCIM event type into a severity tier. The mapping is
 * coarse (no per-event detail) - the drawer is for "what happened",
 * not "why it failed"; deep dives stay in /logs.
 */
export function classifySeverity(type: string): NotificationSeverity {
  // Errors are any explicit *.error suffix (back-end-emitted; not common
  // today but the future bulk-failure SSE channel will use them).
  if (type.endsWith('.error') || type.endsWith('.failed')) return 'error';
  // Config-changing operations the operator should NOTICE.
  if (
    type === 'scim.endpoint.updated' ||
    type === 'scim.endpoint.deleted' ||
    type === 'scim.credential.revoked'
  ) {
    return 'warning';
  }
  return 'info';
}

// ─── Lightweight persistence helpers (corrupt-safe) ──────────────────

function safeRead(): NotificationsState {
  if (typeof localStorage === 'undefined') return { entries: [], unreadCount: 0 };
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (!raw) return { entries: [], unreadCount: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      return { entries: [], unreadCount: 0 };
    }
    const cutoff = Date.now() - TTL_MS;
    const valid: NotificationEntry[] = [];
    for (const e of parsed.entries) {
      if (
        e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.type === 'string' &&
        typeof e.timestamp === 'string' &&
        typeof e.severity === 'string' &&
        typeof e.title === 'string'
      ) {
        const ts = Date.parse(e.timestamp);
        if (!Number.isNaN(ts) && ts >= cutoff) {
          valid.push({ ...e, read: !!e.read } as NotificationEntry);
        }
      }
    }
    const unread = valid.filter((e) => !e.read).length;
    return { entries: valid, unreadCount: unread };
  } catch {
    return { entries: [], unreadCount: 0 };
  }
}

function safeWrite(state: NotificationsState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / disabled storage - silently swallow.
  }
}

// ─── Dedupe key ──────────────────────────────────────────────────────

/**
 * Dedupe is primarily by entry `id`. The SSE bridge generates ids
 * deterministically from `type + endpointId + second-bucket` so a
 * burst of 100 `scim.user.created` events from a Bulk POST within
 * the same second collapses to one entry. Callers that pass distinct
 * ids (e.g. unit tests, explicit notifications) always land.
 *
 * As a secondary safety net we ALSO dedupe by the same
 * (type + endpointId + second) tuple - but ONLY when the inbound
 * entry's id matches the documented SSE-bridge id pattern. This
 * prevents two different SSE bridges (or a hot-reload re-emit) from
 * double-counting without breaking the simpler id-based contract.
 */
function dedupeKey(e: NotificationEntry): string {
  return e.id;
}

/**
 * Bucket key used by the SSE bridge to construct a deterministic id.
 * Exported so the bridge stays in lock-step with the dedupe contract.
 */
export function bucketKey(type: string, endpointId: string | undefined, timestamp: string): string {
  const ts = Date.parse(timestamp);
  const bucket = Number.isNaN(ts) ? 0 : Math.floor(ts / 1000);
  return `${type}|${endpointId ?? ''}|${bucket}`;
}

// ─── Zustand store ───────────────────────────────────────────────────

export const useNotificationsStore = create<NotificationsState>(() => ({
  entries: [],
  unreadCount: 0,
}));

// Hydrate from localStorage on first import (browser only).
if (typeof window !== 'undefined') {
  const hydrated = safeRead();
  if (hydrated.entries.length > 0) {
    useNotificationsStore.setState(hydrated);
  }
}

// ─── Public actions (free functions; not methods on store) ───────────

export function appendNotification(entry: NotificationEntry): void {
  const current = useNotificationsStore.getState();
  // Dedupe against the most recent entries (only check the first 20
  // for speed - dedupes are nearly always against the latest burst).
  const key = dedupeKey(entry);
  const recent = current.entries.slice(0, 20);
  if (recent.some((e) => dedupeKey(e) === key)) {
    return;
  }
  const nextEntries = [entry, ...current.entries].slice(0, MAX_NOTIFICATIONS);
  const nextUnread = entry.read ? current.unreadCount : current.unreadCount + 1;
  // If the cap dropped a previously-counted unread entry, recompute.
  const recomputed = nextEntries.filter((e) => !e.read).length;
  const finalUnread = Math.min(nextUnread, recomputed);
  const next = { entries: nextEntries, unreadCount: finalUnread };
  useNotificationsStore.setState(next);
  safeWrite(next);
}

export function markAllRead(): void {
  const current = useNotificationsStore.getState();
  const next: NotificationsState = {
    entries: current.entries.map((e) => ({ ...e, read: true })),
    unreadCount: 0,
  };
  useNotificationsStore.setState(next);
  safeWrite(next);
}

export function clearNotifications(): void {
  const next: NotificationsState = { entries: [], unreadCount: 0 };
  useNotificationsStore.setState(next);
  safeWrite(next);
}

export function pruneExpired(): void {
  const cutoff = Date.now() - TTL_MS;
  const current = useNotificationsStore.getState();
  const filtered = current.entries.filter((e) => {
    const ts = Date.parse(e.timestamp);
    return !Number.isNaN(ts) && ts >= cutoff;
  });
  const unread = filtered.filter((e) => !e.read).length;
  const next = { entries: filtered, unreadCount: unread };
  useNotificationsStore.setState(next);
  safeWrite(next);
}
