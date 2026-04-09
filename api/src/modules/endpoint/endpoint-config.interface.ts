/**
 * Endpoint Configuration Flag Constants
 *
 * Central location for all endpoint config flag string constants.
 * Use these constants throughout the codebase to avoid typos and enable easy refactoring.
 *
 * For default values and full metadata see {@link ENDPOINT_CONFIG_FLAGS_DEFINITIONS}.
 */
export const ENDPOINT_CONFIG_FLAGS = {
  /**
   * When true, allows removing all members from a group via path=members without value array.
   * When false (default), requires explicit member specification in value array or path filter.
   * In practice: most SCIM clients send explicit member values; set true only if your client
   * sends bare `remove` on `members` without a value array.
   */
  PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS: 'PatchOpAllowRemoveAllMembers',

  /**
   * When true, enables verbose PATCH support with dot-notation path resolution.
   * Paths like "name.givenName" are resolved into nested objects instead of flat keys.
   * When false (default), dot-notation paths are stored as literal top-level keys.
   * In practice: enable for RFC-compliant clients; disable for Entra ID which sends flat keys.
   */
  VERBOSE_PATCH_SUPPORTED: 'VerbosePatchSupported',

  /**
   * Per-endpoint log level override. Accepts log level name ("TRACE", "DEBUG", "INFO", etc.)
   * or numeric level (0-6). When set, the ScimLogger will use this level for requests
   * to the endpoint instead of the global/category levels.
   * When removed/unset, the endpoint reverts to global/category-level logging.
   * In practice: use "DEBUG" for troubleshooting a specific endpoint without flooding all logs.
   */
  LOG_LEVEL: 'logLevel',

  /**
   * When true (default), enforces RFC 7643 schema validation on inbound payloads:
   * - POST/PUT reject bodies containing extension URNs not declared in schemas[] (400 invalidSyntax)
   * - POST/PUT reject unregistered extension URNs (400 invalidValue)
   * - Attribute-level type/format validation against schema definitions
   * - Immutable attribute enforcement on PUT (400 mutability)
   * - PATCH operations on readOnly attributes rejected with 400 (G8c)
   * When false, the server is lenient: accepts undeclared URNs, skips type validation,
   * silently strips readOnly PATCH ops instead of rejecting.
   * In practice: set false for Entra ID compatibility (sends readOnly attrs, boolean strings).
   * @see RFC 7643 §2.2, RFC 7644 §3.3/§3.5.1/§3.5.2
   */
  STRICT_SCHEMA_VALIDATION: 'StrictSchemaValidation',

  /**
   * When true, PUT/PATCH/DELETE requests MUST include an If-Match header
   * with the current resource ETag. Missing If-Match → 428 Precondition Required.
   * When false (default), If-Match is optional but still validated when present.
   * In practice: enable for environments requiring strict concurrency control.
   * @see RFC 7644 §3.14
   */
  REQUIRE_IF_MATCH: 'RequireIfMatch',

  /**
   * When true (default), boolean-typed attributes received as strings ("True", "False")
   * are automatically coerced to native booleans before schema validation and storage.
   * This enables interoperability with clients like Microsoft Entra ID that send boolean
   * values as strings (e.g., roles[].primary = "True" instead of true).
   * Scope: All paths — POST/PUT body, PATCH values, PATCH filter literals, GET/LIST output.
   * Supersedes StrictSchemaValidation for boolean type checks when enabled.
   * When false, string boolean values are passed through as-is and will be rejected
   * by StrictSchemaValidation if that flag is also enabled.
   * In practice: keep true unless all clients send proper JSON booleans.
   * @see RFC 7643 §2.2 — Boolean attribute type
   */
  ALLOW_AND_COERCE_BOOLEAN_STRINGS: 'AllowAndCoerceBooleanStrings',

  /**
   * When true, enables per-endpoint credential validation for this endpoint.
   * Incoming bearer tokens are validated against the EndpointCredential table
   * (bcrypt-hashed per-endpoint tokens). If no matching credential is found
   * AND this flag is true, the guard falls back to the global SCIM_SHARED_SECRET
   * and OAuth JWT validation.
   * When false (default), only the global SCIM_SHARED_SECRET and OAuth JWT are used.
   * In practice: enable for multi-tenant deployments where each endpoint has its own secret.
   */
  PER_ENDPOINT_CREDENTIALS_ENABLED: 'PerEndpointCredentialsEnabled',

  /**
   * When true, write responses include a warning extension URN listing any readOnly
   * attributes that were silently stripped from the incoming payload.
   * When false (default), stripping happens silently without response annotation.
   * In practice: enable during development/debugging to see which attributes were stripped.
   * @see RFC 7643 §2.2 — readOnly mutability
   */
  INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE: 'IncludeWarningAboutIgnoredReadOnlyAttribute',

  /**
   * When true AND StrictSchemaValidation is ON, PATCH operations targeting readOnly
   * attributes are silently stripped instead of producing a 400 error (G8c).
   * When false (default) with strict schema on, readOnly PATCH ops cause 400.
   * Has no effect when StrictSchemaValidation is OFF (stripping always happens regardless).
   * In practice: enable alongside StrictSchemaValidation for Entra ID, which sends readOnly
   * attributes like `groups` and `id` in PATCH operations.
   * @see RFC 7643 §2.2 — readOnly mutability
   */
  IGNORE_READONLY_ATTRIBUTES_IN_PATCH: 'IgnoreReadOnlyAttributesInPatch',

  /**
   * When true (default), PATCH /Users/{id} with {active:false} deactivates the user.
   * Soft-deleted user retains all uniqueness:server attribute values (userName, externalId).
   * POST with matching unique attr → 409 Conflict. Must hard-delete to free unique values.
   * When false, PATCH {active:false} → 400 error (soft-delete disabled).
   * In practice: keep true for standard SCIM provisioning workflows.
   */
  USER_SOFT_DELETE_ENABLED: 'UserSoftDeleteEnabled',

  /**
   * When true (default), DELETE /Users/{id} permanently removes the user from the database.
   * When false, DELETE → 400 error (hard-delete disabled for this endpoint).
   * In practice: set false to prevent accidental permanent deletions in production.
   */
  USER_HARD_DELETE_ENABLED: 'UserHardDeleteEnabled',

  /**
   * When true (default), DELETE /Groups/{id} permanently removes the group from the database.
   * When false, DELETE → 400 error (hard-delete disabled for this endpoint).
   * In practice: set false to prevent accidental permanent deletions in production.
   */
  GROUP_HARD_DELETE_ENABLED: 'GroupHardDeleteEnabled',

  /**
   * When true (default), a single PATCH operation can add/remove multiple members
   * on a Group: value: [{value:"id1"},{value:"id2"}].
   * When false, only one member per PATCH op — multiple members in value array → 400 error.
   * In practice: keep true; most SCIM clients (Entra ID, Okta) send multi-member PATCH ops.
   */
  MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED: 'MultiMemberPatchOpForGroupEnabled',

  /**
   * When true (default), endpoint-scoped /ServiceProviderConfig, /Schemas,
   * /ResourceTypes discovery endpoints respond normally.
   * When false, discovery endpoints return 404 + server WARN log.
   * In practice: set false to hide schema metadata from clients that don't need it.
   */
  SCHEMA_DISCOVERY_ENABLED: 'SchemaDiscoveryEnabled',
} as const;

