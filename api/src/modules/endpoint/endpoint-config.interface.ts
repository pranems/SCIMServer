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
  [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: false
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
