/**
 * Endpoint Configuration Flag Constants
 * 
 * Central location for all endpoint config flag string constants.
 * Use these constants throughout the codebase to avoid typos and enable easy refactoring.
 */
export const ENDPOINT_CONFIG_FLAGS = {
  /**
   * When true, allows a single PATCH operation to add multiple members to a group.
   * When false (default), each member addition requires a separate PATCH operation.
   */
  MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP: 'MultiOpPatchRequestAddMultipleMembersToGroup',
  
  /**
   * When true, allows a single PATCH operation to remove multiple members from a group.
   * When false (default), each member removal requires a separate PATCH operation.
   */
  MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP: 'MultiOpPatchRequestRemoveMultipleMembersFromGroup',
  
  /**
   * When true (default), allows removing all members from a group via path=members without value array.
   * When false, requires explicit member specification in value array or path filter.
   */
  PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS: 'PatchOpAllowRemoveAllMembers',

  /**
   * When true, enables verbose PATCH support with dot-notation path resolution.
   * Paths like "name.givenName" are resolved into nested objects instead of flat keys.
   * When false (default), dot-notation paths are stored as literal top-level keys.
   */
  VERBOSE_PATCH_SUPPORTED: 'VerbosePatchSupported',

  /**
   * Per-endpoint log level override. Accepts log level name ("TRACE", "DEBUG", "INFO", etc.)
   * or numeric level (0-6). When set, the ScimLogger will use this level for requests
   * to the endpoint instead of the global/category levels.
   * When removed, the endpoint reverts to global/category-level logging.
   */
  LOG_LEVEL: 'logLevel',

  /**
   * When true, DELETE operations set `active=false` instead of physically removing the resource.
   * Soft-deleted resources are excluded from GET/LIST responses.
   * When false (default), DELETE permanently removes the resource from the database.
   */
  SOFT_DELETE_ENABLED: 'SoftDeleteEnabled',

  /**
   * When true, POST/PUT requests must include ALL extension schema URNs in the `schemas[]`
   * array for any extension data present in the request body.
   * When false (default), extension data in the body without a matching `schemas[]` entry
   * is silently accepted (lenient mode — matches most real-world SCIM clients).
   */
  STRICT_SCHEMA_VALIDATION: 'StrictSchemaValidation',

  /**
   * Phase 7: When true, PUT/PATCH/DELETE requests MUST include an If-Match header
   * with the current resource ETag. Missing If-Match → 428 Precondition Required.
   * When false (default), If-Match is optional but still validated when present.
   */
  REQUIRE_IF_MATCH: 'RequireIfMatch',

  /**
   * When true (default), boolean-typed attributes received as strings ("True", "False")
   * are automatically coerced to native booleans before schema validation and storage.
   * This enables interoperability with clients like Microsoft Entra ID that send boolean
   * values as strings (e.g., roles[].primary = "True" instead of true).
   *
   * Scope: All paths — POST/PUT body, PATCH values, PATCH filter literals, GET/LIST output.
   * Supersedes StrictSchemaValidation for boolean type checks when enabled.
   *
   * When false, string boolean values are passed through as-is and will be rejected
   * by StrictSchemaValidation if that flag is also enabled.
   *
   * @see RFC 7643 §2.2 — Boolean attribute type
   * @see RFC 7644 §3.12 — "Be liberal in what you accept" (Postel's Law)
   */
  ALLOW_AND_COERCE_BOOLEAN_STRINGS: 'AllowAndCoerceBooleanStrings',
  /**
   * When true, POST (create) operations that collide with a soft-deleted resource
   * (same userName/externalId for Users, same displayName/externalId for Groups)
   * will re-activate the existing resource with the new payload instead of returning 409.
   * Requires SoftDeleteEnabled to also be true — has no effect with hard-delete.
   * When false (default), uniqueness collisions with soft-deleted resources return
   * 409 Conflict like any other duplicate.
   *
   * @see RFC 7644 §3.3 — Creating Resources (uniqueness)
   * @see RFC 7644 §3.6 — Deleting Resources (soft-delete)
   */
  REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED: 'ReprovisionOnConflictForSoftDeletedResource',

  /**
   * When true, enables registration and use of custom resource types beyond
   * the built-in User and Group types for this endpoint. Custom resource types
   * are registered via the Admin API and stored in the EndpointResourceType table.
   * When false (default), only the built-in User and Group types are available.
   *
   * @see Phase 8b — Custom Resource Type Registration
   */
  CUSTOM_RESOURCE_TYPES_ENABLED: 'CustomResourceTypesEnabled',

  /**
   * When true, enables SCIM Bulk Operations (RFC 7644 §3.7) for this endpoint.
   * Clients can POST to /Bulk with multiple operations in a single request.
   * When false (default), POST /Bulk returns 403 Forbidden for this endpoint.
   *
   * @see Phase 9 — Bulk Operations
   * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.7
   */
  BULK_OPERATIONS_ENABLED: 'BulkOperationsEnabled',

  /**
   * When true, enables per-endpoint credential validation for this endpoint.
   * Incoming bearer tokens are validated against the EndpointCredential table
   * (bcrypt-hashed per-endpoint tokens). If no matching credential is found
   * AND this flag is true, the guard falls back to the global SCIM_SHARED_SECRET
   * and OAuth JWT validation.
   * When false (default), only the global SCIM_SHARED_SECRET and OAuth JWT are used.
   *
   * @see Phase 11 — Per-Endpoint Credentials (RFC 7643 §7 multi-tenant isolation)
   */
  PER_ENDPOINT_CREDENTIALS_ENABLED: 'PerEndpointCredentialsEnabled',

  /**
   * When true, write responses include a warning extension URN listing any readOnly
   * attributes that were silently stripped from the incoming payload.
   * When false (default), stripping happens silently without response annotation.
   *
   * @see RFC 7643 §2.2 — readOnly mutability
   */
  INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE: 'IncludeWarningAboutIgnoredReadOnlyAttribute',

  /**
   * When true AND StrictSchemaValidation is ON, PATCH operations targeting readOnly
   * attributes are silently stripped instead of producing a 400 error (G8c).
   * When false (default) with strict schema on, readOnly PATCH ops still cause 400.
   * Has no effect when StrictSchemaValidation is OFF (stripping always happens).
   *
   * @see RFC 7643 §2.2 — readOnly mutability
   */
  IGNORE_READONLY_ATTRIBUTES_IN_PATCH: 'IgnoreReadOnlyAttributesInPatch',
} as const;