/**
 * Type for endpoint config flag values (the runtime string keys).
 */
export type EndpointConfigFlag = typeof ENDPOINT_CONFIG_FLAGS[keyof typeof ENDPOINT_CONFIG_FLAGS];

// ─── Flag Definitions — Single Source of Truth ───────────────────────────────

/** Valid types for flag definitions. */
type FlagType = 'boolean' | 'logLevel';

/** Metadata for a single endpoint config flag. */
export interface EndpointConfigFlagDefinition {
  /** The runtime config key string (from ENDPOINT_CONFIG_FLAGS). */
  readonly key: string;
  /** Data type of the flag. */
  readonly type: FlagType;
  /** Default value when not set (undefined = no default). */
  readonly default: boolean | undefined;
  /** Human-readable description. */
  readonly description: string;
}

/**
 * ENDPOINT_CONFIG_FLAGS_DEFINITIONS — Single source of truth for all endpoint config flags.
 *
 * Each entry defines the flag's runtime key (via ENDPOINT_CONFIG_FLAGS constant),
 * data type, default value, and human-readable description.
 *
 * All other constructs (DEFAULT_ENDPOINT_CONFIG, validateEndpointConfig)
 * are derived from this registry. To add a new flag, add it to ENDPOINT_CONFIG_FLAGS
 * and then add an entry here — everything else is automatic.
 */
