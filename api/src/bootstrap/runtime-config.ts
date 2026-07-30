/**
 * Runtime configuration - the environment-dependent perf/resilience knobs.
 *
 * WHY THIS EXISTS (X15, docs/perf/RUNTIME_TUNING_AND_CONFIGURATION_REFERENCE.md)
 * -----------------------------------------------------------------------------
 * Every timeout, pool size, buffer and cap in this server is a function of the
 * environment it runs in: container CPU share, database tier, replica count, the
 * network path to the IdP. X11 proved it by measuring the SAME WIF mint at
 * 2,161 ms and at 92 ms. Values that were hardcoded literals could not move with
 * the deployment, and two of them were outright defects:
 *
 *   X15-F2  `REQUEST_TIMEOUT_MS` was applied to `setTimeout()` (socket
 *           inactivity) and `keepAliveTimeout`, while `server.requestTimeout`
 *           and `server.headersTimeout` were NEVER set - so request duration was
 *           actually bounded by Node's implicit 300 s, not by the 120 s the
 *           operator thought they had configured.
 *   X15-F3  The Prisma v6 -> v7 driver-adapter migration silently dropped the
 *           pool acquire timeout (`pg` defaults `connectionTimeoutMillis: 0`,
 *           i.e. wait forever), because the pool was constructed with only
 *           `max` passed.
 *
 * DESIGN
 * ------
 * This module deliberately mirrors the shape of `oauth/egress-policy.ts`, which
 * is the repo's reference implementation of a clamped setting. No new pattern is
 * introduced. Three properties are load-bearing:
 *
 *  1. FALL THROUGH ON INVALID, NEVER THROW. A typo in an env var degrades to the
 *     documented default instead of failing startup.
 *  2. CLAMP EVERY VALUE to a published range, so no configuration path can
 *     disable a bound (an unbounded knob is a denial-of-service vector).
 *  3. RECORD PROVENANCE. Every setting carries where it came from and whether it
 *     was clamped, so `formatRuntimeConfigLines` can print what actually took
 *     effect. A configurable system without that is strictly harder to operate
 *     than a hardcoded one.
 *
 * Cross-key invariants (e.g. the DB transaction timeout must sit inside the HTTP
 * request timeout) produce WARNINGS, never a startup failure: a server that
 * refuses to boot on a tuning mistake is worse than one that boots and says so.
 */

/** Where an effective value came from. */
export type SettingSource = 'env' | 'legacy-env' | 'default';

/** A fully-resolved setting plus the provenance an operator needs to debug it. */
export interface ResolvedSetting<T extends number | string = number | string> {
  effective: T;
  source: SettingSource;
  /** The raw value that was requested, present only when it had to be clamped. */
  requested?: number;
  default: T;
  min?: number;
  max?: number;
  clamped: boolean;
}

interface NumberSpec {
  kind: 'number';
  env: string;
  /** A pre-existing env var kept working for backward compatibility. */
  legacyEnv?: string;
  default: number;
  min: number;
  max: number;
  integer?: boolean;
}

interface SizeSpec {
  kind: 'size';
  env: string;
  default: string;
}

type Spec = NumberSpec | SizeSpec;

/**
 * The bounds contract. Every knob is published here with its default and its
 * clamp range, so the table doubles as the documentation.
 */
