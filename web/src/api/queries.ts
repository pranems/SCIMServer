/**
 * TanStack Query key factory + query hooks for the redesigned UI.
 *
 * Wraps the existing fetch-based client with proper cache keys, stale times,
 * and error handling. Uses the existing auth token management.
 *
 * Phase A4: each useQuery hook is now a thin wrapper around a matching
 * `*QueryOptions(...)` helper. Route loaders in web/src/routes/ pass
 * the same options object to `queryClient.ensureQueryData(...)` so the
 * loader and the component-side hook share one source of truth (URL,
 * key, fetcher, stale time). Without this duplication tax it is easy
 * for the loader to fetch a different URL or use a different cache key
 * than the component, leading to a "loader runs but nothing populates"
 * footgun.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D2 (TanStack Query)
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A4
 */
import { useQuery } from '@tanstack/react-query';
import type {
  DashboardResponse,
  EndpointListResponse,
  EndpointResponse,
  EndpointStatsResponse,
  VersionInfo,
  HealthResponse,
} from '@scim/types/dashboard.types';
import { getStoredToken, notifyTokenInvalid, clearStoredToken } from '../auth/token';

// ─── Base fetch wrapper ──────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

/** Authenticated fetch wrapper with automatic 401 handling */
export async function fetchWithAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    clearStoredToken();
    notifyTokenInvalid();
    throw new Error('Authentication required');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

// ─── Query key factory ───────────────────────────────────────────────

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  health: ['health'] as const,
  version: ['version'] as const,
  endpoints: {
    all: ['endpoints'] as const,
    detail: (id: string) => ['endpoints', id] as const,
    stats: (id: string) => ['endpoints', id, 'stats'] as const,
  },
  logs: {
    all: (params?: Record<string, unknown>) => ['logs', params] as const,
    detail: (id: string) => ['logs', id] as const,
  },
  users: {
    byEndpoint: (endpointId: string, params?: Record<string, unknown>) =>
      ['users', endpointId, params] as const,
  },
  groups: {
    byEndpoint: (endpointId: string, params?: Record<string, unknown>) =>
      ['groups', endpointId, params] as const,
  },
} as const;

// ─── Query options helpers (Phase A4) ────────────────────────────────
//
// These are the single source of truth for queryKey + queryFn + staleTime
// per resource. Route loaders pass them to queryClient.ensureQueryData;
// component hooks (below) pass them to useQuery. Keeping them as
// standalone exports avoids the React-only ergonomics of useQuery so
// they're callable from non-React loader contexts.

export const dashboardQueryOptions = () => ({
  queryKey: queryKeys.dashboard,
  queryFn: () => fetchWithAuth<DashboardResponse>('/scim/admin/dashboard'),
  staleTime: 30_000,
});

export const healthQueryOptions = () => ({
  queryKey: queryKeys.health,
  queryFn: () => fetchWithAuth<HealthResponse>('/scim/health'),
  staleTime: 10_000,
});

export const versionQueryOptions = () => ({
  queryKey: queryKeys.version,
  queryFn: () => fetchWithAuth<VersionInfo>('/scim/admin/version'),
  staleTime: 60_000,
});

export const endpointsQueryOptions = () => ({
  queryKey: queryKeys.endpoints.all,
  queryFn: () => fetchWithAuth<EndpointListResponse>('/scim/admin/endpoints'),
  staleTime: 30_000,
});

export const endpointDetailQueryOptions = (id: string) => ({
  queryKey: queryKeys.endpoints.detail(id),
  queryFn: () => fetchWithAuth<EndpointResponse>(`/scim/admin/endpoints/${id}`),
  staleTime: 30_000,
});

export const endpointStatsQueryOptions = (id: string) => ({
  queryKey: queryKeys.endpoints.stats(id),
  queryFn: () => fetchWithAuth<EndpointStatsResponse>(`/scim/admin/endpoints/${id}/stats`),
  staleTime: 30_000,
});

/** SCIM list response shape */
export interface ScimListResponse {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: Record<string, unknown>[];
}

export interface ScimListParams {
  startIndex?: number;
  count?: number;
  filter?: string;
}