export const ENDPOINT_CONFIG_FLAGS_DEFINITIONS: Record<string, EndpointConfigFlagDefinition> = {
  PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS: {
    key: ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS,
    type: 'boolean',
    default: false,
    description:
      'When true, allows removing all members from a group via path=members without value array. ' +
      'When false (default), requires explicit member specification in value array or path filter.',
  },
  VERBOSE_PATCH_SUPPORTED: {
    key: ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED,
    type: 'boolean',
    default: false,
    description:
      'When true, enables dot-notation path resolution in PATCH (e.g., "name.givenName" → nested object). ' +
      'When false (default), dot-notation paths are stored as literal top-level keys. ' +
      'Enable for RFC-compliant clients; disable for Entra ID which sends flat keys.',
  },
  LOG_LEVEL: {
    key: ENDPOINT_CONFIG_FLAGS.LOG_LEVEL,
    type: 'logLevel',
    default: undefined,
    description:
      'Per-endpoint log level override. Accepts log level name (TRACE/DEBUG/INFO/WARN/ERROR/FATAL/OFF) ' +
      'or numeric level (0–6). When set, overrides global/category levels for this endpoint. ' +
      'When unset, endpoint uses global/category-level logging.',
  },
  STRICT_SCHEMA_VALIDATION: {
    key: ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION,
    type: 'boolean',
    default: true,
    description:
      'When true (default), enforces RFC 7643 schema validation on inbound payloads: ' +
      'rejects undeclared/unregistered extension URNs in POST/PUT, validates attribute types, ' +
      'enforces immutable attributes on PUT, rejects readOnly PATCH ops with 400. ' +
      'When false, lenient mode: accepts undeclared URNs, skips type validation, ' +
      'silently strips readOnly PATCH ops. Set false for Entra ID compatibility.',
  },
  REQUIRE_IF_MATCH: {
    key: ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH,
    type: 'boolean',
    default: false,
    description:
      'When true, PUT/PATCH/DELETE requests MUST include an If-Match header with the current ETag. ' +
      'Missing If-Match → 428 Precondition Required. ' +
      'When false (default), If-Match is optional but still validated when present.',
  },
  ALLOW_AND_COERCE_BOOLEAN_STRINGS: {
    key: ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS,
    type: 'boolean',
    default: true,
    description:
      'When true (default), boolean-typed attributes received as strings ("True"/"False") ' +
      'are coerced to native booleans before schema validation and storage. ' +
      'Scope: POST/PUT body, PATCH values, PATCH filter literals, GET/LIST output. ' +
      'Supersedes StrictSchemaValidation for boolean type checks. ' +
      'When false, string booleans are passed through as-is and rejected by strict schema if enabled. ' +
      'Keep true for Entra ID interoperability.',
  },
  PER_ENDPOINT_CREDENTIALS_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED,
    type: 'boolean',
    default: false,
    description:
      'When true, incoming bearer tokens are validated against the EndpointCredential table ' +
      '(bcrypt-hashed per-endpoint tokens). Falls back to global SCIM_SHARED_SECRET and OAuth JWT. ' +
      'When false (default), only global SCIM_SHARED_SECRET and OAuth JWT are used. ' +
      'Enable for multi-tenant deployments where each endpoint has its own secret.',
  },
  INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE: {
    key: ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE,
    type: 'boolean',
    default: false,
    description:
      'When true, write responses include a warning extension URN listing any readOnly ' +
      'attributes that were silently stripped from the incoming payload. ' +
      'When false (default), stripping happens silently without response annotation. ' +
      'Enable during development/debugging to see which attributes were stripped.',
  },
  IGNORE_READONLY_ATTRIBUTES_IN_PATCH: {
    key: ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH,
    type: 'boolean',
    default: false,
    description:
      'When true AND StrictSchemaValidation is ON, PATCH operations targeting readOnly attributes ' +
      'are silently stripped instead of producing a 400 error (overrides G8c behavior). ' +
      'When false (default) with strict schema on, readOnly PATCH ops cause 400. ' +
      'Has no effect when StrictSchemaValidation is OFF (stripping always happens). ' +
      'Enable alongside StrictSchemaValidation for Entra ID which sends readOnly attrs in PATCH.',
  },
  USER_SOFT_DELETE_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), PATCH /Users/{id} with {active:false} deactivates the user. ' +
      'Soft-deleted user retains all uniqueness:server attribute values (userName, externalId). ' +
      'POST with matching unique attr → 409. Must hard-delete to free unique values. ' +
      'When false, PATCH {active:false} → 400 error.',
  },
  USER_HARD_DELETE_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), DELETE /Users/{id} permanently removes the user from the database. ' +
      'When false, DELETE → 400 error (hard-delete disabled). ' +
      'Set false to prevent accidental permanent deletions in production.',
  },
  GROUP_HARD_DELETE_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), DELETE /Groups/{id} permanently removes the group from the database. ' +
      'When false, DELETE → 400 error (hard-delete disabled). ' +
      'Set false to prevent accidental permanent deletions in production.',
  },
  MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), a single PATCH operation can add/remove multiple members ' +
      'on a Group: value: [{value:"id1"},{value:"id2"}]. ' +
      'When false, only one member per PATCH op — multiple members → 400. ' +
      'Keep true; most SCIM clients (Entra ID, Okta) send multi-member PATCH ops.',
  },
  SCHEMA_DISCOVERY_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.SCHEMA_DISCOVERY_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), endpoint-scoped /ServiceProviderConfig, /Schemas, ' +
      '/ResourceTypes discovery endpoints respond normally. ' +
      'When false, discovery endpoints return 404 + server WARN log. ' +
      'Set false to hide schema metadata from clients that don\'t need it.',
  },
};

