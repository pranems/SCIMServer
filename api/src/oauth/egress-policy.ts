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
  /**
   * W1.5 - total wall-clock budget for the WHOLE fetch operation: every
   * attempt, every backoff sleep, and every redirect hop combined.
   *
   * `timeoutMs` bounds one attempt, which is not a bound on the operation:
   * with `retries: 5` and a 200 ms base backoff the ladder alone sleeps 6.2 s
   * before the last attempt even starts. This is the number that actually caps
   * the token-mint hot path.
   */
  totalDeadlineMs: number;
  /** W1.5 - reject a JWKS response body larger than this (bytes). */
  maxResponseBytes: number;
  /** W1.5 - reject a key set containing more than this many keys. */
  maxKeys: number;
  /** W1.5 - cardinality cap on the JWKS cache; oldest entry is evicted past it. */
  maxCacheEntries: number;
  /**
   * W1.4 - how old a cached entry may get before the BACKGROUND sweep refreshes
   * it. Set below `cacheMaxAgeMs` so the refresh lands while the entry is still
   * fresh, which is what keeps the steady-state hot path a cache hit: before
   * W1.4 every TTL expiry put a synchronous outbound fetch on a user's token
   * mint. Microsoft's published guidance for its signing keys is a 24 h cache
   * with a ~1 h background refresh.
   */
  refreshIntervalMs: number;
  /**
   * W1.4 - minimum interval between SYNCHRONOUS refetches triggered by an
   * unknown `kid`. An unknown kid must still be able to pull a rotated key
   * promptly, but without a floor the caller controls our outbound request rate
   * for free: every request bearing an unrecognised kid forces a fetch, which
   * is an amplification vector against the IdP.
   */
  unknownKidMinIntervalMs: number;
  /**
   * W1.4 - HARD ceiling on the age of a cached key set that may be served when
   * a refetch fails (fail-to-stale). Before W1.4 that path had no age test at
   * all, so a revoked key stayed acceptable for as long as the IdP was
   * unreachable. This bounds the exposure while keeping the availability
   * property for real outages.
   */
  staleIfErrorMs: number;
}

/** A partial policy (e.g. endpoint-level overrides); unset fields fall through. */
export type EgressPolicyOverrides = Partial<EgressPolicy>;

/** Hardcoded floor defaults when neither endpoint nor server config is present. */
export const EGRESS_POLICY_DEFAULTS: EgressPolicy = {
  timeoutMs: 5_000,
  retries: 2,
  retryBackoffMs: 200,
  cacheMaxAgeMs: 24 * 60 * 60 * 1000,
  totalDeadlineMs: 10_000,
  maxResponseBytes: 1_048_576,
  // Deliberately generous: Microsoft states a signing-key cache should hold
  // 10-1000 keys across issuers, so a tight cap (e.g. 10) would reject a
  // legitimate multi-issuer key set.
  maxKeys: 100,
  maxCacheEntries: 50,
  // W1.4 - Entra-aligned refresh cadence. 24 h TTL + 1 h background refresh is
  // Microsoft's own published algorithm for its signing keys.
  refreshIntervalMs: 60 * 60 * 1000,
  unknownKidMinIntervalMs: 5 * 60 * 1000,
  // 48 h = the 24 h TTL plus another day of outage tolerance. Long enough that
  // a real IdP outage never causes an auth outage; short enough that a revoked
  // key does not stay acceptable indefinitely.
  staleIfErrorMs: 48 * 60 * 60 * 1000,
};