/**
 * Type for endpoint config flag keys
 */
export type EndpointConfigFlag = typeof ENDPOINT_CONFIG_FLAGS[keyof typeof ENDPOINT_CONFIG_FLAGS];

/**
 * Endpoint Configuration Interface
 * 
 * Defines all supported configuration flags for endpoint-specific behavior.
 * These flags control how the SCIM API behaves for each endpoint.
 */
export interface EndpointConfig {
  /**
   * When true, allows a single PATCH operation to add multiple members to a group.
   * When false (default), each member addition requires a separate PATCH operation.
   * 
   * Example config: { "MultiOpPatchRequestAddMultipleMembersToGroup": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]?: boolean | string;

  /**
   * When true, allows a single PATCH operation to remove multiple members from a group.
   * When false (default), each member removal requires a separate PATCH operation.
   * 
   * Example config: { "MultiOpPatchRequestRemoveMultipleMembersFromGroup": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP]?: boolean | string;

  /**
   * When true (default), allows removing all members via path=members without value array.
   * When false, requires explicit member specification in value array or path filter.
   * 
   * Example config: { "PatchOpAllowRemoveAllMembers": "False" }
   */
  [ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS]?: boolean | string;

  /**
   * When true, enables verbose PATCH support with dot-notation path resolution.
   * Paths like "name.givenName" are resolved into nested objects instead of flat keys.
   * When false (default), dot-notation paths are stored as literal top-level keys.
   *
   * Example config: { "VerbosePatchSupported": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]?: boolean | string;

  /**
   * Per-endpoint log level override.
   * Accepts log level name ("TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF")
   * or numeric level (0-6). When set, overrides global/category levels for this endpoint.
   *
   * Example config: { "logLevel": "DEBUG" }
   */
  [ENDPOINT_CONFIG_FLAGS.LOG_LEVEL]?: string | number;

