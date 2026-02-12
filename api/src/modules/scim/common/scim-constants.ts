export const SCIM_CORE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_CORE_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SP_CONFIG_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_SEARCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:SearchRequest';

export const DEFAULT_COUNT = 100;
export const MAX_COUNT = 200;

/**
 * RFC 7644 §3.12 — Standard SCIM error scimType values.
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
} as const;

export type ScimErrorType = typeof SCIM_ERROR_TYPE[keyof typeof SCIM_ERROR_TYPE];

