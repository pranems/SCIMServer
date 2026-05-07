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
