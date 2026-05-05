/**
 * TanStack Query key factory + query hooks for the redesigned UI.
 *
 * Wraps the existing fetch-based client with proper cache keys, stale times,
 * and error handling. Uses the existing auth token management.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D2 (TanStack Query)
 */
import { useQuery } from '@tanstack/react-query';
import type {
  DashboardResponse,
  EndpointListResponse,
  EndpointResponse,
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

// ─── Query hooks ─────────────────────────────────────────────────────

/** Fetch aggregated dashboard data (BFF endpoint - 0 DB queries for stats) */
export function useDashboard() {
  return useQuery<DashboardResponse>({
    queryKey: queryKeys.dashboard,
    queryFn: () => fetchWithAuth('/scim/admin/dashboard'),
    staleTime: 30_000,
  });
}

/** Fetch health status */
export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: queryKeys.health,
    queryFn: () => fetchWithAuth('/scim/health'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** Fetch version info */
export function useVersion() {
  return useQuery<VersionInfo>({
    queryKey: queryKeys.version,
    queryFn: () => fetchWithAuth('/scim/admin/version'),
    staleTime: 60_000,
  });
}

/** Fetch all endpoints */
export function useEndpoints() {
  return useQuery<EndpointListResponse>({
    queryKey: queryKeys.endpoints.all,
    queryFn: () => fetchWithAuth('/scim/admin/endpoints'),
    staleTime: 30_000,
  });
}

/** Fetch single endpoint detail */
export function useEndpoint(id: string) {
  return useQuery<EndpointResponse>({
    queryKey: queryKeys.endpoints.detail(id),
    queryFn: () => fetchWithAuth(`/scim/admin/endpoints/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}
