/**
 * useSSE hook tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  readyState = 0;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate connection
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  /** Simulate receiving a message */
  simulateMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

// Mock token
vi.mock('../auth/token', () => ({
  getStoredToken: vi.fn(() => 'test-token'),
}));

import { useSSE } from './useSSE';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

describe('useSSE', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it('creates EventSource connection when enabled', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE({ enabled: true }), { wrapper });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/scim/admin/log-config/stream');
  });

  it('does not create EventSource when disabled', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE({ enabled: false }), { wrapper });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('includes token in URL', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE(), { wrapper });

    expect(MockEventSource.instances[0].url).toContain('token=test-token');
  });

  it('invalidates dashboard cache on SCIM user event', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useSSE(), { wrapper });

    // Wait for connection
    await new Promise((r) => setTimeout(r, 10));

    // Simulate receiving a user created event
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.user.created', endpointId: 'ep-1' }),
    );

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('closes EventSource on unmount', () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useSSE(), { wrapper });

    const es = MockEventSource.instances[0];
    unmount();

    expect(es.close).toHaveBeenCalled();
  });

  it('ignores non-SCIM events', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));

    // Simulate a keepalive/non-SCIM message
    MockEventSource.instances[0].simulateMessage(JSON.stringify({ type: 'keepalive' }));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

// ─── Phase K2 - SSE connection state mirrored into ui-store ─────────
//
// useHealthRollup reads the SSE connection state from ui-store to
// surface the Realtime substatus. These tests lock in that useSSE
// keeps that state in sync across the lifecycle (connecting -> open
// -> reconnecting on error -> closed on unmount). Without this lock
// the Realtime traffic-light would lie about reality whenever the
// EventSource state machine changes.
import { useUIStore } from '../store/ui-store';

describe('useSSE - K2 ui-store connection state', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
    useUIStore.setState({ sseConnectionState: 'closed' });
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it('writes "connecting" the moment the EventSource is constructed', () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE({ enabled: true }), { wrapper });
    // Constructor ran synchronously; onopen is a microtask away.
    // Snapshot must already be 'connecting' before the microtask fires.
    expect(useUIStore.getState().sseConnectionState).toBe('connecting');
  });

  it('writes "open" once the EventSource onopen fires', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE({ enabled: true }), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(useUIStore.getState().sseConnectionState).toBe('open');
  });

  it('writes "reconnecting" when onerror fires (before the next connect attempt)', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE({ enabled: true }), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    // Trigger an error - the hook closes the ES, schedules reconnect.
    MockEventSource.instances[0].onerror?.(new Event('error'));
    expect(useUIStore.getState().sseConnectionState).toBe('reconnecting');
  });

  it('writes "closed" on unmount cleanup', () => {
    const { wrapper } = createWrapper();
    const { unmount } = renderHook(() => useSSE({ enabled: true }), { wrapper });
    unmount();
    expect(useUIStore.getState().sseConnectionState).toBe('closed');
  });
});

// ─── Phase B3 - granular per-channel invalidation contract ──────────

import { computeInvalidations, SUPPORTED_EVENT_TYPES } from './useSSE';
import { queryKeys } from '../api/queries';

// Helper - normalises a queryKey to a string for set-membership checks.
const k = (key: readonly unknown[]) => JSON.stringify(key);

