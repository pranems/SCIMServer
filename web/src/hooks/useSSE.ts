/**
 * useSSE - React hook for Server-Sent Events (SSE) integration.
 *
 * Listens to the SCIM event stream and invalidates TanStack Query cache
 * when SCIM mutations occur. This enables near-real-time dashboard updates
 * without polling.
 *
 * Design decision D8: SSE multiplexing (uni-directional server-push).
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D8
 */
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getStoredToken } from '../auth/token';
import { queryKeys } from '../api/queries';

/** SSE event types emitted by SCIM services */
const INVALIDATION_EVENTS = new Set([
  'scim.user.created',
  'scim.user.updated',
  'scim.user.deleted',
  'scim.group.created',
  'scim.group.updated',
  'scim.group.deleted',
  'scim.resource.created',
  'scim.resource.deleted',
]);

interface UseSSEOptions {
  /** Whether to enable the SSE connection (default: true) */
  enabled?: boolean;
  /** SSE endpoint URL (default: /scim/admin/log-config/stream) */
  url?: string;
}

/**
 * Hook that connects to the SSE stream and invalidates relevant
 * TanStack Query cache entries when SCIM mutation events arrive.
 *
 * Automatically reconnects on disconnect with exponential backoff.
 */
export function useSSE(options: UseSSEOptions = {}) {
  const { enabled = true, url = '/scim/admin/log-config/stream?level=INFO' } = options;
  const queryClient = useQueryClient();
  const retryCount = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;

    const token = getStoredToken();
    const fullUrl = token ? `${url}&token=${encodeURIComponent(token)}` : url;

    const connect = () => {
      const es = new EventSource(fullUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCount.current = 0;
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventType = data?.type ?? data?.event;

          if (eventType && INVALIDATION_EVENTS.has(eventType)) {
            // Invalidate relevant caches - dashboard and endpoint stats
            queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
            queryClient.invalidateQueries({ queryKey: queryKeys.endpoints.all });

            // If event has endpoint-specific data, invalidate that too
            if (data.endpointId) {
              queryClient.invalidateQueries({
                queryKey: queryKeys.endpoints.detail(data.endpointId),
              });
              queryClient.invalidateQueries({
                queryKey: queryKeys.endpoints.stats(data.endpointId),
              });
            }
          }
        } catch {
          // Non-JSON SSE message (keepalive, etc.) - ignore
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, retryCount.current), 30_000);
        retryCount.current++;
        setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [enabled, url, queryClient]);
}