  /**
   * When true, DELETE operations perform soft-delete (set active=false).
   * When false (default), DELETE permanently removes the resource.
   *
   * Example config: { "SoftDeleteEnabled": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]?: boolean | string;

  /**
   * When true, POST/PUT must include all extension URNs in schemas[] for any
   * extension data in the body. When false (default), lenient mode.
   *
   * Example config: { "StrictSchemaValidation": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]?: boolean | string;

  /**
   * Phase 7: When true, PUT/PATCH/DELETE must include If-Match header.
   * Missing If-Match → 428 Precondition Required.
   * When false (default), If-Match is optional but validated when present.
   *
   * Example config: { "RequireIfMatch": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]?: boolean | string;

  /**
   * When true (default), boolean-typed attributes received as strings ("True"/"False")
   * are coerced to native booleans before schema validation and storage.
   * Enables interoperability with clients that send boolean values as strings
   * (e.g., Microsoft Entra ID sends roles[].primary = "True").
   *
   * Supersedes StrictSchemaValidation for boolean type checks when enabled.
   *
   * Example config: { "AllowAndCoerceBooleanStrings": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]?: boolean | string;

  /**
   * When true, POST that collides with a soft-deleted resource will re-activate
   * it with the new payload instead of returning 409 Conflict.
   * Requires SoftDeleteEnabled. When false (default), 409 is returned.
   *
   * Example config: { "ReprovisionOnConflictForSoftDeletedResource": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]?: boolean | string;

  /**
   * When true, enables registration and use of custom resource types beyond
   * User and Group for this endpoint. When false (default), only built-in types.
   *
   * Example config: { "CustomResourceTypesEnabled": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED]?: boolean | string;

  /**
   * When true, enables SCIM Bulk Operations (RFC 7644 §3.7) for this endpoint.
   * When false (default), POST /Bulk returns 403 Forbidden.
   *
   * Example config: { "BulkOperationsEnabled": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]?: boolean | string;

  /**
   * When true, enables per-endpoint credential validation for this endpoint.
   * Tokens are checked against EndpointCredential table before global fallback.
   * When false (default), only global SCIM_SHARED_SECRET and OAuth JWT are used.
   *
   * Example config: { "PerEndpointCredentialsEnabled": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED]?: boolean | string;

  /**
   * When true, responses for write operations that had readOnly attributes stripped
   * include a warning extension URN (urn:scimserver:api:messages:2.0:Warning).
   * When false (default), readOnly attributes are silently stripped.
   *
   * Example config: { "IncludeWarningAboutIgnoredReadOnlyAttribute": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE]?: boolean | string;

  /**
   * When true AND StrictSchemaValidation is ON, PATCH ops targeting readOnly attrs
   * are stripped+warned instead of rejected with 400 (overrides G8c).
   * When false (default), strict mode rejects readOnly PATCH ops.
   *
   * Example config: { "IgnoreReadOnlyAttributesInPatch": "True" }
   */
  [ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH]?: boolean | string;

  /**
   * Allow any additional configuration flags
   */
  [key: string]: unknown;
}

/**
 * Helper function to parse config value as boolean
 * Handles string values like "True", "true", "false", etc.
 */