describe('computeInvalidations (Phase B3)', () => {
  it('always invalidates the dashboard key (any event)', () => {
    for (const t of SUPPORTED_EVENT_TYPES) {
      const keys = computeInvalidations(t, 'ep-1').map(k);
      expect(keys).toContain(k(queryKeys.dashboard));
    }
  });

  it('user events invalidate stats + overview + per-endpoint user list', () => {
    const keys = computeInvalidations('scim.user.created', 'ep-1').map(k);
    expect(keys).toContain(k(queryKeys.endpoints.stats('ep-1')));
    expect(keys).toContain(k(queryKeys.endpoints.overview('ep-1')));
    expect(keys).toContain(k(['users', 'ep-1']));
    // No groups invalidation for user events.
    expect(keys).not.toContain(k(['groups', 'ep-1']));
  });

  it('group events invalidate the per-endpoint group list, not the user list', () => {
    const keys = computeInvalidations('scim.group.deleted', 'ep-1').map(k);
    expect(keys).toContain(k(['groups', 'ep-1']));
    expect(keys).toContain(k(queryKeys.endpoints.overview('ep-1')));
    expect(keys).not.toContain(k(['users', 'ep-1']));
  });

  it('credential events invalidate the per-endpoint overview but NOT the resource lists', () => {
    const keys = computeInvalidations('scim.credential.created', 'ep-1').map(k);
    expect(keys).toContain(k(queryKeys.endpoints.overview('ep-1')));
    // Credentials don't change user / group counts.
    expect(keys).not.toContain(k(['users', 'ep-1']));
    expect(keys).not.toContain(k(['groups', 'ep-1']));
  });

  it('endpoint mutations invalidate the global endpoints list', () => {
    const keys = computeInvalidations('scim.endpoint.updated', 'ep-1').map(k);
    expect(keys).toContain(k(queryKeys.endpoints.all));
    expect(keys).toContain(k(queryKeys.endpoints.detail('ep-1')));
    expect(keys).toContain(k(queryKeys.endpoints.overview('ep-1')));
    expect(keys).toContain(k(queryKeys.endpoints.stats('ep-1')));
  });

  it('skips endpoint-scoped keys when no endpointId is present', () => {
    const keys = computeInvalidations('scim.user.created', undefined).map(k);
    // Always-invalidate keys are still there.
    expect(keys).toContain(k(queryKeys.dashboard));
    // Per-endpoint keys are skipped.
    expect(keys.some((s) => s.includes('ep-'))).toBe(false);
  });
});

// ─── Phase F3: SSE invalidation completeness audit ───────────────
//
// F3 broadens the invalidation map so every channel hits log views and
// activity feeds (every SCIM mutation creates a RequestLog row, and
// admin actions land on the activity feed too).

describe('computeInvalidations Phase F3 completeness audit', () => {
  // Sanity check: every supported event still emits the dashboard key
  // (regression guard if anyone trims `dashboard` from the always-set).
  it('every event still invalidates the dashboard key', () => {
    for (const t of SUPPORTED_EVENT_TYPES) {
      const keys = computeInvalidations(t, 'ep-1').map(k);
      expect(keys).toContain(k(queryKeys.dashboard));
    }
  });

  // Logs invalidation: every channel should refresh the global logs
  // page + the per-endpoint logs page + the future queryKeys.logs
  // factory (no caller uses it yet but the prefix lock prevents a
  // future query from drifting outside the SSE map).
  it('every event invalidates all three log prefix keys (Phase F3)', () => {
    for (const t of SUPPORTED_EVENT_TYPES) {
      const keys = computeInvalidations(t, 'ep-1').map(k);
      expect(keys).toContain(k(queryKeys.logs.all));
      expect(keys).toContain(k(queryKeys.globalLogs.all));
      expect(keys).toContain(k(queryKeys.endpointLogs.all));
    }
  });

  // Logs invalidation must fire even when no endpointId is on the
  // payload (e.g. system / endpoint-create events that don't carry
  // a target endpoint scope).
  it('logs prefix keys still invalidate when endpointId is missing', () => {
    const keys = computeInvalidations('scim.endpoint.created', undefined).map(k);
    expect(keys).toContain(k(queryKeys.logs.all));
    expect(keys).toContain(k(queryKeys.globalLogs.all));
    expect(keys).toContain(k(queryKeys.endpointLogs.all));
  });

  // Activity invalidation broadens to credential events.
  it('credential events now invalidate the activity feed (Phase F3)', () => {
    const keys = computeInvalidations('scim.credential.created', 'ep-1').map(k);
    expect(keys).toContain(k(queryKeys.activity.all('ep-1')));
  });

  // Activity invalidation broadens to endpoint events.
  it('endpoint events now invalidate the activity feed (Phase F3)', () => {
    const keys = computeInvalidations('scim.endpoint.updated', 'ep-1').map(k);
    expect(keys).toContain(k(queryKeys.activity.all('ep-1')));
  });

  // Activity invalidation skipped when no endpointId (it's per-endpoint).
  it('activity invalidation skipped when endpointId is missing', () => {
    const keys = computeInvalidations('scim.user.created', undefined).map(k);
    expect(keys.every((s) => !s.includes('"activity"'))).toBe(true);
  });
});

