/**
 * useHealthRollup - Phase K2 service-health rollup hook.
 *
 * Aggregates four real signals already produced by the API into a
 * single traffic-light + 5-substatus surface for the <HealthRollup />
 * header widget:
 *   1. /scim/health           -> API liveness
 *   2. /scim/admin/version    -> Database backend + auth-config flags
 *   3. /scim/admin/dashboard  -> Recent-error rate (5xx in last 10
 *      activity rows; the BFF caps recentActivity at the last ~10
 *      so this is implicitly the "recent" window the operator cares
 *      about most for at-a-glance triage).
 *   4. ui-store.sseConnectionState (written by useSSE) -> Realtime
 *      EventSource lifecycle.
 *
 * Why frontend-only: every signal above is already exposed by the
 * existing API. Adding a new "/admin/health/detailed" BFF route is
 * a Phase L-class concern (own deep-health probes, own DTO, own
 * test-pyramid sweep). K2 ships the visibility today using what
 * already exists; the deeper backend probe can land later without
 * changing the widget contract.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S6.10
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import { useDashboard, useHealth, useVersion } from '../api/queries';
import { useUIStore } from '../store/ui-store';

/** Overall traffic-light value. */
export type HealthRollupStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** Substatus value (no 'unknown' - per-substatus we always have a definite signal). */
export type HealthSubStatusValue = 'healthy' | 'degraded' | 'down';

/** Stable name set; the order in `useHealthRollup().subStatuses` mirrors this. */
export type HealthSubStatusName =
  | 'API'
  | 'Database'
  | 'Auth'
  | 'Realtime'
  | 'Recent errors';

export interface HealthSubStatus {
  name: HealthSubStatusName;
  status: HealthSubStatusValue;
  /** One-line operator-readable explanation. */
  detail: string;
}

export interface HealthRollupResult {
  status: HealthRollupStatus;
  subStatuses: HealthSubStatus[];
}

/**
 * Pure reducer: collapse a list of substatuses into the strictest
 * overall value. Exported so the test suite can lock the behavior
 * without instantiating the full hook + queries.
 *
 *   any 'down'      -> 'down'
 *   else any 'degraded' -> 'degraded'
 *   else (all healthy)  -> 'healthy'
 *   empty list      -> 'unknown' (defensive)
 */
export function rollupOverallStatus(
  subs: ReadonlyArray<HealthSubStatus>,
): HealthRollupStatus {
  if (subs.length === 0) return 'unknown';
  if (subs.some((s) => s.status === 'down')) return 'down';
  if (subs.some((s) => s.status === 'degraded')) return 'degraded';
  return 'healthy';
}

/** Threshold tunables - kept module-private so the test asserts behavior, not values. */
const RECENT_ERRORS_DEGRADED_THRESHOLD = 1;
const RECENT_ERRORS_DOWN_THRESHOLD = 6;

/** Hook entry point. */
export function useHealthRollup(): HealthRollupResult {
  const health = useHealth();
  const version = useVersion();
  const dashboard = useDashboard();
  const sseState = useUIStore((s) => s.sseConnectionState);

  // ── 1. API liveness ─────────────────────────────────────────────
  const apiSub: HealthSubStatus = (() => {
    if (health.isError) {
      return { name: 'API', status: 'down', detail: 'Liveness probe failed' };
    }
    if (health.data?.status === 'ok') {
      return { name: 'API', status: 'healthy', detail: `OK (uptime ${health.data.uptime ?? 0}s)` };
    }
    if (health.data) {
      return { name: 'API', status: 'down', detail: `Reported '${health.data.status}'` };
    }
    return { name: 'API', status: 'degraded', detail: 'Awaiting first probe...' };
  })();

  // ── 2. Database (read from version.storage block) ───────────────
  const dbSub: HealthSubStatus = (() => {
    if (version.isError) {
      return { name: 'Database', status: 'down', detail: 'Cannot read version metadata' };
    }
    const provider = version.data?.storage?.databaseProvider;
    const backend = version.data?.storage?.persistenceBackend;
    if (!provider) {
      return { name: 'Database', status: 'degraded', detail: 'Provider unknown' };
    }
    return {
      name: 'Database',
      status: 'healthy',
      detail: backend ? `${provider} (${backend})` : provider,
    };
  })();

  // ── 3. Auth configuration ───────────────────────────────────────
  const authSub: HealthSubStatus = (() => {
    if (version.isError) {
      return { name: 'Auth', status: 'down', detail: 'Cannot read auth config' };
    }
    const auth = version.data?.auth;
    if (!auth) {
      return { name: 'Auth', status: 'degraded', detail: 'Auth metadata missing' };
    }
    const flags = [
      auth.oauthClientSecretConfigured,
      auth.jwtSecretConfigured,
      auth.scimSharedSecretConfigured,
    ];
    const configured = flags.filter(Boolean).length;
    if (configured === 3) {
      return { name: 'Auth', status: 'healthy', detail: 'All 3 secrets configured' };
    }
    if (configured === 0) {
      return { name: 'Auth', status: 'down', detail: 'No auth secrets configured' };
    }
    return {
      name: 'Auth',
      status: 'degraded',
      detail: `${3 - configured} of 3 secrets missing`,
    };
  })();

  // ── 4. Realtime SSE ─────────────────────────────────────────────
  const realtimeSub: HealthSubStatus = (() => {
    switch (sseState) {
      case 'open':
        return { name: 'Realtime', status: 'healthy', detail: 'SSE open' };
      case 'connecting':
      case 'reconnecting':
        return { name: 'Realtime', status: 'degraded', detail: `SSE ${sseState}` };
      case 'closed':
        return { name: 'Realtime', status: 'down', detail: 'SSE closed' };
    }
  })();

  // ── 5. Recent 5xx error rate ────────────────────────────────────
  const errorsSub: HealthSubStatus = (() => {
    if (dashboard.isError) {
      return { name: 'Recent errors', status: 'down', detail: 'Cannot read activity feed' };
    }
    const recent = dashboard.data?.recentActivity ?? [];
    const fiveXx = recent.filter((row) => typeof row.statusCode === 'number' && row.statusCode >= 500).length;
    if (fiveXx === 0) {
      return { name: 'Recent errors', status: 'healthy', detail: '0 in recent activity' };
    }
    if (fiveXx >= RECENT_ERRORS_DOWN_THRESHOLD) {
      return { name: 'Recent errors', status: 'down', detail: `${fiveXx} in recent activity` };
    }
    if (fiveXx >= RECENT_ERRORS_DEGRADED_THRESHOLD) {
      return { name: 'Recent errors', status: 'degraded', detail: `${fiveXx} in recent activity` };
    }
    return { name: 'Recent errors', status: 'healthy', detail: '0 in recent activity' };
  })();

  // Stable order matching HealthSubStatusName.
  const subStatuses: HealthSubStatus[] = [apiSub, dbSub, authSub, realtimeSub, errorsSub];
  return {
    status: rollupOverallStatus(subStatuses),
    subStatuses,
  };
}