// ─── Endpoint Configuration Interface ────────────────────────────────────────

/**
 * Endpoint Configuration Interface
 *
 * Defines all supported configuration flags for endpoint-specific behavior.
 * These flags control how the SCIM API behaves for each endpoint.
 */
export interface EndpointConfig {
  [ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.LOG_LEVEL]?: string | number;
  [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.SCHEMA_DISCOVERY_ENABLED]?: boolean | string;
  /** Allow any additional configuration flags. */
  [key: string]: unknown;
}

// ─── Derived: Default configuration (from definitions) ───────────────────────

/**
 * Default configuration values — derived from ENDPOINT_CONFIG_FLAGS_DEFINITIONS.
 * Not hand-maintained: add a new flag to ENDPOINT_CONFIG_FLAGS_DEFINITIONS
 * and the default automatically appears here.
 */
export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = Object.fromEntries(
  Object.values(ENDPOINT_CONFIG_FLAGS_DEFINITIONS)
    .filter(def => def.default !== undefined)
    .map(def => [def.key, def.default]),
);

// ─── Config Helper Functions ─────────────────────────────────────────────────

/**
 * Parse a boolean value from raw config input.
 * Handles native booleans and string values ("True", "true", "1", etc.).
 */
function parseBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || value === '1') return true;
    if (lower === 'false' || value === '0') return false;
  }
  return undefined;
}

