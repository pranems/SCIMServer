/**
 * Structured Log Levels — follows RFC 5424 / OpenTelemetry severity conventions.
 *
 * Levels (ascending severity):
 *   TRACE → DEBUG → INFO → WARN → ERROR → FATAL → OFF
 *
 * Use cases:
 *   TRACE  — Byte-level detail: full request/response bodies, SQL, patch path resolution steps.
 *   DEBUG  — Operational detail useful during development: filter parsing, member resolution, config reads.
 *   INFO   — Significant business events: user created, group patched, endpoint activated.
 *   WARN   — Recoverable anomalies: deprecated header, slow query, backup retry.
 *   ERROR  — Failed operations requiring attention: auth failure, uniqueness violation, DB error.
 *   FATAL  — Unrecoverable: DB connection lost, secret not configured.
 *   OFF    — Suppress all log output.
 */

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
  OFF = 6,
}

/** String → enum mapping (case-insensitive). */
export function parseLogLevel(value: string | undefined): LogLevel {
  if (!value) return LogLevel.INFO;
  const upper = value.toUpperCase().trim();
  // Look up named key; typeof check avoids numeric enum reverse-mapping ('0' → 'TRACE')
  const mapped = LogLevel[upper as keyof typeof LogLevel];
  if (typeof mapped === 'number') return mapped;
  // Numeric fallback
  const num = Number(upper);
  if (!isNaN(num) && num >= (LogLevel.TRACE as number) && num <= (LogLevel.OFF as number)) return num;
  return LogLevel.INFO;
}

export function logLevelName(level: LogLevel): string {
  return LogLevel[level] ?? 'UNKNOWN';
}

/**
 * Log categories allow filtering by subsystem.
 * Each category maps to a functional area of the server.
 */
export enum LogCategory {
  /** HTTP request/response lifecycle */
  HTTP = 'http',
  /** Authentication & authorization */
  AUTH = 'auth',
  /** SCIM User operations */
  SCIM_USER = 'scim.user',
  /** SCIM Group operations */
  SCIM_GROUP = 'scim.group',
  /** SCIM PATCH operations (detailed) */
  SCIM_PATCH = 'scim.patch',
  /** SCIM filter parsing & evaluation */
  SCIM_FILTER = 'scim.filter',
  /** SCIM discovery endpoints */
  SCIM_DISCOVERY = 'scim.discovery',
  /** Endpoint management */
  ENDPOINT = 'endpoint',
  /** Database / Prisma operations */
  DATABASE = 'database',
  /** Backup & restore */
  BACKUP = 'backup',
  /** OAuth token operations */
  OAUTH = 'oauth',
  /** General / uncategorized */
  GENERAL = 'general',
}

/**
 * Runtime-configurable log configuration.
 * Supports global level + per-category and per-endpoint overrides.
 */
export interface LogConfig {
  /** Global minimum log level (default: INFO, can be overridden by LOG_LEVEL env var). */
  globalLevel: LogLevel;

  /**
   * Per-category level overrides.
   * Example: { 'scim.patch': LogLevel.TRACE, 'auth': LogLevel.WARN }
   */
  categoryLevels: Partial<Record<LogCategory, LogLevel>>;

  /**
   * Per-endpoint level overrides. Key = endpointId.
   * Example: { 'ep-123': LogLevel.DEBUG }
   * When set, all logs for requests hitting that endpoint use at most this level.
   */
  endpointLevels: Record<string, LogLevel>;

  /** Include full request/response bodies in TRACE/DEBUG output (default: true in dev, false in prod). */
  includePayloads: boolean;

  /** Include stack traces in ERROR/FATAL output (default: true). */
  includeStackTraces: boolean;

  /** Maximum payload size to log in bytes (default: 8KB). Bodies larger are truncated. */
  maxPayloadSizeBytes: number;

  /** Output format: 'json' for structured (production), 'pretty' for human-readable (dev). */
  format: 'json' | 'pretty';
}

/** Build default log configuration from environment variables. */
export function buildDefaultLogConfig(): LogConfig {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    globalLevel: parseLogLevel(process.env.LOG_LEVEL),
    categoryLevels: parseCategoryLevels(process.env.LOG_CATEGORY_LEVELS),
    endpointLevels: {},
    includePayloads: process.env.LOG_INCLUDE_PAYLOADS === 'true' || (!isProd && process.env.LOG_INCLUDE_PAYLOADS !== 'false'),
    includeStackTraces: process.env.LOG_INCLUDE_STACKS !== 'false',
    maxPayloadSizeBytes: Number(process.env.LOG_MAX_PAYLOAD_SIZE) || 8192,
    format: isProd ? 'json' : ((process.env.LOG_FORMAT as 'json' | 'pretty') || 'pretty'),
  };
}

/**
 * Parse LOG_CATEGORY_LEVELS env var.
 * Format: "scim.patch=TRACE,auth=WARN,http=DEBUG"
 */
function parseCategoryLevels(raw: string | undefined): Partial<Record<LogCategory, LogLevel>> {
  if (!raw) return {};
  const result: Partial<Record<LogCategory, LogLevel>> = {};
  for (const pair of raw.split(',')) {
    const [cat, level] = pair.trim().split('=');
    if (cat && level) {
      const category = cat.trim() as LogCategory;
      if (Object.values(LogCategory).includes(category)) {
        result[category] = parseLogLevel(level.trim());
      }
    }
  }
  return result;
}
