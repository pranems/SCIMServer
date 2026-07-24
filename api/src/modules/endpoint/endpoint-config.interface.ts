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
   * Scope: All paths - POST/PUT body, PATCH values, PATCH filter literals, GET/LIST output.
   * Supersedes StrictSchemaValidation for boolean type checks when enabled.
   * When false, string boolean values are passed through as-is and will be rejected
   * by StrictSchemaValidation if that flag is also enabled.
   * In practice: keep true unless all clients send proper JSON booleans.
   * @see RFC 7643 §2.2 - Boolean attribute type
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
   * WI-11 - per-method auth-enablement flag family (splits the double-duty
   * PerEndpointCredentialsEnabled). Each gates one auth method independently,
   * at credential-create AND on the resource-plane validation path.
   *
   * `SecretTokenBearerAuthEnabled`: gates the per-endpoint `bearer` credential
   * (Entra "Secret Token"). Effective value falls back to the legacy
   * PerEndpointCredentialsEnabled when unset (value-preserving migration).
   */
  SECRET_TOKEN_BEARER_AUTH_ENABLED: 'SecretTokenBearerAuthEnabled',

  /**
   * WI-11 - gates the per-endpoint `oauth_client` credential (Entra "OAuth2
   * client-credentials"). Effective value falls back to the legacy
   * PerEndpointCredentialsEnabled when unset (value-preserving migration).
   */
  OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED: 'OAuthClientCredentialsAuthEnabled',

  /**
   * WI-11 - whether THIS endpoint accepts the global SCIM_SHARED_SECRET. New
   * capability: an operator can make an endpoint refuse the global secret and
   * accept ONLY its own credentials. Effective value defaults to `true` when
   * unset (back-compat: every endpoint accepts the global secret today).
   */
  SHARED_SECRET_BEARER_AUTH_ENABLED: 'SharedSecretBearerAuthEnabled',

  /**
   * When true, write responses include a warning extension URN listing any readOnly
   * attributes that were silently stripped from the incoming payload.
   * When false (default), stripping happens silently without response annotation.
   * In practice: enable during development/debugging to see which attributes were stripped.
   * @see RFC 7643 §2.2 - readOnly mutability
   */
  INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE: 'IncludeWarningAboutIgnoredReadOnlyAttribute',

  /**
   * When true AND StrictSchemaValidation is ON, PATCH operations targeting readOnly
   * attributes are silently stripped instead of producing a 400 error (G8c).
   * When false (default) with strict schema on, readOnly PATCH ops cause 400.
   * Has no effect when StrictSchemaValidation is OFF (stripping always happens regardless).
   * In practice: enable alongside StrictSchemaValidation for Entra ID, which sends readOnly
   * attributes like `groups` and `id` in PATCH operations.
   * @see RFC 7643 §2.2 - readOnly mutability
   */
  IGNORE_READONLY_ATTRIBUTES_IN_PATCH: 'IgnoreReadOnlyAttributesInPatch',

  /**
   * When true (default), PATCH /Users/{id} with {active:false} deactivates the user.
   * Deactivated user retains all uniqueness:server attribute values (userName).
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
   * When false, only one member per PATCH op - multiple members in value array → 400 error.
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

  /**
   * When true (default), enables per-endpoint log file under logs/endpoints/.
   * Each endpoint gets its own log file named after the endpoint.
   * When false, per-endpoint file logging is disabled.
   * In practice: keep true for local/dev environments; set false in Docker/Azure
   * where stdout is the log sink and container-local files are ephemeral.
   */
  LOG_FILE_ENABLED: 'logFileEnabled',

  /**
   * Controls enforcement of the RFC 7643 section 2.4 primary sub-attribute constraint
   * on multi-valued complex attributes (emails, phoneNumbers, ims, photos, etc.).
   * RFC rule: "The primary attribute value 'true' MUST appear no more than once."
   *
   * Accepts a tri-state string value:
   * - "passthrough" (default): store as-is but log WARN when >1 primary=true.
   *   Backward-compatible, zero data mutation, gives admin visibility.
   * - "normalize": keep first primary=true, set rest to false, log WARN.
   *   Safe for Azure AD/Entra ID and Okta which may send duplicate primaries.
   * - "reject": return 400 invalidValue if >1 primary=true detected.
   *   Use for strict RFC compliance testing.
   *
   * Scope: POST, PUT, PATCH (all write paths - pre-persist and post-merge).
   * Schema-driven: automatically applies to any multi-valued complex attribute
   * with a boolean primary sub-attribute, including custom extensions.
   * @see RFC 7643 section 2.4 - Multi-Valued Attributes
   */
  PRIMARY_ENFORCEMENT: 'PrimaryEnforcement',

  /**
   * When true, enables Workload Identity Federation (WIF) for this endpoint:
   * a `wif` credential may be attached and the WIF token-mint path is offered.
   * When false (default), WIF is off and existing endpoints are untouched.
   * Orthogonal to PerEndpointCredentialsEnabled (the bcrypt-bearer gate).
   * @see docs/auth/WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md section 8.6
   */
  WIF_CREDENTIALS_ENABLED: 'WifCredentialsEnabled',

  /**
   * When true (default), a LIST/query on a resource type the endpoint profile
   * does not declare returns 404 RESOURCE_TYPE_NOT_SUPPORTED (v0.53.3 Gap-1).
   * When false, a LIST/query on an un-served resource type instead returns a
   * 200 empty ListResponse (RFC 7644 §3.4.2) PLUS a non-fatal warning on three
   * channels (server log, `urn:scimserver:api:messages:2.0:Warning` body member,
   * and `X-SCIM-Warning` header). Item-by-id reads and all writes still reject
   * with 404 regardless of the flag.
   * In practice: set false for Microsoft Entra provisioning, whose Test
   * Connection probes BOTH /Users and /Groups and treats a /Groups 404 on a
   * user-only endpoint as "service incompatible".
   * @see RFC 7644 §3.4.2 - Querying resources
   */
  ENFORCE_RESOURCE_TYPES: 'EnforceResourceTypes',

  /**
   * `CredentialSecretVisibility` (WI-7): whether a per-endpoint credential
   * secret is retained (encrypted at rest) and re-viewable by an admin, or
   * shown exactly once at create. Enum: `always` (default) | `once`. Stored
   * explicitly; the server-scope setting is the ceiling (most-restrictive
   * wins). See docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.
   */
  CREDENTIAL_SECRET_VISIBILITY: 'CredentialSecretVisibility',

  /**
   * Runtime egress robustness (WIF JWKS fetch during token mint). Per-endpoint
   * override of the JWKS fetch TIMEOUT in milliseconds. When set, it OVERRIDES
   * the server-level default (env `JWKS_FETCH_TIMEOUT_MS`, default 5000). When
   * unset, the server default applies. Bounds: 100 - 60000 ms.
   * @see api/src/oauth/egress-policy.ts EGRESS_POLICY_BOUNDS.timeoutMs
   */
  JWKS_FETCH_TIMEOUT_MS: 'JwksFetchTimeoutMs',

  /**
   * Runtime egress robustness. Per-endpoint override of the number of RETRIES
   * for a failed JWKS fetch (total tries = retries + 1). Overrides the server
   * default (env `JWKS_FETCH_RETRIES`, default 2) when set. Bounds: 0 - 10.
   * @see api/src/oauth/egress-policy.ts EGRESS_POLICY_BOUNDS.retries
   */
  JWKS_FETCH_RETRIES: 'JwksFetchRetries',

  /**
   * Runtime egress robustness. Per-endpoint override of the base retry BACKOFF
   * in milliseconds (exponential: backoff * 2^(attempt-1) + jitter). Overrides
   * the server default (env `JWKS_FETCH_RETRY_BACKOFF_MS`, default 200) when
   * set. Bounds: 0 - 10000 ms.
   * @see api/src/oauth/egress-policy.ts EGRESS_POLICY_BOUNDS.retryBackoffMs
   */
  JWKS_FETCH_RETRY_BACKOFF_MS: 'JwksFetchRetryBackoffMs',

  /**
   * Runtime egress robustness. Per-endpoint override of the JWKS cache max-age
   * in milliseconds (how long a cached key set is served without refetch).
   * Overrides the server default (env `JWKS_CACHE_MAX_AGE_MS`, default 600000)
   * when set. Bounds: 0 - 86400000 ms (0 = always refetch).
   * @see api/src/oauth/egress-policy.ts EGRESS_POLICY_BOUNDS.cacheMaxAgeMs
   */
  JWKS_CACHE_MAX_AGE_MS: 'JwksCacheMaxAgeMs',

  /**
   * Request-log privacy. When true (the default, inherited from the server-level
   * `PERSIST_REQUEST_SECRETS` env when unset here), the RequestLog stores and
   * displays the COMPLETE request/response for this endpoint - headers and body,
   * secrets included - for fast, complete RCA. When false, secret-bearing header
   * and body values (`Authorization`, `client_secret`, `client_assertion`,
   * `password`, `access_token`, ...) are redacted before the row is persisted
   * (and therefore before it is shown in the API/UI). Endpoint value OVERRIDES
   * the server default. Shipped console/file logs always redact regardless.
   */
  PERSIST_REQUEST_SECRETS: 'PersistRequestSecrets',
} as const;
/**
 * Type for endpoint config flag values (the runtime string keys).
 */