/**
 * Get a boolean config flag value, falling back to the centrally-defined default
 * from ENDPOINT_CONFIG_FLAGS_DEFINITIONS when the flag is not set in the config.
 *
 * Resolution order:
 * 1. Explicit value in config → parse and return
 * 2. Default from DEFAULT_ENDPOINT_CONFIG → return
 * 3. false (for flags with no defined default)
 */
export function getConfigBoolean(config: EndpointConfig | undefined, key: string): boolean {
  // Check explicit value in provided config
  if (config) {
    const value = config[key];
    if (value !== undefined) {
      const parsed = parseBooleanValue(value);
      if (parsed !== undefined) return parsed;
    }
  }
  // Fall back to centrally-defined default
  const defaultValue = DEFAULT_ENDPOINT_CONFIG[key];
  if (typeof defaultValue === 'boolean') return defaultValue;
  return false;
}

/**
 * @deprecated Use getConfigBoolean() instead — it now falls back to centrally-defined
 * defaults from ENDPOINT_CONFIG_FLAGS_DEFINITIONS, making per-call-site defaults unnecessary.
 *
 * Kept for backward compatibility during migration.
 */
export function getConfigBooleanWithDefault(config: EndpointConfig | undefined, key: string, defaultValue: boolean): boolean {
  if (!config) return defaultValue;
  const value = config[key];
  if (value === undefined) return defaultValue;
  const parsed = parseBooleanValue(value);
  return parsed !== undefined ? parsed : defaultValue;
}

/**
 * Get a string config value.
 */
export function getConfigString(config: EndpointConfig | undefined, key: string): string | undefined {
  if (!config) return undefined;
  const value = config[key];
  if (typeof value === 'string') return value;
  return undefined;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Valid boolean string values (case-insensitive). */
const VALID_BOOLEAN_VALUES = ['true', 'false', '1', '0'];

/** Valid log level names (case-insensitive). */
const VALID_LOG_LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off'];

/**
 * Validate a boolean-typed config flag value.
 */
function validateBooleanFlag(config: Record<string, any>, flagName: string): void {
  const value = config[flagName];
  if (value === undefined) return;
  if (typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!VALID_BOOLEAN_VALUES.includes(value.toLowerCase())) {
      throw new Error(
        `Invalid value "${value}" for config flag "${flagName}". ` +
        `Allowed values: "True", "False", true, false, "1", "0".`,
      );
    }
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected boolean or string ("True"/"False"), got ${typeof value}.`,
    );
  }
}

/**
 * Validate a logLevel config flag value.
 */
function validateLogLevelFlag(config: Record<string, any>, flagName: string): void {
  const value = config[flagName];
  if (value === undefined) return;
  if (typeof value === 'string') {
    if (!VALID_LOG_LEVEL_NAMES.includes(value.toLowerCase())) {
      throw new Error(
        `Invalid value "${value}" for config flag "${flagName}". ` +
        `Allowed values: "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF" (case-insensitive).`,
      );
    }
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      throw new Error(
        `Invalid numeric value ${value} for config flag "${flagName}". ` +
        `Allowed range: 0 (TRACE) through 6 (OFF).`,
      );
    }
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected string ("TRACE"/"DEBUG"/"INFO"/"WARN"/"ERROR"/"FATAL"/"OFF") or number (0-6), got ${typeof value}.`,
    );
  }
}

/**
 * Validate endpoint configuration.
 * Driven by ENDPOINT_CONFIG_FLAGS_DEFINITIONS — no manual flag list to maintain.
 *
 * @param config - The endpoint configuration to validate
 * @throws Error if validation fails
 */
export function validateEndpointConfig(config: Record<string, any> | undefined): void {
  if (!config) return;

  for (const def of Object.values(ENDPOINT_CONFIG_FLAGS_DEFINITIONS)) {
    if (def.type === 'boolean') {
      validateBooleanFlag(config, def.key);
    } else if (def.type === 'logLevel') {
      validateLogLevelFlag(config, def.key);
    }
  }
}
