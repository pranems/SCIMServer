/**
 * Egress policy - the tunable robustness knobs for SCIMServer's OUTBOUND calls
 * on the runtime auth hot path (today: the WIF JWKS fetch during a token mint).
 *
 * Two configuration levels, endpoint overrides server (per the operator's
 * requirement):
 *
 *   effective = endpoint-setting (if set)  ??  server-env default  ??  hardcoded default
 *
 * - SERVER level: env vars read via `resolveServerEgressDefaults` at service
 *   construction (`JWKS_FETCH_TIMEOUT_MS`, `JWKS_FETCH_RETRIES`,
 *   `JWKS_FETCH_RETRY_BACKOFF_MS`, `JWKS_CACHE_MAX_AGE_MS`).
 * - ENDPOINT level: numeric endpoint config keys read from `profile.settings`
 *   (`JwksFetchTimeoutMs`, `JwksFetchRetries`, `JwksFetchRetryBackoffMs`,
 *   `JwksCacheMaxAgeMs`) - see `resolveEndpointEgressOverrides` in
 *   endpoint-config.interface.ts. When a key is unset the field is `undefined`,
 *   so the merge falls through to the server default.
 *
 * The values are clamped to sane bounds so a bad config cannot, e.g., disable
 * the timeout or set an unbounded retry count.
 */

/** A fully-resolved egress policy (every field concrete). */
export interface EgressPolicy {
  /** Per-attempt outbound-fetch timeout (ms). Aborts a hung IdP. */
  timeoutMs: number;
  /** Number of RETRY attempts after the first (so total tries = retries + 1). */
  retries: number;
  /** Base backoff between retries (ms); grows exponentially + jitter. */
  retryBackoffMs: number;
  /** Max age of a cached JWKS before a refetch (ms). */
  cacheMaxAgeMs: number;
}

/** A partial policy (e.g. endpoint-level overrides); unset fields fall through. */
export type EgressPolicyOverrides = Partial<EgressPolicy>;

/** Hardcoded floor defaults when neither endpoint nor server config is present. */
export const EGRESS_POLICY_DEFAULTS: EgressPolicy = {
  timeoutMs: 5_000,
  retries: 2,
  retryBackoffMs: 200,
  cacheMaxAgeMs: 10 * 60 * 1000,
};

/** Inclusive clamp bounds - the same bounds the endpoint-config validator enforces. */
export const EGRESS_POLICY_BOUNDS = {
  timeoutMs: { min: 100, max: 60_000 },
  retries: { min: 0, max: 10 },
  retryBackoffMs: { min: 0, max: 10_000 },
  cacheMaxAgeMs: { min: 0, max: 24 * 60 * 60 * 1000 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Build the SERVER-level default policy from env (via a ConfigService-style
 * getter). Any unset/invalid env value falls back to {@link EGRESS_POLICY_DEFAULTS};
 * every value is clamped to {@link EGRESS_POLICY_BOUNDS}.
 */
export function resolveServerEgressDefaults(get: (key: string) => string | undefined): EgressPolicy {
  const timeoutMs = readNumber(get('JWKS_FETCH_TIMEOUT_MS')) ?? EGRESS_POLICY_DEFAULTS.timeoutMs;
  const retries = readNumber(get('JWKS_FETCH_RETRIES')) ?? EGRESS_POLICY_DEFAULTS.retries;
  const retryBackoffMs = readNumber(get('JWKS_FETCH_RETRY_BACKOFF_MS')) ?? EGRESS_POLICY_DEFAULTS.retryBackoffMs;
  // JWKS_CACHE_MAX_AGE_MS predates this module; keep honoring it as the server default.
  const cacheMaxAgeMs = readNumber(get('JWKS_CACHE_MAX_AGE_MS')) ?? EGRESS_POLICY_DEFAULTS.cacheMaxAgeMs;
  return {
    timeoutMs: clamp(timeoutMs, EGRESS_POLICY_BOUNDS.timeoutMs.min, EGRESS_POLICY_BOUNDS.timeoutMs.max),
    retries: clamp(Math.trunc(retries), EGRESS_POLICY_BOUNDS.retries.min, EGRESS_POLICY_BOUNDS.retries.max),
    retryBackoffMs: clamp(retryBackoffMs, EGRESS_POLICY_BOUNDS.retryBackoffMs.min, EGRESS_POLICY_BOUNDS.retryBackoffMs.max),
    cacheMaxAgeMs: clamp(cacheMaxAgeMs, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.min, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.max),
  };
}

/**
 * Merge endpoint-level overrides over the server-level defaults. An override
 * field is honored only when it is a finite number; it is clamped to the same
 * bounds. Endpoint wins over server (the operator's stated requirement).
 */
export function mergeEgressPolicy(server: EgressPolicy, overrides?: EgressPolicyOverrides): EgressPolicy {
  if (!overrides) return { ...server };
  const pick = (o: number | undefined, s: number, min: number, max: number, truncate = false): number => {
    if (typeof o !== 'number' || !Number.isFinite(o)) return s;
    return clamp(truncate ? Math.trunc(o) : o, min, max);
  };
  return {
    timeoutMs: pick(overrides.timeoutMs, server.timeoutMs, EGRESS_POLICY_BOUNDS.timeoutMs.min, EGRESS_POLICY_BOUNDS.timeoutMs.max),
    retries: pick(overrides.retries, server.retries, EGRESS_POLICY_BOUNDS.retries.min, EGRESS_POLICY_BOUNDS.retries.max, true),
    retryBackoffMs: pick(overrides.retryBackoffMs, server.retryBackoffMs, EGRESS_POLICY_BOUNDS.retryBackoffMs.min, EGRESS_POLICY_BOUNDS.retryBackoffMs.max),
    cacheMaxAgeMs: pick(overrides.cacheMaxAgeMs, server.cacheMaxAgeMs, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.min, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.max),
  };
}