export type EndpointConfigFlag = typeof ENDPOINT_CONFIG_FLAGS[keyof typeof ENDPOINT_CONFIG_FLAGS];

// ─── Flag Definitions - Single Source of Truth ───────────────────────────────

/** Valid types for flag definitions. */
type FlagType = 'boolean' | 'logLevel' | 'primaryEnforcement' | 'credentialVisibility' | 'structured' | 'number';

/**
 * Shape contract for a `structured` config flag value (Pre-Q.A).
 * `allowedKeys` rejects unknown top-level keys; `requiredKeys` (a subset of
 * `allowedKeys`) must all be present. Omit the schema to accept any object shape.
 */
export interface StructuredFlagSchema {
  readonly allowedKeys: readonly string[];
  readonly requiredKeys?: readonly string[];
}

/** Metadata for a single endpoint config flag. */
export interface EndpointConfigFlagDefinition {
  /** The runtime config key string (from ENDPOINT_CONFIG_FLAGS). */
  readonly key: string;
  /** Data type of the flag. */
  readonly type: FlagType;
  /** Default value when not set (undefined = no default). */
  readonly default: boolean | number | undefined;
  /** Human-readable description. */
  readonly description: string;
  /**
   * For `structured` flags only: the shape contract validated by
   * {@link validateStructuredFlag}. Ignored for other flag types.
   */
  readonly structuredSchema?: StructuredFlagSchema;
  /** For `number` flags only: inclusive lower bound (clamp/validate floor). */
  readonly min?: number;
  /** For `number` flags only: inclusive upper bound (clamp/validate ceiling). */
  readonly max?: number;
}

