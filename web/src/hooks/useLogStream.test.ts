/**
 * useLogStream.test.ts - Phase K4 live SSE log stream hook contract.
 *
 * Asserts:
 *   - Opens an authenticated SSE stream only when `enabled=true`
 *   - Appends parsed log entries into a ring buffer capped at the
 *     configured `maxEntries` (default 5,000)
 *   - Surfaces a `connectionState` derived from the stream
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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useLogStream,
  filterEntries,
  type LogStreamEntry,
  type LogStreamLevel,
} from './useLogStream';

const sseMock = vi.hoisted(() => {
  const instances: Array<{
    options: {
      url: string;
      token?: string;
      onOpen: () => void;
      onMessage: (data: string) => void;
      onError: (error: Error) => void;
    };
    close: ReturnType<typeof vi.fn>;
    emit: (entry: Partial<LogStreamEntry>) => void;
    emitRaw: (data: string) => void;
    fail: (error?: Error) => void;
  }> = [];
  const open = vi.fn((options: typeof instances[number]['options']) => {
    const connection = {
      options,
      close: vi.fn(),
      completed: Promise.resolve(),
      emit: (entry: Partial<LogStreamEntry>) => options.onMessage(JSON.stringify({
        timestamp: '2026-05-12T20:00:00Z',
        level: 'INFO',
        category: 'http',
        message: 'sample',
        ...entry,
      })),
      emitRaw: (data: string) => options.onMessage(data),
      fail: (error = new Error('test stream failure')) => options.onError(error),
    };
    instances.push(connection);
    setTimeout(() => options.onOpen(), 0);
    return connection;
  });
  return { instances, open };
});

vi.mock('./authenticated-sse', () => ({
  openAuthenticatedSse: sseMock.open,
  isAuthenticatedSseAuthError: (error: Error & { status?: number }) =>
    error.status === 401 || error.status === 403,
}));

const tokenMock = vi.hoisted(() => ({
  get: vi.fn(() => 'test-token'),
  clear: vi.fn(),
  notifyInvalid: vi.fn(),
}));

vi.mock('../auth/token', () => ({
  getStoredToken: tokenMock.get,
  clearStoredToken: tokenMock.clear,
  notifyTokenInvalid: tokenMock.notifyInvalid,
}));

beforeEach(() => {
  sseMock.instances.length = 0;
  sseMock.open.mockClear();
  tokenMock.get.mockReset();
  tokenMock.get.mockReturnValue('test-token');
  tokenMock.clear.mockClear();
  tokenMock.notifyInvalid.mockClear();
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
  it('does NOT open a stream when enabled=false', () => {
    renderHook(() => useLogStream({ enabled: false }));
    expect(sseMock.instances).toHaveLength(0);
  });

  it('opens an authenticated stream without putting the token in the URL', async () => {
    renderHook(() => useLogStream({ enabled: true }));
    expect(sseMock.instances).toHaveLength(1);
    expect(sseMock.instances[0].options.url).toContain('/scim/admin/log-config/stream');
    expect(sseMock.instances[0].options.url).not.toContain('test-token');
    expect(sseMock.instances[0].options.token).toBe('test-token');
    // K4 - drawer requests DEBUG-level so the operator can see everything.
    expect(sseMock.instances[0].options.url).toContain('level=DEBUG');
  });

  it('appends incoming log entries into the buffer', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = sseMock.instances[0];
    act(() => { es.emit({ message: 'first' }); });
    act(() => { es.emit({ message: 'second' }); });
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].message).toBe('first');
    expect(result.current.entries[1].message).toBe('second');
  });

  it('caps the buffer at maxEntries (oldest dropped first)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true, maxEntries: 3 }));
    await new Promise((r) => setTimeout(r, 5));
    const es = sseMock.instances[0];
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

  it('exposes a connectionState that reflects the stream lifecycle', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    // The constructor schedules the onopen callback in a microtask.
    expect(result.current.connectionState).toBe('connecting');
    // Flush the microtask + any pending state updates inside act() so
    // React 19 commits the 'open' transition synchronously.
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(result.current.connectionState).toBe('open');
    act(() => { sseMock.instances[0].fail(); });
    expect(result.current.connectionState).toBe('reconnecting');
  });

  it('drops incoming messages while paused (paused buffer is intentional)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = sseMock.instances[0];
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
    const es = sseMock.instances[0];
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
    const es = sseMock.instances[0];
    act(() => { es.emitRaw(': ping 2026-05-12T20:00:00Z'); });
    act(() => { es.emit({ message: 'real' }); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].message).toBe('real');
  });

  it('ignores SCIM mutation event payloads (those have type: scim.x.y, no level/message)', async () => {
    const { result } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = sseMock.instances[0];
    act(() => { es.emitRaw(JSON.stringify({ type: 'scim.user.created', endpointId: 'ep-1' })); });
    act(() => { es.emit({ message: 'real log' }); });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].message).toBe('real log');
  });

  it('closes the stream on unmount', async () => {
    const { unmount } = renderHook(() => useLogStream({ enabled: true }));
    await new Promise((r) => setTimeout(r, 5));
    const es = sseMock.instances[0];
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it('reconnects with exponential backoff after a stream error', async () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useLogStream({ enabled: true }));
      // Drain initial microtask
      await vi.advanceTimersByTimeAsync(0);
      expect(sseMock.instances).toHaveLength(1);
      const first = sseMock.instances[0];
      act(() => { first.fail(); });
      // Backoff at attempt 0 = 1 s
      await vi.advanceTimersByTimeAsync(1100);
      expect(sseMock.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reconnect after an authentication failure', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useLogStream({ enabled: true }));
      sseMock.instances[0].fail(Object.assign(new Error('forbidden'), { status: 403 }));
      await vi.advanceTimersByTimeAsync(30_000);

      expect(tokenMock.clear).toHaveBeenCalledTimes(1);
      expect(tokenMock.notifyInvalid).toHaveBeenCalledTimes(1);
      expect(result.current.connectionState).toBe('closed');
      expect(sseMock.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the current token again before a transient reconnect', async () => {
    vi.useFakeTimers();
    try {
      tokenMock.get.mockReturnValueOnce('first-token').mockReturnValue('rotated-token');
      renderHook(() => useLogStream({ enabled: true }));
      sseMock.instances[0].fail();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(sseMock.instances).toHaveLength(2);
      expect(sseMock.instances[1].options.token).toBe('rotated-token');
    } finally {
      vi.useRealTimers();
    }
  });
});
