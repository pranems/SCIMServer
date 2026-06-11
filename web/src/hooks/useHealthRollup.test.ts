/**
 * useHealthRollup.test.ts - Phase K2 service-health rollup hook contract.
 *
 * Asserts the rollup logic that aggregates `useHealth` + `useVersion` +
 * `useDashboard` + the SSE connection state from ui-store into a single
 * traffic-light `{ status, subStatuses }` shape consumed by the
 * <HealthRollup /> header widget.
 *
 * The hook is the source of truth for the operator's at-a-glance health
 * surface; locking the substatus contract here prevents future PRs from
 * silently widening / narrowing what is rolled up.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S6.10
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useHealthRollup,
  rollupOverallStatus,
  type HealthSubStatus,
  type HealthSubStatusName,
  type HealthRollupStatus,
} from './useHealthRollup';
import { useUIStore } from '../store/ui-store';

// ─── Mocks ────────────────────────────────────────────────────────────
// We mock the underlying queries so the test exercises ONLY the rollup
// reducer, not the network layer. The hook contracts of useHealth /
// useVersion / useDashboard are covered by their own existing specs.

const useHealthMock = vi.fn();
const useVersionMock = vi.fn();
const useDashboardMock = vi.fn();

vi.mock('../api/queries', () => ({
  useHealth: (..._args: unknown[]) => useHealthMock(),
  useVersion: (..._args: unknown[]) => useVersionMock(),
  useDashboard: (..._args: unknown[]) => useDashboardMock(),
}));

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

// Defaults: everything healthy.
function setQueriesHealthy() {
  useHealthMock.mockReturnValue({
    data: { status: 'ok', uptime: 12345, timestamp: '2026-05-12T20:00:00Z' },
    isLoading: false,
    isError: false,
    error: null,
  });
  useVersionMock.mockReturnValue({
    data: {
      version: '0.49.0-alpha.2',
      service: { now: '2026-05-12T20:00:00Z' },
      runtime: {},
      auth: {
        oauthClientSecretConfigured: true,
        jwtSecretConfigured: true,
        scimSharedSecretConfigured: true,
      },
      storage: {
        databaseProvider: 'postgresql',
        persistenceBackend: 'prisma',
      },
    },
    isLoading: false,
    isError: false,
    error: null,
  });
  useDashboardMock.mockReturnValue({
    data: {
      health: { status: 'ok', uptime: 100, dbType: 'postgresql' },
      stats: { totalEndpoints: 1, totalUsers: 1, totalGroups: 1 },
      endpoints: [],
      recentActivity: [],
      requestsLast24hSeries: new Array(24).fill(0),
    },
    isLoading: false,
    isError: false,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset ui-store between tests
  useUIStore.setState({ sseConnectionState: 'open' });
  setQueriesHealthy();
});

describe('rollupOverallStatus (pure reducer)', () => {
  it('returns "healthy" when every substatus is healthy', () => {
    const subs: HealthSubStatus[] = [
      { name: 'API', status: 'healthy', detail: 'OK' },
      { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
      { name: 'Auth', status: 'healthy', detail: 'All 3 secrets configured' },
      { name: 'Realtime', status: 'healthy', detail: 'SSE open' },
      { name: 'Recent errors', status: 'healthy', detail: '0 in last hour' },
    ];
    expect(rollupOverallStatus(subs)).toBe<HealthRollupStatus>('healthy');
  });

  it('returns "degraded" when any substatus is degraded but none are down', () => {
    const subs: HealthSubStatus[] = [
      { name: 'API', status: 'healthy', detail: 'OK' },
      { name: 'Auth', status: 'degraded', detail: '1 secret missing' },
    ];
    expect(rollupOverallStatus(subs)).toBe<HealthRollupStatus>('degraded');
  });

  it('returns "down" if any substatus is down (overrides any number of degraded/healthy)', () => {
    const subs: HealthSubStatus[] = [
      { name: 'API', status: 'down', detail: 'unreachable' },
      { name: 'Auth', status: 'degraded', detail: '1 missing' },
      { name: 'Database', status: 'healthy', detail: 'OK' },
    ];
    expect(rollupOverallStatus(subs)).toBe<HealthRollupStatus>('down');
  });

  it('returns "unknown" when given an empty list (defensive default)', () => {
    expect(rollupOverallStatus([])).toBe<HealthRollupStatus>('unknown');
  });
});

describe('useHealthRollup', () => {
  it('exposes the canonical 5-substatus surface in stable order', () => {
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const names = result.current.subStatuses.map((s) => s.name);
    const expected: HealthSubStatusName[] = ['API', 'Database', 'Auth', 'Realtime', 'Recent errors'];
    expect(names).toEqual(expected);
  });

  it('reports overall=healthy when every signal is green', () => {
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('healthy');
    for (const sub of result.current.subStatuses) {
      expect(sub.status).toBe('healthy');
    }
  });

  it('marks API down when /health errored', () => {
    useHealthMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const api = result.current.subStatuses.find((s) => s.name === 'API')!;
    expect(api.status).toBe('down');
    expect(result.current.status).toBe('down');
  });

  it('marks Database down when version errored (cannot read storage block)', () => {
    useVersionMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('boom') });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const db = result.current.subStatuses.find((s) => s.name === 'Database')!;
    expect(db.status).toBe('down');
  });

  it('marks Auth degraded when 1-2 of the 3 secrets are unconfigured', () => {
    useVersionMock.mockReturnValue({
      data: {
        version: 'x',
        service: {}, runtime: {},
        auth: { oauthClientSecretConfigured: false, jwtSecretConfigured: true, scimSharedSecretConfigured: true },
        storage: { databaseProvider: 'postgresql', persistenceBackend: 'prisma' },
      },
      isLoading: false, isError: false, error: null,
    });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const auth = result.current.subStatuses.find((s) => s.name === 'Auth')!;
    expect(auth.status).toBe('degraded');
    expect(result.current.status).toBe('degraded');
  });

  it('marks Auth down when ALL 3 secrets are unconfigured', () => {
    useVersionMock.mockReturnValue({
      data: {
        version: 'x',
        service: {}, runtime: {},
        auth: { oauthClientSecretConfigured: false, jwtSecretConfigured: false, scimSharedSecretConfigured: false },
        storage: { databaseProvider: 'postgresql', persistenceBackend: 'prisma' },
      },
      isLoading: false, isError: false, error: null,
    });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const auth = result.current.subStatuses.find((s) => s.name === 'Auth')!;
    expect(auth.status).toBe('down');
  });

  it('Realtime substatus reflects ui-store sseConnectionState ("open" -> healthy)', () => {
    useUIStore.setState({ sseConnectionState: 'open' });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const realtime = result.current.subStatuses.find((s) => s.name === 'Realtime')!;
    expect(realtime.status).toBe('healthy');
  });

  it('Realtime substatus reflects ui-store sseConnectionState ("reconnecting" -> degraded)', () => {
    useUIStore.setState({ sseConnectionState: 'reconnecting' });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const realtime = result.current.subStatuses.find((s) => s.name === 'Realtime')!;
    expect(realtime.status).toBe('degraded');
  });

  it('Realtime substatus reflects ui-store sseConnectionState ("closed" -> down)', () => {
    useUIStore.setState({ sseConnectionState: 'closed' });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const realtime = result.current.subStatuses.find((s) => s.name === 'Realtime')!;
    expect(realtime.status).toBe('down');
  });

  it('Recent errors: 0 5xx in dashboard.recentActivity -> healthy', () => {
    useDashboardMock.mockReturnValue({
      data: {
        health: { status: 'ok', uptime: 1, dbType: 'pg' },
        stats: { totalEndpoints: 0, totalUsers: 0, totalGroups: 0 },
        endpoints: [],
        recentActivity: [
          { id: 'a', timestamp: '2026-05-12T20:00:00Z', method: 'POST', path: '/x', statusCode: 200, durationMs: 1, endpointId: 'e' },
          { id: 'b', timestamp: '2026-05-12T20:00:00Z', method: 'GET', path: '/y', statusCode: 404, durationMs: 1, endpointId: 'e' },
        ],
        requestsLast24hSeries: new Array(24).fill(0),
      },
      isLoading: false, isError: false, error: null,
    });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const errs = result.current.subStatuses.find((s) => s.name === 'Recent errors')!;
    expect(errs.status).toBe('healthy');
  });

  it('Recent errors: 1-5 5xx in recentActivity -> degraded', () => {
    useDashboardMock.mockReturnValue({
      data: {
        health: { status: 'ok', uptime: 1, dbType: 'pg' },
        stats: { totalEndpoints: 0, totalUsers: 0, totalGroups: 0 },
        endpoints: [],
        recentActivity: [
          { id: 'a', timestamp: '2026-05-12T20:00:00Z', method: 'POST', path: '/x', statusCode: 500, durationMs: 1, endpointId: 'e' },
          { id: 'b', timestamp: '2026-05-12T20:00:00Z', method: 'POST', path: '/y', statusCode: 502, durationMs: 1, endpointId: 'e' },
        ],
        requestsLast24hSeries: new Array(24).fill(0),
      },
      isLoading: false, isError: false, error: null,
    });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const errs = result.current.subStatuses.find((s) => s.name === 'Recent errors')!;
    expect(errs.status).toBe('degraded');
  });

  it('Recent errors: >5 5xx in recentActivity -> down', () => {
    const bursts = Array.from({ length: 7 }, (_, i) => ({
      id: `e${i}`, timestamp: '2026-05-12T20:00:00Z', method: 'POST', path: '/x',
      statusCode: 500, durationMs: 1, endpointId: 'e',
    }));
    useDashboardMock.mockReturnValue({
      data: {
        health: { status: 'ok', uptime: 1, dbType: 'pg' },
        stats: { totalEndpoints: 0, totalUsers: 0, totalGroups: 0 },
        endpoints: [],
        recentActivity: bursts,
        requestsLast24hSeries: new Array(24).fill(0),
      },
      isLoading: false, isError: false, error: null,
    });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    const errs = result.current.subStatuses.find((s) => s.name === 'Recent errors')!;
    expect(errs.status).toBe('down');
  });

  it('overall status follows the strictest substatus (down beats degraded beats healthy)', () => {
    // Auth missing 1 -> degraded
    useVersionMock.mockReturnValue({
      data: {
        version: 'x', service: {}, runtime: {},
        auth: { oauthClientSecretConfigured: false, jwtSecretConfigured: true, scimSharedSecretConfigured: true },
        storage: { databaseProvider: 'postgresql', persistenceBackend: 'prisma' },
      },
      isLoading: false, isError: false, error: null,
    });
    // SSE closed -> down (must dominate the auth-degraded)
    useUIStore.setState({ sseConnectionState: 'closed' });
    const { result } = renderHook(() => useHealthRollup(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('down');
  });
});