/** Inclusive clamp bounds - the same bounds the endpoint-config validator enforces. */
export const EGRESS_POLICY_BOUNDS = {
  timeoutMs: { min: 100, max: 60_000 },
  retries: { min: 0, max: 10 },
  retryBackoffMs: { min: 0, max: 10_000 },
  cacheMaxAgeMs: { min: 0, max: 24 * 60 * 60 * 1000 },
  totalDeadlineMs: { min: 100, max: 120_000 },
  maxResponseBytes: { min: 1_024, max: 10_485_760 },
  maxKeys: { min: 1, max: 1_000 },
  maxCacheEntries: { min: 1, max: 1_000 },
  // W1.4. The refresh floor is 60 s so a misconfiguration cannot turn the
  // background sweep into a hot loop against the IdP.
  refreshIntervalMs: { min: 60_000, max: 24 * 60 * 60 * 1000 },
  // 0 is permitted: it disables the rate limit (every unknown kid may refetch),
  // which is the pre-W1.4 behaviour and is occasionally wanted in a lab.
  unknownKidMinIntervalMs: { min: 0, max: 60 * 60 * 1000 },
  // 0 is permitted: it disables fail-to-stale entirely (strictest posture -
  // any failed refetch fails closed).
  staleIfErrorMs: { min: 0, max: 7 * 24 * 60 * 60 * 1000 },
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
  // W1.5 caps.
  const totalDeadlineMs = readNumber(get('JWKS_TOTAL_DEADLINE_MS')) ?? EGRESS_POLICY_DEFAULTS.totalDeadlineMs;
  const maxResponseBytes = readNumber(get('JWKS_MAX_RESPONSE_BYTES')) ?? EGRESS_POLICY_DEFAULTS.maxResponseBytes;
  const maxKeys = readNumber(get('JWKS_MAX_KEYS')) ?? EGRESS_POLICY_DEFAULTS.maxKeys;
  const maxCacheEntries = readNumber(get('JWKS_MAX_CACHE_ENTRIES')) ?? EGRESS_POLICY_DEFAULTS.maxCacheEntries;
  // W1.4 cache cadence.
  const refreshIntervalMs = readNumber(get('JWKS_REFRESH_INTERVAL_MS')) ?? EGRESS_POLICY_DEFAULTS.refreshIntervalMs;
  const unknownKidMinIntervalMs =
    readNumber(get('JWKS_UNKNOWN_KID_MIN_INTERVAL_MS')) ?? EGRESS_POLICY_DEFAULTS.unknownKidMinIntervalMs;
  const staleIfErrorMs = readNumber(get('JWKS_STALE_IF_ERROR_MS')) ?? EGRESS_POLICY_DEFAULTS.staleIfErrorMs;
  return {
    timeoutMs: clamp(timeoutMs, EGRESS_POLICY_BOUNDS.timeoutMs.min, EGRESS_POLICY_BOUNDS.timeoutMs.max),
    retries: clamp(Math.trunc(retries), EGRESS_POLICY_BOUNDS.retries.min, EGRESS_POLICY_BOUNDS.retries.max),
    retryBackoffMs: clamp(retryBackoffMs, EGRESS_POLICY_BOUNDS.retryBackoffMs.min, EGRESS_POLICY_BOUNDS.retryBackoffMs.max),
    cacheMaxAgeMs: clamp(cacheMaxAgeMs, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.min, EGRESS_POLICY_BOUNDS.cacheMaxAgeMs.max),
    totalDeadlineMs: clamp(totalDeadlineMs, EGRESS_POLICY_BOUNDS.totalDeadlineMs.min, EGRESS_POLICY_BOUNDS.totalDeadlineMs.max),
    maxResponseBytes: clamp(Math.trunc(maxResponseBytes), EGRESS_POLICY_BOUNDS.maxResponseBytes.min, EGRESS_POLICY_BOUNDS.maxResponseBytes.max),
    maxKeys: clamp(Math.trunc(maxKeys), EGRESS_POLICY_BOUNDS.maxKeys.min, EGRESS_POLICY_BOUNDS.maxKeys.max),
    maxCacheEntries: clamp(Math.trunc(maxCacheEntries), EGRESS_POLICY_BOUNDS.maxCacheEntries.min, EGRESS_POLICY_BOUNDS.maxCacheEntries.max),
    refreshIntervalMs: clamp(refreshIntervalMs, EGRESS_POLICY_BOUNDS.refreshIntervalMs.min, EGRESS_POLICY_BOUNDS.refreshIntervalMs.max),
    unknownKidMinIntervalMs: clamp(unknownKidMinIntervalMs, EGRESS_POLICY_BOUNDS.unknownKidMinIntervalMs.min, EGRESS_POLICY_BOUNDS.unknownKidMinIntervalMs.max),
    staleIfErrorMs: clamp(staleIfErrorMs, EGRESS_POLICY_BOUNDS.staleIfErrorMs.min, EGRESS_POLICY_BOUNDS.staleIfErrorMs.max),
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
    totalDeadlineMs: pick(overrides.totalDeadlineMs, server.totalDeadlineMs, EGRESS_POLICY_BOUNDS.totalDeadlineMs.min, EGRESS_POLICY_BOUNDS.totalDeadlineMs.max),
    maxResponseBytes: pick(overrides.maxResponseBytes, server.maxResponseBytes, EGRESS_POLICY_BOUNDS.maxResponseBytes.min, EGRESS_POLICY_BOUNDS.maxResponseBytes.max, true),
    maxKeys: pick(overrides.maxKeys, server.maxKeys, EGRESS_POLICY_BOUNDS.maxKeys.min, EGRESS_POLICY_BOUNDS.maxKeys.max, true),
    maxCacheEntries: pick(overrides.maxCacheEntries, server.maxCacheEntries, EGRESS_POLICY_BOUNDS.maxCacheEntries.min, EGRESS_POLICY_BOUNDS.maxCacheEntries.max, true),
    refreshIntervalMs: pick(overrides.refreshIntervalMs, server.refreshIntervalMs, EGRESS_POLICY_BOUNDS.refreshIntervalMs.min, EGRESS_POLICY_BOUNDS.refreshIntervalMs.max),
    unknownKidMinIntervalMs: pick(overrides.unknownKidMinIntervalMs, server.unknownKidMinIntervalMs, EGRESS_POLICY_BOUNDS.unknownKidMinIntervalMs.min, EGRESS_POLICY_BOUNDS.unknownKidMinIntervalMs.max),
    staleIfErrorMs: pick(overrides.staleIfErrorMs, server.staleIfErrorMs, EGRESS_POLICY_BOUNDS.staleIfErrorMs.min, EGRESS_POLICY_BOUNDS.staleIfErrorMs.max),
  };
}