export const RUNTIME_CONFIG_SPECS = {
  http: {
    // The value that actually bounds a request end-to-end (X15-F2).
    requestTimeoutMs: {
      kind: 'number',
      env: 'HTTP_REQUEST_TIMEOUT_MS',
      legacyEnv: 'REQUEST_TIMEOUT_MS',
      default: 120_000,
      min: 1_000,
      max: 600_000,
    },
    // Node's own default is 60 s; set explicitly so it is visible and cannot drift.
    headersTimeoutMs: {
      kind: 'number',
      env: 'HTTP_HEADERS_TIMEOUT_MS',
      default: 60_000,
      min: 1_000,
      max: 600_000,
    },
    // Must EXCEED the upstream ingress idle timeout, or the proxy reuses a socket
    // the server is closing and the client sees a 502 / ECONNRESET.
    keepAliveTimeoutMs: {
      kind: 'number',
      env: 'HTTP_KEEPALIVE_TIMEOUT_MS',
      legacyEnv: 'REQUEST_TIMEOUT_MS',
      default: 65_000,
      min: 1_000,
      max: 600_000,
    },
    keepAliveTimeoutBufferMs: {
      kind: 'number',
      env: 'HTTP_KEEPALIVE_TIMEOUT_BUFFER_MS',
      default: 1_000,
      min: 0,
      max: 10_000,
    },
    jsonBodyLimit: { kind: 'size', env: 'HTTP_JSON_BODY_LIMIT', default: '5mb' },
    formBodyLimit: { kind: 'size', env: 'HTTP_FORM_BODY_LIMIT', default: '1mb' },
  },
  database: {
    // A GLOBAL budget: poolMax * maxReplicas must stay under the server's
    // max_connections. Re-derive when the replica ceiling or DB tier changes.
    poolMax: { kind: 'number', env: 'DB_POOL_MAX', default: 5, min: 1, max: 100, integer: true },
    // Restores the bound Prisma v6 had as `pool_timeout` (X15-F3).
    poolAcquireTimeoutMs: {
      kind: 'number',
      env: 'DB_POOL_ACQUIRE_TIMEOUT_MS',
      default: 10_000,
      min: 100,
      max: 120_000,
    },
    poolIdleTimeoutMs: {
      kind: 'number',
      env: 'DB_POOL_IDLE_TIMEOUT_MS',
      default: 10_000,
      min: 1_000,
      max: 600_000,
    },
    txMaxWaitMs: { kind: 'number', env: 'DB_TX_MAX_WAIT_MS', default: 10_000, min: 100, max: 120_000 },
    txTimeoutMs: { kind: 'number', env: 'DB_TX_TIMEOUT_MS', default: 30_000, min: 1_000, max: 300_000 },
  },
  logging: {
    flushIntervalMs: {
      kind: 'number',
      env: 'LOG_FLUSH_INTERVAL_MS',
      default: 3_000,
      min: 100,
      max: 60_000,
    },
    flushMaxBuffer: {
      kind: 'number',
      env: 'LOG_FLUSH_MAX_BUFFER',
      default: 50,
      min: 1,
      max: 10_000,
      integer: true,
    },
  },
  scim: {
    defaultCount: { kind: 'number', env: 'SCIM_DEFAULT_COUNT', default: 100, min: 1, max: 1_000, integer: true },
    maxCount: { kind: 'number', env: 'SCIM_MAX_COUNT', default: 200, min: 1, max: 1_000, integer: true },
  },
} as const satisfies Record<string, Record<string, Spec>>;

export type RuntimeConfigGroup = keyof typeof RUNTIME_CONFIG_SPECS;

export interface RuntimeConfig {
  groups: Record<RuntimeConfigGroup, Record<string, ResolvedSetting>>;
  /** Cross-key invariant violations. Advisory only - never fatal. */
  warnings: string[];
}

/** An env getter, injected so this module stays pure and testable. */
export type EnvGetter = (key: string) => string | undefined;

function readRaw(get: EnvGetter, key: string | undefined): string | undefined {
  if (!key) return undefined;
  const raw = get(key);
  if (raw === undefined || raw === null || String(raw).trim() === '') return undefined;
  return String(raw);
}

/** A byte-size limit as body-parser accepts it, e.g. `5mb`, `256kb`, `1048576`. */
const SIZE_PATTERN = /^\d+(\.\d+)?\s*(b|kb|mb|gb)?$/i;

function resolveNumber(get: EnvGetter, spec: NumberSpec): ResolvedSetting<number> {
  let source: SettingSource = 'default';
  let raw = readRaw(get, spec.env);
  if (raw !== undefined) source = 'env';
  else {
    raw = readRaw(get, spec.legacyEnv);
    if (raw !== undefined) source = 'legacy-env';
  }

  const base: ResolvedSetting<number> = {
    effective: spec.default,
    source: 'default',
    default: spec.default,
    min: spec.min,
    max: spec.max,
    clamped: false,
  };
  if (raw === undefined) return base;

  const parsed = Number(raw);
  // A non-numeric value is a typo, not an instruction. Degrade to the default.
  if (!Number.isFinite(parsed)) return base;

  const truncated = spec.integer ? Math.trunc(parsed) : parsed;
  const clampedValue = Math.min(Math.max(truncated, spec.min), spec.max);
  const wasClamped = clampedValue !== truncated;

  return {
    effective: clampedValue,
    source,
    default: spec.default,
    min: spec.min,
    max: spec.max,
    clamped: wasClamped,
    ...(wasClamped ? { requested: truncated } : {}),
  };
}