/**
 * ENDPOINT_CONFIG_FLAGS_DEFINITIONS - Single source of truth for all endpoint config flags.
 *
 * Each entry defines the flag's runtime key (via ENDPOINT_CONFIG_FLAGS constant),
 * data type, default value, and human-readable description.
 *
 * All other constructs (DEFAULT_ENDPOINT_CONFIG, validateEndpointConfig)
 * are derived from this registry. To add a new flag, add it to ENDPOINT_CONFIG_FLAGS
 * and then add an entry here - everything else is automatic.
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
      'Enable for multi-tenant deployments where each endpoint has its own secret. ' +
      'WI-11: superseded by SecretTokenBearerAuthEnabled + OAuthClientCredentialsAuthEnabled ' +
      '(this flag is read as a one-release fallback for both).',
  },
  SECRET_TOKEN_BEARER_AUTH_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED,
    type: 'boolean',
    default: false,
    description:
      'WI-11. When true, this endpoint accepts a per-endpoint bcrypt bearer token (Entra "Secret Token"). ' +
      'When unset, the effective value falls back to the legacy PerEndpointCredentialsEnabled ' +
      '(value-preserving migration). Gates both credential-create and the resource-plane validation path.',
  },
  OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED,
    type: 'boolean',
    default: false,
    description:
      'WI-11. When true, this endpoint accepts a per-endpoint oauth_client credential (Entra "OAuth2 ' +
      'client-credentials"). When unset, the effective value falls back to the legacy ' +
      'PerEndpointCredentialsEnabled (value-preserving migration). Gates both create and validation.',
  },
  SHARED_SECRET_BEARER_AUTH_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.SHARED_SECRET_BEARER_AUTH_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'WI-11. When true (default), this endpoint accepts the global SCIM_SHARED_SECRET as a bearer token. ' +
      'When false, the endpoint refuses the global secret and accepts ONLY its own per-endpoint ' +
      'credentials (or endpoint-scoped OAuth tokens). Back-compat: unset means true.',
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
      'Deactivated user retains all uniqueness:server attribute values (userName). ' +
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
      'When false, only one member per PATCH op - multiple members → 400. ' +
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
  LOG_FILE_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.LOG_FILE_ENABLED,
    type: 'boolean',
    default: true,
    description:
      'When true (default), enables per-endpoint log file under logs/endpoints/. ' +
      'Each endpoint gets its own log file named after the endpoint. ' +
      'When false, per-endpoint file logging is disabled. ' +
      'Set false in Docker/Azure where stdout is the log sink.',
  },
  PRIMARY_ENFORCEMENT: {
    key: ENDPOINT_CONFIG_FLAGS.PRIMARY_ENFORCEMENT,
    type: 'primaryEnforcement',
    default: undefined, // string default handled by getConfigString fallback to 'passthrough'
    description:
      'Controls primary sub-attribute enforcement on multi-valued complex attributes (RFC 7643 section 2.4). ' +
      '"passthrough" (default): stores as-is but logs WARN when >1 primary=true. ' +
      '"normalize": keeps first primary=true, sets rest to false, logs WARN. ' +
      '"reject": returns 400 invalidValue if >1 primary=true.',
  },
  WIF_CREDENTIALS_ENABLED: {
    key: ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED,
    type: 'boolean',
    default: false,
    description:
      'When true, enables Workload Identity Federation (WIF) for this endpoint: a wif credential may be ' +
      'attached and the WIF token-mint path is offered. When false (default), WIF is off and existing ' +
      'endpoints are untouched. Orthogonal to PerEndpointCredentialsEnabled.',
  },
  CREDENTIAL_SECRET_VISIBILITY: {
    key: ENDPOINT_CONFIG_FLAGS.CREDENTIAL_SECRET_VISIBILITY,
    type: 'credentialVisibility',
    default: undefined, // string default via getEffectiveCredentialSecretVisibility (server ceiling -> 'always')
    description:
      'Controls whether a per-endpoint credential secret is retained (encrypted at rest) and ' +
      're-viewable by an admin, or shown once at creation. "always" (default): retain + reveal. ' +
      '"once": shown once at create, then hidden (retained ciphertext is purged). The server-scope ' +
      'setting is the ceiling - most-restrictive-wins, so server "once" forces "once" everywhere.',
  },
  ENFORCE_RESOURCE_TYPES: {
    key: ENDPOINT_CONFIG_FLAGS.ENFORCE_RESOURCE_TYPES,
    type: 'boolean',
    default: true,
    description:
      'When true (default), a LIST/query on a resource type the endpoint profile does not declare ' +
      'returns 404 RESOURCE_TYPE_NOT_SUPPORTED. When false, a LIST/query on an un-served resource type ' +
      'returns a 200 empty ListResponse (RFC 7644 §3.4.2) plus a non-fatal warning (server log + ' +
      'urn:scimserver:api:messages:2.0:Warning body member + X-SCIM-Warning header). Item-by-id reads ' +
      'and all writes still reject with 404. Set false for Entra provisioning of user-only (no Group) endpoints.',
  },
  JWKS_FETCH_TIMEOUT_MS: {
    key: ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_TIMEOUT_MS,
    type: 'number',
    default: undefined,
    min: 100,
    max: 60000,
    description:
      'Runtime egress: JWKS fetch timeout (ms) for the WIF token-mint path. Overrides the server ' +
      'default (env JWKS_FETCH_TIMEOUT_MS, default 5000) when set; unset falls through to the server. ' +
      'Bounds: 100 - 60000 ms.',
  },
  JWKS_FETCH_RETRIES: {
    key: ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRIES,
    type: 'number',
    default: undefined,
    min: 0,
    max: 10,
    description:
      'Runtime egress: number of retries for a failed JWKS fetch (total tries = retries + 1). ' +
      'Overrides the server default (env JWKS_FETCH_RETRIES, default 2) when set. Bounds: 0 - 10.',
  },
  JWKS_FETCH_RETRY_BACKOFF_MS: {
    key: ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRY_BACKOFF_MS,
    type: 'number',
    default: undefined,
    min: 0,
    max: 10000,
    description:
      'Runtime egress: base retry backoff (ms); exponential backoff * 2^(attempt-1) + jitter. ' +
      'Overrides the server default (env JWKS_FETCH_RETRY_BACKOFF_MS, default 200) when set. ' +
      'Bounds: 0 - 10000 ms.',
  },
  JWKS_CACHE_MAX_AGE_MS: {
    key: ENDPOINT_CONFIG_FLAGS.JWKS_CACHE_MAX_AGE_MS,
    type: 'number',
    default: undefined,
    min: 0,
    max: 86400000,
    description:
      'Runtime egress: JWKS cache max-age (ms) - how long a cached key set is served without refetch. ' +
      'Overrides the server default (env JWKS_CACHE_MAX_AGE_MS, default 600000) when set. ' +
      'Bounds: 0 - 86400000 ms (0 = always refetch).',
  },
  PERSIST_REQUEST_SECRETS: {
    key: ENDPOINT_CONFIG_FLAGS.PERSIST_REQUEST_SECRETS,
    type: 'boolean',
    // Unset -> inherit the server-level PERSIST_REQUEST_SECRETS env (default true).
    // NOT baked into DEFAULT_ENDPOINT_CONFIG so "unset" stays distinguishable.
    default: undefined,
    description:
      'When true (default, inherited from server env PERSIST_REQUEST_SECRETS when unset), the ' +
      'RequestLog stores + displays the COMPLETE request/response (headers + body, secrets ' +
      'included) for fast RCA. When false, secret-bearing values are redacted before persist ' +
      '(and API/UI display). Endpoint value overrides the server default; console/file logs ' +
      'always redact regardless.',
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
  [ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.SHARED_SECRET_BEARER_AUTH_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.USER_SOFT_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.USER_HARD_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.GROUP_HARD_DELETE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.SCHEMA_DISCOVERY_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.LOG_FILE_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.PRIMARY_ENFORCEMENT]?: string;
  [ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.CREDENTIAL_SECRET_VISIBILITY]?: string;
  [ENDPOINT_CONFIG_FLAGS.ENFORCE_RESOURCE_TYPES]?: boolean | string;
  [ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_TIMEOUT_MS]?: number | string;
  [ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRIES]?: number | string;
  [ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRY_BACKOFF_MS]?: number | string;
  [ENDPOINT_CONFIG_FLAGS.JWKS_CACHE_MAX_AGE_MS]?: number | string;
  [ENDPOINT_CONFIG_FLAGS.PERSIST_REQUEST_SECRETS]?: boolean | string;
  /** Allow any additional configuration flags. */
  [key: string]: unknown;
}

