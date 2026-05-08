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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DashboardResponse,
  EndpointListResponse,
  EndpointResponse,
  EndpointStatsResponse,
  EndpointOverviewResponse,
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
    overview: (id: string) => ['endpoints', id, 'overview'] as const,
  },
  logs: {
    all: (params?: Record<string, unknown>) => ['logs', params] as const,
    detail: (id: string) => ['logs', id] as const,
  },
  users: {
    /**
     * Prefix key for every per-endpoint Users list cache entry. Used by
     * mutations and SSE invalidation: `invalidateQueries({ queryKey:
     * queryKeys.users.all(id) })` matches every paginated/filtered
     * variant under that endpoint via TanStack Query's prefix-match.
     */
     all: (endpointId: string) => ['users', endpointId] as const,
    byEndpoint: (endpointId: string, params?: Record<string, unknown>) =>
      ['users', endpointId, params] as const,
  },
  groups: {
    /** Prefix key for every per-endpoint Groups list cache entry. */
    all: (endpointId: string) => ['groups', endpointId] as const,
    byEndpoint: (endpointId: string, params?: Record<string, unknown>) =>
      ['groups', endpointId, params] as const,
  },
  activity: {
    /**
     * Prefix key for every per-endpoint Activity list cache entry.
     * Used by SSE invalidation so a SCIM write/log mutation refetches
     * every cached page/filter combination for that endpoint.
     */
    all: (endpointId: string) => ['activity', endpointId] as const,
    byEndpoint: (endpointId: string, params?: Record<string, unknown>) =>
      ['activity', endpointId, params] as const,
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

/**
 * Phase B1 BFF query options. Aggregates endpoint summary, stats,
 * credentials, recent activity, and config flags into a single round
 * trip with zero DB queries on warm cache. The OverviewTab uses this
 * instead of stitching three separate hooks (useEndpoint +
 * useEndpointStats + useEndpointCredentials), eliminating waterfall
 * latency and duplicate network requests.
 *
 * @see api/src/modules/dashboard/dashboard.controller.ts
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B1
 */
export const endpointOverviewQueryOptions = (id: string) => ({
  queryKey: queryKeys.endpoints.overview(id),
  queryFn: () =>
    fetchWithAuth<EndpointOverviewResponse>(`/scim/admin/endpoints/${id}/overview`),
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
  // Phase D5 - additional filter dimensions surfaced on the Global
  // Logs page. All optional; the backend treats undefined as "no
  // restriction" so partial filter states work transparently.
  endpointId?: string;
  status?: number;
  /**
   * ISO 8601 lower bound on createdAt. The Global Logs page derives
   * this from a closed-set time-range picker (1h / 24h / 7d / 30d),
   * computed at navigation time and persisted in the URL via the zod
   * search-param schema.
   */
  since?: string;
  /** ISO 8601 upper bound. Currently unused by the picker but accepted. */
  until?: string;
}

export const globalLogsQueryOptions = (params: GlobalLogsParams = {}) => {
  const pageSize = params.pageSize ?? 50;
  const qs = new URLSearchParams({ pageSize: String(pageSize) });
  if (params.urlContains) qs.set('urlContains', params.urlContains);
  if (params.endpointId) qs.set('endpointId', params.endpointId);
  if (typeof params.status === 'number') qs.set('status', String(params.status));
  if (params.since) qs.set('since', params.since);
  if (params.until) qs.set('until', params.until);
  return {
    // Cache key includes every filter dimension so changing one of
    // them yields a distinct cache entry (no accidental stale-data
    // bleed across filter combinations).
    queryKey: [
      'global-logs',
      params.urlContains ?? '',
      params.endpointId ?? '',
      params.status ?? '',
      params.since ?? '',
      params.until ?? '',
      pageSize,
    ] as const,
    queryFn: () => fetchWithAuth<AdminLogsResponse>(`/scim/admin/logs?${qs.toString()}`),
    staleTime: 10_000,
  };
};

/**
 * Phase D5 - hook wrapper around globalLogsQueryOptions for components
 * that don't need to compose the options object (route loaders still
 * use the options form for ensureQueryData).
 */
export const useGlobalLogs = (params: GlobalLogsParams = {}) =>
  useQuery(globalLogsQueryOptions(params));

/**
 * Phase D5 - per-log detail hook. Powers the DetailDrawer slide-over
 * on the Global Logs page when a row is clicked. The detail endpoint
 * returns parsed request/response bodies + headers, so we fetch on
 * demand rather than carrying every log body in the list response.
 */
export interface GlobalLogDetail {
  id: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  createdAt: string | Date;
  requestHeaders?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  errorMessage?: string;
  reportableIdentifier?: string;
}

export const globalLogDetailQueryOptions = (id: string | undefined) => ({
  // When `id` is undefined the query is disabled (enabled: false) so
  // we never request /admin/logs/undefined. The key still includes the
  // (undefined) id for cache distinction.
  queryKey: ['global-logs', 'detail', id] as const,
  queryFn: () => fetchWithAuth<GlobalLogDetail>(`/scim/admin/logs/${id!}`),
  enabled: Boolean(id),
  staleTime: 60_000, // log bodies are immutable - long stale time is fine
});

export const useGlobalLog = (id: string | undefined) =>
  useQuery(globalLogDetailQueryOptions(id));

// ─── Activity (Phase D2) ─────────────────────────────────────────────
//
// GET /admin/activity returns parsed SCIM operations. Phase D2 adds
// optional endpointId scoping for the new ActivityTab on
// /endpoints/$id/activity. Filters live in URL search params (zod
// schema in routes/search-schemas.ts) so deep-links and refresh
// preserve them.

export interface ActivitySummaryItem {
  id: string;
  type: 'user' | 'group' | 'system';
  severity: 'info' | 'success' | 'warning' | 'error';
  timestamp: string | Date;
  icon: string;
  message: string;
  details: string;
  isKeepalive?: boolean;
  // Activity parser may include extra fields per type; keep loose so
  // future server additions don't break the type-check.
  [key: string]: unknown;
}

export interface ActivityResponse {
  activities: ActivitySummaryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
  filters: {
    types: string[];
    severities: string[];
  };
}

export interface EndpointActivityParams {
  endpointId: string;
  page: number;
  limit: number;
  type?: string;
  severity?: string;
  search?: string;
}

export const endpointActivityQueryOptions = (params: EndpointActivityParams) => {
  const qs = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    endpointId: params.endpointId,
  });
  if (params.type) qs.set('type', params.type);
  if (params.severity) qs.set('severity', params.severity);
  if (params.search) qs.set('search', params.search);
  return {
    queryKey: queryKeys.activity.byEndpoint(params.endpointId, {
      page: params.page,
      limit: params.limit,
      type: params.type,
      severity: params.severity,
      search: params.search,
    }),
    queryFn: () => fetchWithAuth<ActivityResponse>(`/scim/admin/activity?${qs.toString()}`),
    // Activity is "live-feel" data; 10s matches the logs queries so
    // the perceived freshness is consistent across tabs.
    staleTime: 10_000,
  };
};