function resolveSize(get: EnvGetter, spec: SizeSpec): ResolvedSetting<string> {
  const raw = readRaw(get, spec.env);
  const fallback: ResolvedSetting<string> = {
    effective: spec.default,
    source: 'default',
    default: spec.default,
    clamped: false,
  };
  if (raw === undefined) return fallback;
  // A malformed limit would make body-parser throw at request time, which is a
  // far worse failure than quietly using the documented default.
  if (!SIZE_PATTERN.test(raw.trim())) return fallback;
  return { effective: raw.trim(), source: 'env', default: spec.default, clamped: false };
}

/**
 * Cross-key invariants. Each returns a human-readable warning naming BOTH env
 * vars, because the fix always involves choosing between them.
 */
function collectWarnings(groups: RuntimeConfig['groups']): string[] {
  const warnings: string[] = [];
  const n = (group: RuntimeConfigGroup, key: string): number => groups[group][key].effective as number;

  if (n('database', 'txTimeoutMs') >= n('http', 'requestTimeoutMs')) {
    warnings.push(
      `DB_TX_TIMEOUT_MS (${n('database', 'txTimeoutMs')}ms) is not shorter than HTTP_REQUEST_TIMEOUT_MS ` +
        `(${n('http', 'requestTimeoutMs')}ms) - the request will be aborted before the transaction can finish.`,
    );
  }
  if (n('database', 'poolAcquireTimeoutMs') >= n('http', 'requestTimeoutMs')) {
    warnings.push(
      `DB_POOL_ACQUIRE_TIMEOUT_MS (${n('database', 'poolAcquireTimeoutMs')}ms) is not shorter than ` +
        `HTTP_REQUEST_TIMEOUT_MS (${n('http', 'requestTimeoutMs')}ms) - a pool wait can outlive the request.`,
    );
  }
  if (n('scim', 'defaultCount') > n('scim', 'maxCount')) {
    warnings.push(
      `SCIM_DEFAULT_COUNT (${n('scim', 'defaultCount')}) exceeds SCIM_MAX_COUNT (${n('scim', 'maxCount')}) - ` +
        `every unqualified list request would be clamped down immediately.`,
    );
  }
  if (n('http', 'keepAliveTimeoutBufferMs') >= n('http', 'keepAliveTimeoutMs')) {
    warnings.push(
      `HTTP_KEEPALIVE_TIMEOUT_BUFFER_MS (${n('http', 'keepAliveTimeoutBufferMs')}ms) is not smaller than ` +
        `HTTP_KEEPALIVE_TIMEOUT_MS (${n('http', 'keepAliveTimeoutMs')}ms) - keep-alive would be effectively disabled.`,
    );
  }
  return warnings;
}

/**
 * Resolve every runtime setting from the supplied environment.
 * Pure: no `process.env` access, no side effects, never throws.
 */
export function resolveRuntimeConfig(get: EnvGetter): RuntimeConfig {
  const groups = {} as RuntimeConfig['groups'];
  for (const [groupName, specs] of Object.entries(RUNTIME_CONFIG_SPECS)) {
    const resolved: Record<string, ResolvedSetting> = {};
    for (const [key, spec] of Object.entries(specs as Record<string, Spec>)) {
      resolved[key] = spec.kind === 'size' ? resolveSize(get, spec) : resolveNumber(get, spec);
    }
    groups[groupName as RuntimeConfigGroup] = resolved;
  }
  return { groups, warnings: collectWarnings(groups) };
}

/** Convenience accessor for call sites that only want the numbers. */
export function effectiveNumber(config: RuntimeConfig, group: RuntimeConfigGroup, key: string): number {
  return config.groups[group][key].effective as number;
}

/** Convenience accessor for the string-valued settings. */
export function effectiveString(config: RuntimeConfig, group: RuntimeConfigGroup, key: string): string {
  return config.groups[group][key].effective as string;
}

/**
 * One log line per group naming every effective value and where it came from.
 * This is the surface that turns a support conversation from "what do you have
 * set?" into a fact.
 */
export function formatRuntimeConfigLines(config: RuntimeConfig): string[] {
  return (Object.keys(config.groups) as RuntimeConfigGroup[]).map((group) => {
    const parts = Object.entries(config.groups[group]).map(([key, s]) => {
      const provenance = s.clamped ? `clamped from ${s.requested}, ${s.source}` : s.source;
      return `${key}=${s.effective}(${provenance})`;
    });
    return `[Config] ${group.padEnd(8)} ${parts.join(' ')}`;
  });
}
