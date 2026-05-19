/**
 * useLogStream - Phase K4 live log stream hook.
 *
 * Opens an independent EventSource against `/scim/admin/log-config/stream`
 * (the same endpoint `useSSE` taps for cache-invalidation) but with
 * tail-f-style ergonomics: stronger level filter (DEBUG by default so
 * the operator sees everything), in-memory ring buffer capped at
 * `maxEntries` (default 5,000), pause/resume, clear-without-disconnect,
 * pure consumer-side level + search filtering so changing the filters
 * does not require a network reconnect.
 *
 * Why a SECOND EventSource (not piggyback on `useSSE`):
 *   - `useSSE` filters at level=INFO (it only cares about SCIM events
 *     and admin-class entries). The drawer needs DEBUG-level visibility.
 *   - The buffer policy is different: useSSE forwards mutation payloads
 *     into TanStack Query invalidation; the drawer wants every log
 *     entry retained for human eyeballs.
 *   - Decoupling means the drawer's lifecycle (open/close) does not
 *     affect cache freshness.
 *
 * `enabled=false` means the hook does NOT open an EventSource. The
 * drawer passes `enabled={ui.logStreamDrawerOpen}` so a closed drawer
 * does not waste a connection. Closing the drawer unmounts the hook
 * via React unmount (the drawer body conditionally renders), which
 * triggers the cleanup branch.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S6.6
 * @see docs/PHASE_K4_LIVE_LOG_STREAM_VIEWER.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredToken } from '../auth/token';

/** RFC-compatible level keywords this hook understands. */
export type LogStreamLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/** Numeric ordering for level filtering (DEBUG < INFO < WARN < ERROR). */
const LEVEL_RANK: Record<LogStreamLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * One row in the live log stream. Mirrors a subset of the server's
 * `StructuredLogEntry` shape - the drawer doesn't care about every
 * field, but typing them so future filter rules can match.
 */
export interface LogStreamEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  requestId?: string;
  endpointId?: string;
  method?: string;
  path?: string;
  durationMs?: number;
  authType?: string;
  resourceType?: string;
  resourceId?: string;
  operation?: string;
  error?: { message: string; name?: string; stack?: string };
  data?: Record<string, unknown>;
}

export interface UseLogStreamOptions {
  /** When false, no EventSource is opened. */
  enabled?: boolean;
  /** Max entries retained in the ring buffer. Default 5,000. */
  maxEntries?: number;
  /** Override the SSE endpoint URL (used by tests). */
  url?: string;
}

export interface UseLogStreamResult {
  /** Current ring buffer (oldest first). */
  entries: LogStreamEntry[];
  /** EventSource lifecycle state. */
  connectionState: 'connecting' | 'open' | 'reconnecting' | 'closed';
  /** Whether ingestion is currently paused. */
  paused: boolean;
  /** Set the paused state. While paused, incoming messages are dropped. */
  setPaused: (paused: boolean) => void;
  /** Empty the buffer without closing the connection. */
  clear: () => void;
}

/**
 * Pure consumer-side filter. Exported so the drawer can call it
 * directly when applying ui-store filter state - no need to bake the
 * filters into the hook itself (keeping the hook focused on transport).
 */
export function filterEntries(
  entries: ReadonlyArray<LogStreamEntry>,
  filters: { level: LogStreamLevel; search: string },
): LogStreamEntry[] {
  const minRank = LEVEL_RANK[filters.level] ?? 0;
  const search = filters.search.trim().toLowerCase();
  return entries.filter((e) => {
    const rank = LEVEL_RANK[e.level as LogStreamLevel];
    if (rank === undefined || rank < minRank) return false;
    if (!search) return true;
    const haystack = [
      e.message,
      e.path ?? '',
      e.category,
      e.requestId ?? '',
      e.endpointId ?? '',
      e.method ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(search);
  });
}

const DEFAULT_URL = '/scim/admin/log-config/stream?level=DEBUG';
const DEFAULT_MAX_ENTRIES = 5_000;

/**
 * Type guard: a payload is a log entry if it carries the canonical
 * `level` + `message` + `category` triple. SCIM mutation events
 * (`{ type: 'scim.x.y', endpointId }`) have none of those, so this
 * filters them out cleanly.
 */
function isLogEntry(payload: unknown): payload is LogStreamEntry {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.level === 'string' &&
    typeof p.message === 'string' &&
    typeof p.category === 'string'
  );
}

export function useLogStream(options: UseLogStreamOptions = {}): UseLogStreamResult {
  const {
    enabled = true,
    maxEntries = DEFAULT_MAX_ENTRIES,
    url = DEFAULT_URL,
  } = options;

  const [entries, setEntries] = useState<LogStreamEntry[]>([]);
  const [connectionState, setConnectionState] = useState<'connecting' | 'open' | 'reconnecting' | 'closed'>('closed');
  const [paused, setPausedState] = useState(false);
  // Refs let the EventSource callbacks read current `paused` + `maxEntries`
  // without re-binding the listener every render.
  const pausedRef = useRef(paused);
  const maxRef = useRef(maxEntries);
  pausedRef.current = paused;
  maxRef.current = maxEntries;

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCount = useRef(0);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConnectionState('closed');
      return;
    }

    const token = getStoredToken();
    const fullUrl = token ? `${url}&token=${encodeURIComponent(token)}` : url;

    const connect = () => {
      setConnectionState('connecting');
      const es = new EventSource(fullUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCount.current = 0;
        setConnectionState('open');
      };

      es.onmessage = (event) => {
        if (pausedRef.current) return;
        try {
          const payload: unknown = JSON.parse(event.data);
          if (!isLogEntry(payload)) return;
          setEntries((prev) => {
            const next = [...prev, payload];
            const cap = maxRef.current;
            if (next.length > cap) return next.slice(next.length - cap);
            return next;
          });
        } catch {
          // Non-JSON SSE message (server keepalive / comment) - ignore.
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setConnectionState('reconnecting');
        const delay = Math.min(1_000 * Math.pow(2, retryCount.current), 30_000);
        retryCount.current++;
        setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setConnectionState('closed');
    };
  }, [enabled, url]);

  const setPaused = useCallback((p: boolean) => {
    setPausedState(p);
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  return { entries, connectionState, paused, setPaused, clear };
}