// ─── Schemas (Phase D3) ──────────────────────────────────────────────
//
// GET /scim/endpoints/:id/Schemas returns the full SCIM ListResponse of
// schemas declared by the endpoint's profile. Schemas rarely change
// per endpoint after configuration, so we cache for 5 minutes (matches
// the plan section 7.2 "stale time" recommendation for schemas).

export interface ScimAttributeCharacteristic {
  name: string;
  type: string;
  required?: boolean;
  multiValued?: boolean;
  caseExact?: boolean;
  mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned?: 'always' | 'default' | 'never' | 'request';
  uniqueness?: 'none' | 'server' | 'global';
  description?: string;
  canonicalValues?: string[];
  referenceTypes?: string[];
  subAttributes?: ScimAttributeCharacteristic[];
}

export interface ScimSchemaResource {
  id: string;
  name?: string;
  description?: string;
  attributes: ScimAttributeCharacteristic[];
  meta?: { resourceType?: string; location?: string };
  schemas?: string[];
}

export interface ScimSchemasResponse {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimSchemaResource[];
}

export const endpointSchemasQueryOptions = (endpointId: string) => ({
  queryKey: ['endpoint-schemas', endpointId] as const,
  queryFn: () =>
    fetchWithAuth<ScimSchemasResponse>(`/scim/endpoints/${endpointId}/Schemas`),
  staleTime: 5 * 60_000, // 5 minutes
});

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

/**
 * Fetch the per-endpoint Overview BFF response (Phase B1).
 * One round trip; warm cache means zero spinner.
 */
