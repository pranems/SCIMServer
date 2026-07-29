import { resolveRuntimeConfig } from '../../../bootstrap/runtime-config';
export const SCIM_CORE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_CORE_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SP_CONFIG_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
export const SCIM_SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';

/**
 * Custom diagnostics extension URN for SCIM error responses.
 * Added to error bodies to enable self-service RCA - contains
 * requestId, endpointId, triggeredBy, and logsUrl.
 * RFC 7644 §3.12 does not prohibit additional fields in error responses.
 */
export const SCIM_DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

// ─── Custom Microsoft Test Extension URNs ───────────────────────────────────
// Hardcoded extension schemas for Microsoft SCIM testing compliance.
export const MSFTTEST_CUSTOM_USER_SCHEMA = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User';
export const MSFTTEST_CUSTOM_GROUP_SCHEMA = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group';
export const MSFTTEST_IETF_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:msfttest:User';
export const MSFTTEST_IETF_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:extension:msfttest:Group';

/**
 * All known SCIM extension schema URNs supported by this server.
 * Used for dynamic schemas[] inclusion and PATCH path resolution.
 * Includes Enterprise User + Microsoft test extension schemas.
 */
export const KNOWN_EXTENSION_URNS: readonly string[] = [
  SCIM_ENTERPRISE_USER_SCHEMA,
  MSFTTEST_CUSTOM_USER_SCHEMA,
  MSFTTEST_CUSTOM_GROUP_SCHEMA,
  MSFTTEST_IETF_USER_SCHEMA,
  MSFTTEST_IETF_GROUP_SCHEMA,
] as const;

/**
 * Pagination ceilings (W1.7b). These are the SERVER-level defaults and are
 * environment-dependent: a 0.5 vCPU container serving a bursty provisioning
 * cycle wants a different page ceiling than a laptop. Resolved once at import
 * from `SCIM_DEFAULT_COUNT` / `SCIM_MAX_COUNT`, clamped to a published range so
 * `MAX_COUNT` can never be configured into a memory problem.
 *
 * A per-endpoint override still layers on TOP of `MAX_COUNT` via the
 * ServiceProviderConfig `filter.maxResults` cascade (`resolveNumericLimit`),
 * which is the RFC 7644 section 3.7 mechanism - this env tier only moves the
 * server floor, it does not replace that.
 */
const scimLimits = resolveRuntimeConfig((k) => process.env[k]).groups.scim;
export const DEFAULT_COUNT = scimLimits.defaultCount.effective as number;
export const MAX_COUNT = scimLimits.maxCount.effective as number;

/**
 * RFC 7644 §3.12 - Standard SCIM error scimType values.
 * These are the "detail error keyword" values defined in Table 9.
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.12
 */
export const SCIM_ERROR_TYPE = {
  /** POST/PUT/PATCH contains a value already in use (409 Conflict) */
  UNIQUENESS: 'uniqueness',
  /** The specified filter syntax is invalid or unsupported (400) */
  INVALID_FILTER: 'invalidFilter',
  /** The request body is invalid or not conforming (400) */
  INVALID_SYNTAX: 'invalidSyntax',
  /** An invalid path was supplied (400) */
  INVALID_PATH: 'invalidPath',
  /** The specified resource does not exist (404) */
  NO_TARGET: 'noTarget',
  /** One or more values are not valid (400) */
  INVALID_VALUE: 'invalidValue',
  /** The PATCH operation is not supported (501) */
  MUTABILITY: 'mutability',
  /** Resource version mismatch (412 Precondition Failed) */
  VERSION_MISMATCH: 'versionMismatch',
  /** Too many results, use a filter to narrow (400) */
  TOO_MANY: 'tooMany',
  /** The attempted modification is not compatible with the target's existing attribute (400) */
  SENSITIVE: 'sensitive',
  /** Request payload exceeds server size limit (413 Payload Too Large) */
  TOO_LARGE: 'tooLarge',
} as const;

export type ScimErrorType = typeof SCIM_ERROR_TYPE[keyof typeof SCIM_ERROR_TYPE];