// ─── Derived: Default configuration (from definitions) ───────────────────────

/**
 * Default configuration values - derived from ENDPOINT_CONFIG_FLAGS_DEFINITIONS.
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
 * @deprecated Use getConfigBoolean() instead - it now falls back to centrally-defined
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

/**
 * Get a finite numeric config value, or `undefined` when the key is absent /
 * not a parseable finite number. Accepts native numbers and numeric strings
 * (Entra and the admin UI both serialize config values as strings). This is the
 * primitive the per-endpoint egress overrides are read through, so an unset key
 * cleanly falls through to the server-level default.
 */
export function getConfigNumber(config: EndpointConfig | undefined, key: string): number | undefined {
  if (!config) return undefined;
  const value = config[key];
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Resolve the ENDPOINT-level runtime egress overrides (WIF JWKS fetch) from an
 * endpoint's stored config. Only keys that are explicitly set are returned, so
 * the merge in the oauth layer keeps the server default for every unset field.
 * The returned object is structurally compatible with the oauth
 * `EgressPolicyOverrides` type (kept decoupled to avoid a module cycle).
 */
export function resolveEndpointEgressOverrides(
  config: EndpointConfig | undefined,
): { timeoutMs?: number; retries?: number; retryBackoffMs?: number; cacheMaxAgeMs?: number } {
  const overrides: { timeoutMs?: number; retries?: number; retryBackoffMs?: number; cacheMaxAgeMs?: number } = {};
  const timeoutMs = getConfigNumber(config, ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_TIMEOUT_MS);
  if (timeoutMs !== undefined) overrides.timeoutMs = timeoutMs;
  const retries = getConfigNumber(config, ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRIES);
  if (retries !== undefined) overrides.retries = retries;
  const retryBackoffMs = getConfigNumber(config, ENDPOINT_CONFIG_FLAGS.JWKS_FETCH_RETRY_BACKOFF_MS);
  if (retryBackoffMs !== undefined) overrides.retryBackoffMs = retryBackoffMs;
  const cacheMaxAgeMs = getConfigNumber(config, ENDPOINT_CONFIG_FLAGS.JWKS_CACHE_MAX_AGE_MS);
  if (cacheMaxAgeMs !== undefined) overrides.cacheMaxAgeMs = cacheMaxAgeMs;
  return overrides;
}

/**
 * Resolve the EFFECTIVE `PersistRequestSecrets` for an endpoint (RequestLog RCA
 * privacy). Precedence: the endpoint's explicit value OVERRIDES the server-level
 * default; when the endpoint leaves it unset it inherits `serverDefault`. When
 * the result is `true` the RequestLog keeps the full request/response (secrets
 * included); when `false` the persisted + displayed row is redacted.
 */
export function getEffectivePersistRequestSecrets(
  config: EndpointConfig | undefined,
  serverDefault: boolean,
): boolean {
  return getOptionalConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.PERSIST_REQUEST_SECRETS) ?? serverDefault;
}