export function useEndpointOverview(id: string) {
  return useQuery<EndpointOverviewResponse>({
    ...endpointOverviewQueryOptions(id),
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

/**
 * Fetch parsed SCIM activity scoped to one endpoint (Phase D2).
 * Filters live in the URL via routes/search-schemas.ts so deep-links
 * preserve them. Disabled when endpointId is empty (e.g. before the
 * route param resolves).
 */
export function useEndpointActivity(params: EndpointActivityParams) {
  return useQuery<ActivityResponse>({
    ...endpointActivityQueryOptions(params),
    enabled: !!params.endpointId,
  });
}

/**
 * Fetch the full SCIM /Schemas list for one endpoint (Phase D3).
 * Cached 5min - schemas rarely change after endpoint configuration.
 * Used by SchemasTab for the read-only schema explorer tree.
 */
export function useEndpointSchemas(endpointId: string) {
  return useQuery<ScimSchemasResponse>({
    ...endpointSchemasQueryOptions(endpointId),
    enabled: !!endpointId,
  });
}

// ─── Mutation hooks (Phase C5 + v0.44.1 hardening) ───────────────────
//
// Universal pattern: onMutate snapshot -> optimistic write -> onError
// rollback -> onSettled invalidate. Each mutation ships with both
// branches tested (success + rollback).
//
// CREATE mutations skip onMutate because the server assigns the id
// (no deterministic optimistic shape).
//
// SCIM PATCH/DELETE mutations accept an optional `ifMatch` ETag
// argument. When supplied it is forwarded as the If-Match request
// header so endpoints with the `RequireIfMatch` config flag (G7) get
// 412 / 428 enforcement instead of 200 OK with a stale write. The
// drawer/UI code that triggers the mutation knows the latest ETag
// from the cached resource and is responsible for passing it in.
//
// Universal patch helper: applies a partial body to every cached
// SCIM-list page that contains the target resource. Used by the
// optimistic User/Group PATCH hooks to make the row reflect the new
// values immediately.

interface ScimResource extends Record<string, unknown> {
  id?: string;
}

interface MutationContextWithListSnapshots {
  /**
   * Snapshot of every list-cache entry that matched the prefix when
   * the mutation began. onError walks this map and restores each
   * entry verbatim.
   */
  prevLists: Array<[readonly unknown[], ScimListResponse | undefined]>;
}

/**
 * Build an If-Match header object only when a non-empty value is
 * supplied. Centralises the conditional so individual hooks stay
 * readable.
 */
function ifMatchHeaders(ifMatch?: string): Record<string, string> | undefined {
  if (!ifMatch || ifMatch.trim() === '') return undefined;
  return { 'If-Match': ifMatch };
}

/**
 * Apply `mutator` to every cached list response under `prefix` whose
 * Resources contain a row whose id matches `targetId`. Returns the
 * snapshot list so the caller can roll back.
 */
function patchListsContaining(
  qc: ReturnType<typeof useQueryClient>,
  prefix: readonly unknown[],
  targetId: string,
  mutator: (list: ScimListResponse) => ScimListResponse,
): Array<[readonly unknown[], ScimListResponse | undefined]> {
  const snapshots: Array<[readonly unknown[], ScimListResponse | undefined]> = [];
  const matches = qc.getQueriesData<ScimListResponse>({ queryKey: prefix });
  for (const [key, data] of matches) {
    snapshots.push([key, data]);
    if (!data) continue;
    const resources = data.Resources as ScimResource[];
    if (!resources.some((r) => r.id === targetId)) continue;
    qc.setQueryData<ScimListResponse>(key, mutator(data));
  }
  return snapshots;
}

/** Restore every snapshot captured by `patchListsContaining`. */
function restoreListSnapshots(
  qc: ReturnType<typeof useQueryClient>,
  snapshots: Array<[readonly unknown[], ScimListResponse | undefined]>,
): void {
  for (const [key, data] of snapshots) {
    qc.setQueryData(key, data);
  }
}

/** Create a per-endpoint bearer credential. */
export function useCreateCredential(endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label?: string; expiresAt?: string }) =>
      fetchWithAuth(`/scim/admin/endpoints/${endpointId}/credentials`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/** Revoke (delete) a per-endpoint credential. Optimistic: removes from cached overview. */
export function useDeleteCredential(endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentialId: string) =>
      fetchWithAuth(`/scim/admin/endpoints/${endpointId}/credentials/${credentialId}`, {
        method: 'DELETE',
      }),
    onMutate: async (credentialId: string) => {
      await qc.cancelQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
      const prev = qc.getQueryData<EndpointOverviewResponse>(
        queryKeys.endpoints.overview(endpointId),
      );
      if (prev) {
        qc.setQueryData<EndpointOverviewResponse>(
          queryKeys.endpoints.overview(endpointId),
          {
            ...prev,
            credentials: prev.credentials.filter((c) => c.id !== credentialId),
          },
        );
      }
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) {
        qc.setQueryData(queryKeys.endpoints.overview(endpointId), context.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/**
 * Update endpoint profile / settings / displayName. Optimistic flag toggle.
 *
 * Phase E2: when the body carries `profile.settings` (the SettingsTab
 * config-flag toggle case), we deep-merge into both the endpoint detail
 * cache (`profile.settings`) AND the overview BFF cache (`configFlags`).
 * Without the deep-merge a single flag flip would clobber `profile`
 * entirely (losing schemas, resourceTypes, and every sibling flag) and
 * the SettingsTab would visually "lose" every other switch until the
 * background refetch landed. The overview cache mirror is what makes
 * the toggle feel instant on the active tab.
 *
 * For non-settings PATCHes (`displayName`, `description`, `active`)
 * we keep the shallow merge against the detail cache - that path was
 * tested in v0.44.0 and we don't want to regress it.
 */
export function useUpdateEndpointConfig(endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchWithAuth(`/scim/admin/endpoints/${endpointId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onMutate: async (body: Record<string, unknown>) => {
      await qc.cancelQueries({ queryKey: queryKeys.endpoints.detail(endpointId) });
      await qc.cancelQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });

      const prevDetail = qc.getQueryData<EndpointResponse>(
        queryKeys.endpoints.detail(endpointId),
      );
      const prevOverview = qc.getQueryData<EndpointOverviewResponse>(
        queryKeys.endpoints.overview(endpointId),
      );

      // Detect a profile.settings sub-update once; reuse for both caches.
      const profilePatch = (body as { profile?: Record<string, unknown> }).profile;
      const settingsPatch =
        profilePatch && typeof profilePatch === 'object'
          ? (profilePatch.settings as Record<string, unknown> | undefined)
          : undefined;

      // ─── endpoint detail cache (full profile, deep merge) ──────
      if (prevDetail) {
        const mergedProfile = profilePatch
          ? {
              ...((prevDetail.profile as Record<string, unknown> | undefined) ?? {}),
              ...profilePatch,
              ...(settingsPatch
                ? {
                    settings: {
                      ...(((prevDetail.profile as Record<string, unknown> | undefined)?.settings as Record<string, unknown> | undefined) ?? {}),
                      ...settingsPatch,
                    },
                  }
                : {}),
            }
          : prevDetail.profile;

        // Strip profile from the spread so we don't double-apply it.
        const { profile: _profileFromBody, ...restBody } = body as { profile?: unknown } & Record<string, unknown>;
        qc.setQueryData<EndpointResponse>(
          queryKeys.endpoints.detail(endpointId),
          {
            ...prevDetail,
            ...(restBody as Partial<EndpointResponse>),
            ...(profilePatch ? { profile: mergedProfile as Record<string, unknown> } : {}),
          },
        );
      }

      // ─── overview cache (configFlags only) ─────────────────────
      if (prevOverview && settingsPatch) {
        qc.setQueryData<EndpointOverviewResponse>(
          queryKeys.endpoints.overview(endpointId),
          {
            ...prevOverview,
            configFlags: { ...prevOverview.configFlags, ...settingsPatch },
          },
        );
      }

      return { prevDetail, prevOverview };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevDetail) {
        qc.setQueryData(queryKeys.endpoints.detail(endpointId), context.prevDetail);
      }
      if (context?.prevOverview) {
        qc.setQueryData(queryKeys.endpoints.overview(endpointId), context.prevOverview);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.detail(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/** Create a SCIM User via POST /endpoints/:id/Users. */
export function useCreateUser(endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchWithAuth(`/scim/endpoints/${endpointId}/Users`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/** Create a SCIM Group via POST /endpoints/:id/Groups. */
export function useCreateGroup(endpointId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetchWithAuth(`/scim/endpoints/${endpointId}/Groups`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.groups.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/**
 * PATCH a SCIM User. Optimistic: applies the body shallow-merge to
 * every cached list page that contains the target row, then rolls
 * back on error. Forwards `If-Match` when supplied so endpoints with
 * `RequireIfMatch` enforce the ETag (RFC 7644 S3.1).
 */
export function useUpdateUser(endpointId: string) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { userId: string; body: Record<string, unknown>; ifMatch?: string },
    MutationContextWithListSnapshots
  >({
    mutationFn: (args) =>
      fetchWithAuth(`/scim/endpoints/${endpointId}/Users/${args.userId}`, {
        method: 'PATCH',
        body: JSON.stringify(args.body),
        headers: ifMatchHeaders(args.ifMatch),
      }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.all(endpointId) });
      const prevLists = patchListsContaining(
        qc,
        queryKeys.users.all(endpointId),
        args.userId,
        (list) => ({
          ...list,
          Resources: (list.Resources as ScimResource[]).map((r) =>
            r.id === args.userId ? { ...r, ...args.body } : r,
          ),
        }),
      );
      return { prevLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevLists) restoreListSnapshots(qc, context.prevLists);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/**
 * DELETE a SCIM User. Optimistic: removes the row from every cached
 * list page, then rolls back on error. Forwards `If-Match` when
 * supplied so endpoints with `RequireIfMatch` reject stale deletes.
 */
export function useDeleteUser(endpointId: string) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    string | { userId: string; ifMatch?: string },
    MutationContextWithListSnapshots
  >({
    mutationFn: (args) => {
      const { userId, ifMatch } =
        typeof args === 'string' ? { userId: args, ifMatch: undefined } : args;
      return fetchWithAuth(`/scim/endpoints/${endpointId}/Users/${userId}`, {
        method: 'DELETE',
        headers: ifMatchHeaders(ifMatch),
      });
    },
    onMutate: async (args) => {
      const userId = typeof args === 'string' ? args : args.userId;
      await qc.cancelQueries({ queryKey: queryKeys.users.all(endpointId) });
      const prevLists = patchListsContaining(
        qc,
        queryKeys.users.all(endpointId),
        userId,
        (list) => ({
          ...list,
          totalResults: Math.max(0, list.totalResults - 1),
          Resources: (list.Resources as ScimResource[]).filter((r) => r.id !== userId),
        }),
      );
      return { prevLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevLists) restoreListSnapshots(qc, context.prevLists);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.users.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/**
 * PATCH a SCIM Group. Optimistic: shallow-merges `body` into every
 * cached list page that contains the target row, then rolls back on
 * error. Forwards `If-Match` when supplied.
 */
export function useUpdateGroup(endpointId: string) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { groupId: string; body: Record<string, unknown>; ifMatch?: string },
    MutationContextWithListSnapshots
  >({
    mutationFn: (args) =>
      fetchWithAuth(`/scim/endpoints/${endpointId}/Groups/${args.groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(args.body),
        headers: ifMatchHeaders(args.ifMatch),
      }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: queryKeys.groups.all(endpointId) });
      const prevLists = patchListsContaining(
        qc,
        queryKeys.groups.all(endpointId),
        args.groupId,
        (list) => ({
          ...list,
          Resources: (list.Resources as ScimResource[]).map((r) =>
            r.id === args.groupId ? { ...r, ...args.body } : r,
          ),
        }),
      );
      return { prevLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevLists) restoreListSnapshots(qc, context.prevLists);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.groups.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}

/**
 * DELETE a SCIM Group. Optimistic: removes from every cached list
 * page, then rolls back on error. Forwards `If-Match` when supplied.
 */
export function useDeleteGroup(endpointId: string) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    string | { groupId: string; ifMatch?: string },
    MutationContextWithListSnapshots
  >({
    mutationFn: (args) => {
      const { groupId, ifMatch } =
        typeof args === 'string' ? { groupId: args, ifMatch: undefined } : args;
      return fetchWithAuth(`/scim/endpoints/${endpointId}/Groups/${groupId}`, {
        method: 'DELETE',
        headers: ifMatchHeaders(ifMatch),
      });
    },
    onMutate: async (args) => {
      const groupId = typeof args === 'string' ? args : args.groupId;
      await qc.cancelQueries({ queryKey: queryKeys.groups.all(endpointId) });
      const prevLists = patchListsContaining(
        qc,
        queryKeys.groups.all(endpointId),
        groupId,
        (list) => ({
          ...list,
          totalResults: Math.max(0, list.totalResults - 1),
          Resources: (list.Resources as ScimResource[]).filter((r) => r.id !== groupId),
        }),
      );
      return { prevLists };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevLists) restoreListSnapshots(qc, context.prevLists);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.groups.all(endpointId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard });
      qc.invalidateQueries({ queryKey: queryKeys.endpoints.overview(endpointId) });
    },
  });
}
