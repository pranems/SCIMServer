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