/**
 * Get a structured (object-valued) config flag. Returns the object when the
 * value is a plain object, otherwise undefined (missing, primitive, or array).
 */
export function getConfigStructured(
  config: EndpointConfig | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!config) return undefined;
  const value = config[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

/**
 * Read a boolean flag ONLY when it is explicitly set, returning `undefined`
 * when the key is absent (so a caller can distinguish "unset" from "false").
 * This is the primitive the WI-11 effective-flag fallback is built on.
 */
export function getOptionalConfigBoolean(
  config: EndpointConfig | undefined,
  key: string,
): boolean | undefined {
  if (!config) return undefined;
  const value = config[key];
  if (value === undefined) return undefined;
  return parseBooleanValue(value);
}

/**
 * WI-11 - the effective per-method auth enablement for an endpoint.
 *
 * The single legacy `PerEndpointCredentialsEnabled` flag is split into a
 * per-method family. This helper computes the EFFECTIVE value of each new flag
 * with a value-preserving fallback, so existing endpoints (which have only the
 * legacy flag, or nothing) behave byte-for-byte as before:
 *
 *  - `secretTokenBearer`      = SecretTokenBearerAuthEnabled if set, else the
 *                               legacy PerEndpointCredentialsEnabled, else false.
 *  - `oauthClientCredentials` = OAuthClientCredentialsAuthEnabled if set, else the
 *                               legacy PerEndpointCredentialsEnabled, else false.
 *  - `sharedSecretBearer`     = SharedSecretBearerAuthEnabled if set, else true
 *                               (back-compat: every endpoint accepts the global
 *                               secret today).
 *
 * The legacy flag is read as a one-release fallback; once every endpoint carries
 * the new flags explicitly it can be retired.
 */
export interface EffectiveAuthEnablement {
  /** Per-endpoint bcrypt `bearer` credential (Entra Secret Token). */
  secretTokenBearer: boolean;
  /** Per-endpoint `oauth_client` credential (Entra OAuth2 client-credentials). */
  oauthClientCredentials: boolean;
  /** Whether this endpoint accepts the global SCIM_SHARED_SECRET. */
  sharedSecretBearer: boolean;
}

export function getEffectiveAuthEnablement(
  config: EndpointConfig | undefined,
): EffectiveAuthEnablement {
  const legacy = getOptionalConfigBoolean(
    config,
    ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED,
  );
  const legacyOrFalse = legacy ?? false;

  const secretTokenBearer =
    getOptionalConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED) ??
    legacyOrFalse;
  const oauthClientCredentials =
    getOptionalConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED) ??
    legacyOrFalse;
  const sharedSecretBearer =
    getOptionalConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SHARED_SECRET_BEARER_AUTH_ENABLED) ??
    true;

  return { secretTokenBearer, oauthClientCredentials, sharedSecretBearer };
}

