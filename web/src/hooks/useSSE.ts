/**
 * useSSE - React hook for Server-Sent Events (SSE) integration.
 *
 * Listens to the SCIM event stream and invalidates TanStack Query cache
 * when SCIM mutations occur. This enables near-real-time dashboard updates
 * without polling.
 *
 * Phase B3 (granular invalidation):
 *   - The pre-B3 implementation always invalidated the dashboard +
 *     endpoints-list keys on every SCIM event, plus per-endpoint
 *     `detail` and `stats` keys when an endpointId was on the payload.
 *     That worked but missed two queries the new UI depends on:
 *     `endpoints.overview(id)` (Phase B1 BFF) and the per-endpoint SCIM
 *     resource lists (`users.byEndpoint`, `groups.byEndpoint`) used by
 *     the Users / Groups tabs. After a `scim.user.created` event the
 *     stat cards refetched but the row table stayed stale until the
 *     30s staleTime kicked in.
 *   - This version maps each event type to the exact set of keys it
 *     should invalidate. The mapping is exported for unit tests so the
 *     contract is locked in (`EVENT_INVALIDATIONS`).
 *
 * Design decision D8: SSE multiplexing (uni-directional server-push).
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D8
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B3
 */
import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getStoredToken } from '../auth/token';
import { queryKeys } from '../api/queries';

/** Names of every SCIM mutation event we react to. */
export const SUPPORTED_EVENT_TYPES = [
  'scim.user.created',
  'scim.user.updated',
  'scim.user.deleted',
  'scim.group.created',
  'scim.group.updated',
  'scim.group.deleted',
  'scim.resource.created',
  'scim.resource.deleted',
  'scim.credential.created',
  'scim.credential.revoked',
  'scim.endpoint.created',
  'scim.endpoint.updated',
  'scim.endpoint.deleted',
] as const;

export type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

/** Channel buckets the events feed into. */
type Channel = 'users' | 'groups' | 'resources' | 'credentials' | 'endpoints';

/** Map every supported event type to its channel. */
const EVENT_CHANNEL: Record<SupportedEventType, Channel> = {
  'scim.user.created': 'users',
  'scim.user.updated': 'users',
  'scim.user.deleted': 'users',
  'scim.group.created': 'groups',
  'scim.group.updated': 'groups',
  'scim.group.deleted': 'groups',
  'scim.resource.created': 'resources',
  'scim.resource.deleted': 'resources',
  'scim.credential.created': 'credentials',
  'scim.credential.revoked': 'credentials',
  'scim.endpoint.created': 'endpoints',
  'scim.endpoint.updated': 'endpoints',
  'scim.endpoint.deleted': 'endpoints',
};

/**
 * Compute the exact list of queryKeys that must be invalidated for a
 * given event. Exported so unit tests can lock in the mapping without
 * spinning up an EventSource.
 *
 * Rules:
 *   - Stats and dashboard counts are touched by every mutation.
 *   - User/group list pages for the affected endpoint must refetch.
 *   - Resource events touch the dashboard + endpoint stats but the new
 *     UI doesn't surface generic resources in a list yet, so we don't
 *     try to invalidate that here. When the Generic Resources tab
 *     lands (Phase D), add the invalidation alongside.
 *   - Credential events touch the per-endpoint Overview BFF (which
 *     embeds the credential list) plus a future credentials list query.
 *   - Endpoint mutations touch the global endpoints list + per-endpoint
 *     overview if the payload identifies one.
 */
export function computeInvalidations(
  type: SupportedEventType,
  endpointId: string | undefined,
): readonly (readonly unknown[])[] {
  const channel = EVENT_CHANNEL[type];
  const keys: (readonly unknown[])[] = [
    // Always-invalidate keys.
    queryKeys.dashboard,
  ];

  switch (channel) {
    case 'users':
    case 'groups':
    case 'resources':
      // Stats + per-endpoint overview + per-endpoint resource list.
      if (endpointId) {
        keys.push(queryKeys.endpoints.stats(endpointId));
        keys.push(queryKeys.endpoints.overview(endpointId));
        // The byEndpoint key embeds the params object; passing only
        // [resource, endpointId] invalidates EVERY paginated variant
        // (TanStack Query treats the missing tail as a wildcard). Use
        // the same factory the mutation hooks use so changes stay in
        // lock-step (Phase C5 v0.44.1).
        if (channel === 'users') {
          keys.push(queryKeys.users.all(endpointId));
        } else if (channel === 'groups') {
          keys.push(queryKeys.groups.all(endpointId));
        }
      }
      break;
    case 'credentials':
      // Credentials are embedded in the Overview BFF; invalidate it so
      // the credential KPI card and the future Credentials tab refetch.
      if (endpointId) {
        keys.push(queryKeys.endpoints.overview(endpointId));
      }
      break;
    case 'endpoints':
      // Endpoint CRUD changes the list AND any cached detail / overview
      // for that specific endpoint.
      keys.push(queryKeys.endpoints.all);
      if (endpointId) {
        keys.push(queryKeys.endpoints.detail(endpointId));
        keys.push(queryKeys.endpoints.overview(endpointId));
        keys.push(queryKeys.endpoints.stats(endpointId));
      }
      break;
  }

  return keys;
}

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
          if (!isSupportedEvent(eventType)) return;
          dispatchInvalidations(queryClient, eventType, data?.endpointId);
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

function isSupportedEvent(t: unknown): t is SupportedEventType {
  return typeof t === 'string' && (SUPPORTED_EVENT_TYPES as readonly string[]).includes(t);
}

function dispatchInvalidations(
  qc: QueryClient,
  type: SupportedEventType,
  endpointId: unknown,
): void {
  const id = typeof endpointId === 'string' && endpointId.length > 0 ? endpointId : undefined;
  const keys = computeInvalidations(type, id);
  for (const queryKey of keys) {
    qc.invalidateQueries({ queryKey });
  }
}