describe('useSSE channel dispatch (Phase B3)', () => {
  // Mirror the lifecycle from the outer describe block - those hooks
  // don't apply to sibling describes, so we re-install the EventSource
  // shim here. Without this MockEventSource.instances stays empty
  // because the global EventSource was deleted by the prior afterEach.
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it('invalidates the per-endpoint Overview cache on credential.created', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useSSE(), { wrapper });
    // Wait for the EventSource constructor's setTimeout(...) onopen
    // shim to fire. The hook's useEffect runs synchronously inside
    // renderHook, but MockEventSource defers onopen to a microtask so
    // we need a tick before the event listener is wired up.
    await new Promise((r) => setTimeout(r, 20));

    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.credential.created', endpointId: 'ep-7' }),
    );
    // Allow microtasks queued by invalidateQueries to flush.
    await new Promise((r) => setTimeout(r, 0));

    // Find the call that targeted the overview key.
    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(calls).toContain(JSON.stringify(['endpoints', 'ep-7', 'overview']));
  });

  it('invalidates per-endpoint user list on scim.user.deleted', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));

    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.user.deleted', endpointId: 'ep-9' }),
    );
    await new Promise((r) => setTimeout(r, 0));

    const calls = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(calls).toContain(JSON.stringify(['users', 'ep-9']));
  });
});

// ─── Phase N1 - notifications-store SSE bridge ─────────────────────
//
// useSSE pushes every supported SCIM event into the notifications
// store so the operator's Bell icon + drawer can show what just
// happened. Distinct from the cache invalidation path (which is
// silent + non-visual) - this is the human-visible surface.

import {
  useNotificationsStore,
  bucketKey,
  clearNotifications,
} from '../store/notifications-store';

describe('useSSE - N1 notifications-store bridge', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;
    // Reset notifications store between tests.
    clearNotifications();
  });

  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it('appends a notification on every supported SCIM event', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({
        type: 'scim.user.created',
        endpointId: 'ep-1',
        timestamp: '2026-05-15T10:00:00.500Z',
      }),
    );
    const s = useNotificationsStore.getState();
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].type).toBe('scim.user.created');
    expect(s.entries[0].endpointId).toBe('ep-1');
    expect(s.unreadCount).toBe(1);
  });

  it('uses bucketKey-derived id so SSE bursts collapse via store dedupe', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    // Same type + endpointId + second-bucket -> same id -> dedupe.
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.user.created', endpointId: 'ep-1', timestamp: '2026-05-15T10:00:00.100Z' }),
    );
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.user.created', endpointId: 'ep-1', timestamp: '2026-05-15T10:00:00.800Z' }),
    );
    expect(useNotificationsStore.getState().entries).toHaveLength(1);
    // The id matches the documented bucketKey output for parity.
    const expectedId = bucketKey('scim.user.created', 'ep-1', '2026-05-15T10:00:00.100Z');
    expect(useNotificationsStore.getState().entries[0].id).toBe(expectedId);
  });

  it('classifies severity per the store contract (endpoint.updated -> warning)', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    MockEventSource.instances[0].simulateMessage(
      JSON.stringify({ type: 'scim.endpoint.updated', endpointId: 'ep-1', timestamp: '2026-05-15T10:00:00.500Z' }),
    );
    expect(useNotificationsStore.getState().entries[0].severity).toBe('warning');
  });

  it('does NOT push notifications for unsupported / keepalive events', async () => {
    const { wrapper } = createWrapper();
    renderHook(() => useSSE(), { wrapper });
    await new Promise((r) => setTimeout(r, 10));
    MockEventSource.instances[0].simulateMessage(JSON.stringify({ type: 'keepalive' }));
    expect(useNotificationsStore.getState().entries).toHaveLength(0);
  });
});