/**
 * W2.5 - a per-method authentication-method entry, structurally minimal so this
 * module does not need to import the `AuthenticationMethod` type from
 * `endpoint-profile` (which would create a module cycle). Callers pass
 * `profile.authentication?.methods`.
 */
export interface AuthMethodEnablementEntry {
  /** Registry key naming the method (e.g. 'bearer', 'oauth-client', 'shared-secret'). */
  type: string;
  /** Whether the method is enabled; `undefined` = enabled (A2 discovery semantics). */
  enabled?: boolean;
}

/**
 * Maps each `EffectiveAuthEnablement` facet to the `AuthenticationMethod.type`
 * value(s) that co-locate its enablement (architecture A0 model). Kept in sync
 * with `METHOD_TYPE_TO_SCHEME_TYPE` in `discovery/authentication-schemes.ts`.
 */
const AUTH_FACET_METHOD_TYPES: Record<keyof EffectiveAuthEnablement, readonly string[]> = {
  secretTokenBearer: ['bearer'],
  oauthClientCredentials: ['oauth-client'],
  sharedSecretBearer: ['shared-secret'],
};

/**
 * W2.5 - the SINGLE per-method enablement source, co-locating enablement with
 * each method's `profile.authentication.methods[]` entry while remaining
 * value-preserving for existing endpoints.
 *
 * For each facet: if the endpoint carries an explicit `AuthenticationMethod`
 * entry of the corresponding `type`, that entry's `enabled` wins (`enabled !==
 * false`, matching the A2 discovery convention where `undefined` means enabled).
 * Otherwise the value falls back to the flat-flag {@link getEffectiveAuthEnablement}
 * (which itself preserves the legacy `PerEndpointCredentialsEnabled` fallback).
 *
 * **Value-preserving.** `profile.authentication.methods[]` is never auto-seeded
 * (see `expandAuthentication`), so every endpoint that has not been managed via
 * the A1 authentication-method API has no method entries and resolves to the
 * exact flat-flag values it does today. Co-location only takes effect for
 * endpoints an operator has explicitly configured through the A1 model, which is
 * that model's stated purpose.
 *
 * This is the one function the resource-plane authenticators, the mint plane
 * (shadow), the credential-create gate, connection-info, and OAuth metadata all
 * consult, so "advertised == enforced" cannot drift.
 */
