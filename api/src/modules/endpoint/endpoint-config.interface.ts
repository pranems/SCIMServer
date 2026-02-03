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
   * When true, excludes the 'meta' attribute from responses.
   */
  EXCLUDE_META: 'excludeMeta',
  
  /**
   * When true, excludes the 'schemas' attribute from responses.
   */
  EXCLUDE_SCHEMAS: 'excludeSchemas',
  
  /**
   * Custom schema URN prefix to replace the standard 'urn:ietf:params:scim'.
   */
  CUSTOM_SCHEMA_URN: 'customSchemaUrn',
  
  /**
   * When true, includes the Enterprise User schema extension in User responses.
   */
  INCLUDE_ENTERPRISE_SCHEMA: 'includeEnterpriseSchema',
  
  /**
   * When true, enforces strict validation rules.
   */
  STRICT_MODE: 'strictMode',
  
  /**
   * When true, enables legacy SCIM 1.1 compatibility mode.
   */
  LEGACY_MODE: 'legacyMode',
  
  /**
   * Custom headers to include in responses.
   */
  CUSTOM_HEADERS: 'customHeaders',
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
   * When true, excludes the 'meta' attribute from responses.
   */
  [ENDPOINT_CONFIG_FLAGS.EXCLUDE_META]?: boolean;

  /**
   * When true, excludes the 'schemas' attribute from responses.
   */
  [ENDPOINT_CONFIG_FLAGS.EXCLUDE_SCHEMAS]?: boolean;

  /**
   * Custom schema URN prefix to replace the standard 'urn:ietf:params:scim'.
   */
  [ENDPOINT_CONFIG_FLAGS.CUSTOM_SCHEMA_URN]?: string;

  /**
   * When true, includes the Enterprise User schema extension in User responses.
   */
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_ENTERPRISE_SCHEMA]?: boolean;

  /**
   * When true, enforces strict validation rules.
   */
  [ENDPOINT_CONFIG_FLAGS.STRICT_MODE]?: boolean;

  /**
   * When true, enables legacy SCIM 1.1 compatibility mode.
   */
  [ENDPOINT_CONFIG_FLAGS.LEGACY_MODE]?: boolean;

  /**
   * Custom headers to include in responses.
   */
  [ENDPOINT_CONFIG_FLAGS.CUSTOM_HEADERS]?: Record<string, string>;

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
  [ENDPOINT_CONFIG_FLAGS.EXCLUDE_META]: false,
  [ENDPOINT_CONFIG_FLAGS.EXCLUDE_SCHEMAS]: false,
  [ENDPOINT_CONFIG_FLAGS.INCLUDE_ENTERPRISE_SCHEMA]: false,
  [ENDPOINT_CONFIG_FLAGS.STRICT_MODE]: false,
  [ENDPOINT_CONFIG_FLAGS.LEGACY_MODE]: false
};
