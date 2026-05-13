/**
 * useLogStream.test.ts - Phase K4 live SSE log stream hook contract.
 *
 * Asserts:
 *   - Opens an EventSource only when `enabled=true`
 *   - Appends parsed log entries into a ring buffer capped at the
 *     configured `maxEntries` (default 5,000)
 *   - Surfaces a `connectionState` derived from the EventSource
 *     lifecycle (connecting / open / reconnecting / closed)
 *   - Pauses ingestion on `setPaused(true)` (drops messages instead
 *     of buffering, so the buffer reflects what the operator chose
 *     to retain)
 *   - Filters by minimum log level (DEBUG > INFO > WARN > ERROR)
 *     applied at the consumer side - so changing the level filter
 *     does not require a network reconnect
 *   - Filters by free-text substring (case-insensitive, matches
 *     message + path + category + requestId)
 *   - Clear() empties the buffer without touching the connection
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S6.6
 * @see docs/PHASE_K4_LIVE_LOG_STREAM_VIEWER.md
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useLogStream,
  filterEntries,
  type LogStreamEntry,
  type LogStreamLevel,
} from './useLogStream';

// ─── Mock EventSource (mirrors useSSE.test.ts pattern) ──────────────

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
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }

  emit(entry: Partial<LogStreamEntry>) {
    const full: LogStreamEntry = {
      timestamp: '2026-05-12T20:00:00Z',
      level: 'INFO',
      category: 'http',
      message: 'sample',
      ...entry,
    };
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(full) }));
  }

  emitRaw(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

vi.mock('../auth/token', () => ({
  getStoredToken: vi.fn(() => 'test-token'),
}));

beforeEach(() => {
  MockEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = MockEventSource;
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).EventSource;
});

// ─── Pure filter function tests ─────────────────────────────────────

describe('filterEntries (pure)', () => {
  const entries: LogStreamEntry[] = [
    { timestamp: 't1', level: 'DEBUG', category: 'http', message: 'GET /Users', path: '/scim/v2/Users' },
    { timestamp: 't2', level: 'INFO', category: 'scim.users', message: 'create user', path: '/scim/v2/Users' },
    { timestamp: 't3', level: 'WARN', category: 'auth', message: 'invalid token', requestId: 'req-abc' },
    { timestamp: 't4', level: 'ERROR', category: 'database', message: 'pool exhausted' },
  ];

  it('returns all entries with default filters (level=DEBUG, no search)', () => {
    expect(filterEntries(entries, { level: 'DEBUG', search: '' })).toHaveLength(4);
  });

  it('filters by minimum level (level=WARN drops DEBUG and INFO)', () => {
    const out = filterEntries(entries, { level: 'WARN', search: '' });
    expect(out.map((e) => e.level)).toEqual(['WARN', 'ERROR']);
  });

  it('filters by minimum level (level=ERROR keeps only ERROR)', () => {
    const out = filterEntries(entries, { level: 'ERROR', search: '' });
    expect(out.map((e) => e.level)).toEqual(['ERROR']);
  });

  it('filters by case-insensitive substring across message + path + category + requestId', () => {
    expect(filterEntries(entries, { level: 'DEBUG', search: 'user' }).length).toBe(2);
    expect(filterEntries(entries, { level: 'DEBUG', search: 'AUTH' }).length).toBe(1);
    expect(filterEntries(entries, { level: 'DEBUG', search: 'req-abc' }).length).toBe(1);
    expect(filterEntries(entries, { level: 'DEBUG', search: 'pool' }).length).toBe(1);
    expect(filterEntries(entries, { level: 'DEBUG', search: 'nonexistent' }).length).toBe(0);
  });

  it('combines level + search filters with AND semantics', () => {
    const out = filterEntries(entries, { level: 'WARN', search: 'auth' });
    expect(out).toHaveLength(1);
    expect(out[0].requestId).toBe('req-abc');
  });

  it('handles entries missing optional fields without crashing', () => {
    const sparse: LogStreamEntry[] = [{ timestamp: 't', level: 'INFO', category: 'x', message: 'y' }];
    expect(filterEntries(sparse, { level: 'INFO', search: 'y' })).toHaveLength(1);
  });
});

// ─── Hook integration tests ─────────────────────────────────────────

describe('useLogStream', () => {
  it('does NOT open an EventSource when enabled=false', () => {
    renderHook(() => useLogStream({ enabled: false }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('opens an EventSource at /scim/admin/log-config/stream when enabled', async () => {
    renderHook(() => useLogStream({ enabled: true }));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/scim/admin/log-config/stream');
    // K4 - drawer requests DEBUG-level so the operator can see everything.
    expect(MockEventSource.instances[0].url).toContain('level=DEBUG');
  });

  it('appends incoming log entries into the buffer', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => { es.emit({ message: 'first' }); });
    act(() => { es.emit({ message: 'second' }); });
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].message).toBe('first');
    expect(result.current.entries[1].message).toBe('second');
  });

  it('caps the buffer at maxEntries (oldest dropped first)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true, maxEntries: 3 }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({ message: 'a' });
      es.emit({ message: 'b' });
      es.emit({ message: 'c' });
      es.emit({ message: 'd' });
      es.emit({ message: 'e' });
    });
    expect(result.current.entries).toHaveLength(3);
    expect(result.current.entries.map((e) => e.message)).toEqual(['c', 'd', 'e']);
  });

  it('exposes a connectionState that reflects the EventSource lifecycle', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    // The constructor schedules the onopen callback in a microtask.
    expect(result.current.connectionState).toBe('connecting');
    // Flush the microtask + any pending state updates inside act() so
    // React 19 commits the 'open' transition synchronously.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(result.current.connectionState).toBe('open');
    act(() => { MockEventSource.instances[0].onerror?.(new Event('error')); });
    expect(result.current.connectionState).toBe('reconnecting');
  });

  it('drops incoming messages while paused (paused buffer is intentional)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => { es.emit({ message: 'before pause' }); });
    act(() => { result.current.setPaused(true); });
    act(() => { es.emit({ message: 'while paused 1' }); });
    act(() => { es.emit({ message: 'while paused 2' }); });
    act(() => { result.current.setPaused(false); });
    act(() => { es.emit({ message: 'after resume' }); });
    expect(result.current.entries.map((e) => e.message)).toEqual(['before pause', 'after resume']);
  });

  it('clear() empties the buffer without closing the connection', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => {
      es.emit({ message: 'a' });
      es.emit({ message: 'b' });
    });
    expect(result.current.entries).toHaveLength(2);
    act(() => { result.current.clear(); });
    expect(result.current.entries).toHaveLength(0);
    expect(es.close).not.toHaveBeenCalled();
    // Connection stays open - new emits still appear.
    act(() => { es.emit({ message: 'after clear' }); });
    expect(result.current.entries).toHaveLength(1);
  });

  it('ignores non-JSON SSE messages (e.g. keepalive comments)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => { es.emitRaw(': ping 2026-05-12T20:00:00Z'); });
    act(() => { es.emit({ message: 'real' }); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].message).toBe('real');
  });

  it('ignores SCIM mutation event payloads (those have type: scim.x.y, no level/message)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    act(() => { es.emitRaw(JSON.stringify({ type: 'scim.user.created', endpointId: 'ep-1' })); });
    act(() => { es.emit({ message: 'real log' }); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].message).toBe('real log');
  });

  it('closes the EventSource on unmount', async () => {
    const { unmount } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = MockEventSource.instances[0];
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it('reconnects with exponential backoff after onerror', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useLogStream({ enabled: true }));
      // Drain initial microtask
      await vi.advanceTimersByTimeAsync(0);
      expect(MockEventSource.instances).toHaveLength(1);
      const first = MockEventSource.instances[0];
      act(() => { first.onerror?.(new Event('error')); });
      // Backoff at attempt 0 = 1 s
      await vi.advanceTimersByTimeAsync(1100);
      expect(MockEventSource.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