export function resolveEndpointAuthEnablement(
  config: EndpointConfig | undefined,
  methods?: readonly AuthMethodEnablementEntry[],
): EffectiveAuthEnablement {
  const flat = getEffectiveAuthEnablement(config);
  if (!methods || methods.length === 0) return flat;

  const resolveFacet = (facet: keyof EffectiveAuthEnablement): boolean => {
    const types = AUTH_FACET_METHOD_TYPES[facet];
    const entry = methods.find((m) => types.includes(m.type));
    return entry ? entry.enabled !== false : flat[facet];
  };

  return {
    secretTokenBearer: resolveFacet('secretTokenBearer'),
    oauthClientCredentials: resolveFacet('oauthClientCredentials'),
    sharedSecretBearer: resolveFacet('sharedSecretBearer'),
  };
}

// ─── WI-7: CredentialSecretVisibility precedence (server is the ceiling) ──────

/** The two visibility values. `always` retains + reveals; `once` shows once. */
export type CredentialSecretVisibility = 'always' | 'once';

/** Valid CredentialSecretVisibility values (case-insensitive). */
export const VALID_CREDENTIAL_SECRET_VISIBILITY = ['always', 'once'] as const;

/**
 * Normalize an arbitrary stored value to a valid visibility, or undefined when
 * absent/invalid (so callers can apply the default).
 */
export function normalizeCredentialSecretVisibility(
  value: unknown,
): CredentialSecretVisibility | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().toLowerCase();
  return v === 'always' || v === 'once' ? (v as CredentialSecretVisibility) : undefined;
}

/**
 * Compute the EFFECTIVE CredentialSecretVisibility for an endpoint, applying
 * the design 6A.3 precedence: `once` is more restrictive than `always`, and the
 * SERVER scope is the ceiling (most-restrictive-wins). So:
 *   - server `once`  -> always `once` (no endpoint can override).
 *   - server `always`-> the endpoint value if set, else `always`.
 * Missing/invalid values fall back to `always` (the retain-friendly default).
 */
export function getEffectiveCredentialSecretVisibility(
  serverValue: unknown,
  config: EndpointConfig | undefined,
): CredentialSecretVisibility {
  const server = normalizeCredentialSecretVisibility(serverValue) ?? 'always';
  if (server === 'once') return 'once'; // server ceiling
  const endpoint = normalizeCredentialSecretVisibility(
    config?.[ENDPOINT_CONFIG_FLAGS.CREDENTIAL_SECRET_VISIBILITY],
  );
  return endpoint ?? 'always';
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

/** Valid primary enforcement mode values (case-insensitive). */
const VALID_PRIMARY_ENFORCEMENT_VALUES = ['normalize', 'reject', 'passthrough'];

/**
 * Validate a primaryEnforcement config flag value.
 */
function validatePrimaryEnforcementFlag(config: Record<string, any>, flagName: string): void {
  const value = config[flagName];
  if (value === undefined) return;
  if (typeof value === 'string') {
    if (!VALID_PRIMARY_ENFORCEMENT_VALUES.includes(value.toLowerCase())) {
      throw new Error(
        `Invalid value "${value}" for config flag "${flagName}". ` +
        `Allowed values: "normalize", "reject", "passthrough" (case-insensitive).`,
      );
    }
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected string ("normalize"/"reject"/"passthrough"), got ${typeof value}.`,
    );
  }
}

/**
 * Validate a `credentialVisibility` config flag value (WI-7). Enum always|once.
 */
function validateCredentialVisibilityFlag(config: Record<string, any>, flagName: string): void {
  const value = config[flagName];
  if (value === undefined) return;
  if (typeof value === 'string') {
    if (!VALID_CREDENTIAL_SECRET_VISIBILITY.includes(value.toLowerCase() as CredentialSecretVisibility)) {
      throw new Error(
        `Invalid value "${value}" for config flag "${flagName}". ` +
        `Allowed values: "always", "once" (case-insensitive).`,
      );
    }
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected string ("always"/"once"), got ${typeof value}.`,
    );
  }
}