export function getConfigBoolean(config: EndpointConfig | undefined, key: string): boolean {
  if (!config) return false;
  
  const value = config[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return false;
}

/**
 * Helper function to parse config value as boolean with a custom default.
 * Unlike getConfigBoolean (which defaults to false), this allows specifying
 * what to return when the key is absent or the config is undefined.
 *
 * Used for flags that should default to true (e.g., AllowAndCoerceBooleanStrings).
 */
export function getConfigBooleanWithDefault(config: EndpointConfig | undefined, key: string, defaultValue: boolean): boolean {
  if (!config) return defaultValue;
  
  const value = config[key];
  if (value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return defaultValue;
}

/**
 * Helper function to get config string value
 */
export function getConfigString(config: EndpointConfig | undefined, key: string): string | undefined {
  if (!config) return undefined;
  
  const value = config[key];
  if (typeof value === 'string') return value;
  return undefined;
}

/**
 * Default configuration values
 */
export const DEFAULT_ENDPOINT_CONFIG: EndpointConfig = {
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP]: false,
  [ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP]: false,
  [ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS]: true,
  [ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]: false,
  [ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED]: false,
  [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false,
  [ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH]: false,
  [ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
  [ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED]: false,
  [ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED]: false,
  [ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED]: false,
  [ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED]: false,
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE]: false,
  [ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH]: false,
};

/**
 * Valid boolean string values (case-insensitive)
 */
const VALID_BOOLEAN_VALUES = ['true', 'false', '1', '0'];

/**
 * Valid log level names (case-insensitive)
 */
const VALID_LOG_LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off'];

/**
 * Helper to validate a boolean-typed config flag.
 * Avoids repetition for each boolean flag validation.
 */
function validateBooleanFlag(config: Record<string, any>, flagName: string): void {
  const value = config[flagName];
  if (value === undefined) return;
  if (typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (!VALID_BOOLEAN_VALUES.includes(value.toLowerCase())) {
      throw new Error(
        `Invalid value "${value}" for config flag "${flagName}". ` +
        `Allowed values: "True", "False", true, false, "1", "0".`
      );
    }
  } else {
    throw new Error(
      `Invalid type for config flag "${flagName}". ` +
      `Expected boolean or string ("True"/"False"), got ${typeof value}.`
    );
  }
}

/**
 * Validate endpoint configuration
 * Throws an error if any config value is invalid
 * 
 * @param config - The endpoint configuration to validate
 * @throws Error if validation fails
 */
export function validateEndpointConfig(config: Record<string, any> | undefined): void {
  if (!config) return;

  // Validate boolean flags
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_ADD_MULTIPLE_MEMBERS_TO_GROUP);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.MULTI_OP_PATCH_REMOVE_MULTIPLE_MEMBERS_FROM_GROUP);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.PATCH_OP_ALLOW_REMOVE_ALL_MEMBERS);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.REPROVISION_ON_CONFLICT_FOR_SOFT_DELETED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.BULK_OPERATIONS_ENABLED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.PER_ENDPOINT_CREDENTIALS_ENABLED);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE);
  validateBooleanFlag(config, ENDPOINT_CONFIG_FLAGS.IGNORE_READONLY_ATTRIBUTES_IN_PATCH);

  // Validate logLevel
  const logLevelFlag = config[ENDPOINT_CONFIG_FLAGS.LOG_LEVEL];
  if (logLevelFlag !== undefined) {
    if (typeof logLevelFlag === 'string') {
      if (!VALID_LOG_LEVEL_NAMES.includes(logLevelFlag.toLowerCase())) {
        throw new Error(
          `Invalid value "${logLevelFlag}" for config flag "${ENDPOINT_CONFIG_FLAGS.LOG_LEVEL}". ` +
          `Allowed values: "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF" (case-insensitive).`
        );
      }
    } else if (typeof logLevelFlag === 'number') {
      if (!Number.isInteger(logLevelFlag) || logLevelFlag < 0 || logLevelFlag > 6) {
        throw new Error(
          `Invalid numeric value ${logLevelFlag} for config flag "${ENDPOINT_CONFIG_FLAGS.LOG_LEVEL}". ` +
          `Allowed range: 0 (TRACE) through 6 (OFF).`
        );
      }
    } else {
      throw new Error(
        `Invalid type for config flag "${ENDPOINT_CONFIG_FLAGS.LOG_LEVEL}". ` +
        `Expected string ("TRACE"/"DEBUG"/"INFO"/"WARN"/"ERROR"/"FATAL"/"OFF") or number (0-6), got ${typeof logLevelFlag}.`
      );
    }
  }
}