function buildScimListQs(params?: ScimListParams): string {
  if (!params) return '';
  const qp = new URLSearchParams();
  if (params.startIndex) qp.set('startIndex', String(params.startIndex));
  if (params.count) qp.set('count', String(params.count));
  if (params.filter) qp.set('filter', params.filter);
  const qs = qp.toString();
  return qs ? `?${qs}` : '';
}

export const endpointUsersQueryOptions = (endpointId: string, params?: ScimListParams) => ({
  queryKey: queryKeys.users.byEndpoint(endpointId, params as Record<string, unknown> | undefined),
  queryFn: () =>
    fetchWithAuth<ScimListResponse>(`/scim/endpoints/${endpointId}/Users${buildScimListQs(params)}`),
  staleTime: 15_000,
});

export const endpointGroupsQueryOptions = (endpointId: string, params?: ScimListParams) => ({
  queryKey: queryKeys.groups.byEndpoint(endpointId, params as Record<string, unknown> | undefined),
  queryFn: () =>
    fetchWithAuth<ScimListResponse>(`/scim/endpoints/${endpointId}/Groups${buildScimListQs(params)}`),
  staleTime: 15_000,
});

// ─── Admin log query options (Phase A4) ──────────────────────────────
//
// LogsTab + LogsPage previously inlined their useQuery calls with
// queryKeys + queryFns embedded. Phase A4 extracts them so the
// per-route loaders can call ensureQueryData against the same
// definitions.

/** Generic shape returned by GET /scim/admin/logs. */
export interface AdminLogsResponse {
  items: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface EndpointLogsParams {
  endpointId: string;
  page: number;
  pageSize: number;
  urlContains?: string;
}

export const endpointLogsQueryOptions = (params: EndpointLogsParams) => {
  const qs = new URLSearchParams({
    endpointId: params.endpointId,
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.urlContains) qs.set('urlContains', params.urlContains);
  return {
    queryKey: ['endpoint-logs', params.endpointId, params.page, params.pageSize, params.urlContains ?? ''] as const,
    queryFn: () => fetchWithAuth<AdminLogsResponse>(`/scim/admin/logs?${qs.toString()}`),
    staleTime: 10_000,
  };
};

export interface GlobalLogsParams {
  urlContains?: string;
  pageSize?: number;
}

export const globalLogsQueryOptions = (params: GlobalLogsParams = {}) => {
  const pageSize = params.pageSize ?? 50;
  const qs = new URLSearchParams({ pageSize: String(pageSize) });
  if (params.urlContains) qs.set('urlContains', params.urlContains);
  return {
    queryKey: ['global-logs', params.urlContains ?? ''] as const,
    queryFn: () => fetchWithAuth<AdminLogsResponse>(`/scim/admin/logs?${qs.toString()}`),
    staleTime: 10_000,
  };
};

// ─── Query hooks ─────────────────────────────────────────────────────

/** Fetch aggregated dashboard data (BFF endpoint - 0 DB queries for stats) */
export function useDashboard() {
  return useQuery<DashboardResponse>(dashboardQueryOptions());
}

/** Fetch health status */
export function useHealth() {
  return useQuery<HealthResponse>({
    ...healthQueryOptions(),
    refetchInterval: 30_000,
  });
}

/** Fetch version info */
export function useVersion() {
  return useQuery<VersionInfo>(versionQueryOptions());
}

/** Fetch all endpoints */
export function useEndpoints() {
  return useQuery<EndpointListResponse>(endpointsQueryOptions());
}

/** Fetch single endpoint detail */
export function useEndpoint(id: string) {
  return useQuery<EndpointResponse>({
    ...endpointDetailQueryOptions(id),
    enabled: !!id,
  });
}

/** Fetch endpoint stats */
export function useEndpointStats(id: string) {
  return useQuery<EndpointStatsResponse>({
    ...endpointStatsQueryOptions(id),
    enabled: !!id,
  });
}

/** Fetch SCIM users for an endpoint */
export function useEndpointUsers(endpointId: string, params?: ScimListParams) {
  return useQuery<ScimListResponse>({
    ...endpointUsersQueryOptions(endpointId, params),
    enabled: !!endpointId,
  });
}

/** Fetch SCIM groups for an endpoint */
export function useEndpointGroups(endpointId: string, params?: ScimListParams) {
  return useQuery<ScimListResponse>({
    ...endpointGroupsQueryOptions(endpointId, params),
    enabled: !!endpointId,
  });
}