/**
 * Validate a `number`-typed config flag value against its inclusive [min, max]
 * bounds. Accepts native numbers and numeric strings (the admin UI / Entra
 * serialize config values as strings). An absent value passes (falls through to
 * the server default). A non-numeric, non-finite, or out-of-range value throws.
 */
function validateNumberFlag(
  config: Record<string, unknown>,
  flagName: string,
  min?: number,
  max?: number,
): void {
  const value = config[flagName];
  if (value === undefined) return;
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    n = Number(value);
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected a number or numeric string, got ${typeof value}.`,
    );
  }
  if (!Number.isFinite(n)) {
    throw new Error(
      `Invalid value "${value}" for config flag "${flagName}". Expected a finite number.`,
    );
  }
  if (min !== undefined && n < min) {
    throw new Error(
      `Value ${n} for config flag "${flagName}" is below the minimum ${min}.`,
    );
  }
  if (max !== undefined && n > max) {
    throw new Error(
      `Value ${n} for config flag "${flagName}" exceeds the maximum ${max}.`,
    );
  }
}

/**
 * Validate a `structured` (object-valued) config flag against its shape contract.
 *
 * - Absent value: passes.
 * - Non-object (primitive, null, or array): throws "Invalid type".
 * - With a schema: rejects any key not in `allowedKeys` ("Unknown key"), and
 *   requires every `requiredKeys` entry to be present ("Missing required key").
 * - Without a schema: any object shape is accepted.
 */
export function validateStructuredFlag(
  config: Record<string, unknown>,
  flagName: string,
  schema?: StructuredFlagSchema,
): void {
  const value = config[flagName];
  if (value === undefined) return;

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const got = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected a structured object, got ${got}.`,
    );
  }

  if (schema) {
    const allowed = new Set(schema.allowedKeys);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        throw new Error(
          `Unknown key "${key}" in config flag "${flagName}". ` +
          `Allowed keys: ${schema.allowedKeys.map((k) => `"${k}"`).join(', ')}.`,
        );
      }
    }
    if (schema.requiredKeys) {
      for (const req of schema.requiredKeys) {
        if (!(req in (value as Record<string, unknown>))) {
          throw new Error(
            `Missing required key "${req}" in config flag "${flagName}".`,
          );
        }
      }
    }
  }
}

/**
 * Validate endpoint configuration.
 * Driven by ENDPOINT_CONFIG_FLAGS_DEFINITIONS - no manual flag list to maintain.
 *
 * @param config - The endpoint configuration to validate
 * @param definitions - The flag-definition registry to validate against
 *   (defaults to the production registry; injectable for testing new flag types)
 * @throws Error if validation fails
 */
export function validateEndpointConfig(
  config: Record<string, any> | undefined,
  definitions: Record<string, EndpointConfigFlagDefinition> = ENDPOINT_CONFIG_FLAGS_DEFINITIONS,
): void {
  if (!config) return;

  for (const def of Object.values(definitions)) {
    if (def.type === 'boolean') {
      validateBooleanFlag(config, def.key);
    } else if (def.type === 'logLevel') {
      validateLogLevelFlag(config, def.key);
    } else if (def.type === 'primaryEnforcement') {
      validatePrimaryEnforcementFlag(config, def.key);
    } else if (def.type === 'credentialVisibility') {
      validateCredentialVisibilityFlag(config, def.key);
    } else if (def.type === 'structured') {
      validateStructuredFlag(config, def.key, def.structuredSchema);
    } else if (def.type === 'number') {
      validateNumberFlag(config, def.key, def.min, def.max);
    }
  }
}
