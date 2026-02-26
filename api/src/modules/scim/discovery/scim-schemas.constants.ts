/**
 * SCIM Schema & ResourceType Definitions — RFC 7643 §7, §6, §4
 *
 * Phase 6: Centralized schema definitions replacing hardcoded JSON
 * in discovery controllers. These map to the attributes the server
 * actually persists and returns, not the full RFC universe.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7643#section-4
 * @see https://datatracker.ietf.org/doc/html/rfc7643#section-6
 * @see https://datatracker.ietf.org/doc/html/rfc7643#section-7
 */
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_SP_CONFIG_SCHEMA,
} from '../common/scim-constants';

// ─── Attribute definitions ──────────────────────────────────────────────────

/**
 * SCIM Core User Schema attributes (RFC 7643 §4.1)
 * Only attributes actually handled by the server are listed.
 */
export const USER_SCHEMA_ATTRIBUTES = [
  {
    name: 'userName',
    type: 'string',
    multiValued: false,
    required: true,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'always',
    uniqueness: 'server',
    description: 'Unique identifier for the User, typically used by the user to directly authenticate.',
  },
  {
    name: 'name',
    type: 'complex',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The components of the user\'s real name.',
    subAttributes: [
      { name: 'formatted', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The full name.' },
      { name: 'familyName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The family name.' },
      { name: 'givenName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The given name.' },
      { name: 'middleName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The middle name.' },
      { name: 'honorificPrefix', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The honorific prefix.' },
      { name: 'honorificSuffix', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The honorific suffix.' },
    ],
  },
  {
    name: 'displayName',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The name of the User, suitable for display to end-users.',
  },
  {
    name: 'nickName',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The casual way to address the user in real life.',
  },
  {
    name: 'profileUrl',
    type: 'reference',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    referenceTypes: ['external'],
    description: 'A fully qualified URL pointing to a page representing the User\'s online profile.',
  },
  {
    name: 'title',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The user\'s title, such as "Vice President".',
  },
  {
    name: 'userType',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Used to identify the relationship between the organization and the user.',
  },
  {
    name: 'preferredLanguage',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Indicates the User\'s preferred written or spoken language (BCP 47).',
  },
  {
    name: 'locale',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Used to indicate the User\'s default location for purposes of localizing items.',
  },
  {
    name: 'timezone',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The User\'s time zone in the "Olson" time zone database format (e.g., "America/Los_Angeles").',
  },
  {
    name: 'active',
    type: 'boolean',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'A Boolean value indicating the User\'s administrative status.',
  },
  {
    name: 'emails',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Email addresses for the user.',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'always', description: 'Email address value.' },
      { name: 'type', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', canonicalValues: ['work', 'home', 'other'], description: 'Label (e.g., "work", "home").' },
      { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'Whether this is the primary email.' },
    ],
  },
  {
    name: 'phoneNumbers',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Phone numbers for the User.',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'default', description: 'Phone number value.' },
      { name: 'type', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', canonicalValues: ['work', 'home', 'mobile', 'fax', 'pager', 'other'], description: 'Label (e.g., "work", "mobile", "fax").' },
      { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'Whether this is the primary phone number.' },
    ],
  },
  {
    name: 'addresses',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'A physical mailing address for this User.',
    subAttributes: [
      { name: 'formatted', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The full street address.' },
      { name: 'streetAddress', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The street address component.' },
      { name: 'locality', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The city or locality component.' },
      { name: 'region', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The state or region component.' },
      { name: 'postalCode', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The zip or postal code component.' },
      { name: 'country', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The country name component.' },
      { name: 'type', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readWrite', returned: 'default', canonicalValues: ['work', 'home', 'other'], description: 'Label (e.g., "work", "home").' },
      { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'Whether this is the primary address.' },
    ],
  },
  {
    name: 'roles',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'A list of roles for the User.',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The role value.' },
      { name: 'display', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The display name.' },
      { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The type label.' },
      { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'Whether this is the primary role.' },
    ],
  },
  {
    name: 'groups',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readOnly',
    returned: 'default',
    description: 'A list of groups to which the user belongs, either thorough direct membership, through nested groups, or dynamically calculated. (RFC 7643 §4.1)',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readOnly', returned: 'default', description: 'The identifier of the User\'s group.' },
      { name: '$ref', type: 'reference', multiValued: false, required: false, caseExact: false, mutability: 'readOnly', returned: 'default', referenceTypes: ['User', 'Group'], description: 'The URI of the corresponding "Group" resource.' },
      { name: 'display', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readOnly', returned: 'default', description: 'A human-readable name, primarily used for display purposes.' },
      { name: 'type', type: 'string', multiValued: false, required: false, caseExact: false, mutability: 'readOnly', returned: 'default', canonicalValues: ['direct', 'indirect'], description: 'A label indicating the attribute\'s function (e.g., "direct" or "indirect").' },
    ],
  },
  {
    name: 'password',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'writeOnly',
    returned: 'never',
    description: 'The User\'s cleartext password. This attribute is intended to be used as a means to specify an initial password when creating a new User or to reset an existing User\'s password.',
  },
  {
    name: 'externalId',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: true,
    mutability: 'readWrite',
    returned: 'default',
    description: 'An identifier for the Resource as defined by the Service Consumer.',
  },
] as const;

/**
 * Enterprise User Extension attributes (RFC 7643 §4.3)
 */
export const ENTERPRISE_USER_ATTRIBUTES = [
  {
    name: 'employeeNumber',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Numeric or alphanumeric identifier assigned to a person.',
    uniqueness: 'none',
  },
  {
    name: 'costCenter',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Identifies the name of a cost center.',
    uniqueness: 'none',
  },
  {
    name: 'organization',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Identifies the name of an organization.',
    uniqueness: 'none',
  },
  {
    name: 'division',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Identifies the name of a division.',
    uniqueness: 'none',
  },
  {
    name: 'department',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'Identifies the name of a department.',
    uniqueness: 'none',
  },
  {
    name: 'manager',
    type: 'complex',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'The User\'s manager.',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'The id of the SCIM resource representing the User\'s manager.' },
      { name: '$ref', type: 'reference', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', referenceTypes: ['User'], description: 'The URI of the SCIM resource representing the User\'s manager.' },
      { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readOnly', returned: 'default', description: 'The displayName of the User\'s manager.' },
    ],
  },
] as const;

/**
 * SCIM Core Group Schema attributes (RFC 7643 §4.2)
 */
export const GROUP_SCHEMA_ATTRIBUTES = [
  {
    name: 'displayName',
    type: 'string',
    multiValued: false,
    required: true,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'always',
    description: 'A human-readable name for the Group.',
  },
  {
    name: 'members',
    type: 'complex',
    multiValued: true,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    description: 'A list of members of the Group.',
    subAttributes: [
      { name: 'value', type: 'string', multiValued: false, required: true, mutability: 'immutable', returned: 'always', description: 'Identifier of the member.' },
      { name: 'display', type: 'string', multiValued: false, required: false, mutability: 'immutable', returned: 'default', description: 'The display name of the member.' },
      { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'immutable', returned: 'default', description: 'The type of the member (e.g., "User").' },
    ],
  },
  {
    name: 'externalId',
    type: 'string',
    multiValued: false,
    required: false,
    caseExact: true,
    mutability: 'readWrite',
    returned: 'default',
    description: 'An identifier for the Group as defined by the Service Consumer.',
  },
  {
    name: 'active',
    type: 'boolean',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'always',
    description: 'A Boolean value indicating the Group\'s administrative status. When soft-delete is enabled, a deleted Group has active set to false.',
  },
] as const;

// ─── Full schema objects ────────────────────────────────────────────────────

/** SCIM Core User schema definition (RFC 7643 §7 format) */
export const SCIM_USER_SCHEMA_DEFINITION = {
  id: SCIM_CORE_USER_SCHEMA,
  name: 'User',
  description: 'User Account',
  attributes: USER_SCHEMA_ATTRIBUTES,
  meta: {
    resourceType: 'Schema',
    location: '/Schemas/urn:ietf:params:scim:schemas:core:2.0:User',
  },
};

/** SCIM Enterprise User Extension schema definition (RFC 7643 §7 format) */
export const SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION = {
  id: SCIM_ENTERPRISE_USER_SCHEMA,
  name: 'EnterpriseUser',
  description: 'Enterprise User Extension',
  attributes: ENTERPRISE_USER_ATTRIBUTES,
  meta: {
    resourceType: 'Schema',
    location: `/Schemas/${SCIM_ENTERPRISE_USER_SCHEMA}`,
  },
};

/** SCIM Core Group schema definition (RFC 7643 §7 format) */
export const SCIM_GROUP_SCHEMA_DEFINITION = {
  id: SCIM_CORE_GROUP_SCHEMA,
  name: 'Group',
  description: 'Group',
  attributes: GROUP_SCHEMA_ATTRIBUTES,
  meta: {
    resourceType: 'Schema',
    location: '/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group',
  },
};

// ─── Resource Type definitions ──────────────────────────────────────────────

/** SCIM User ResourceType definition (RFC 7643 §6) */
export const SCIM_USER_RESOURCE_TYPE = {
  id: 'User',
  name: 'User',
  endpoint: '/Users',
  description: 'User Account',
  schema: SCIM_CORE_USER_SCHEMA,
  schemaExtensions: [
    {
      schema: SCIM_ENTERPRISE_USER_SCHEMA,
      required: false,
    },
  ],
  meta: {
    resourceType: 'ResourceType',
    location: '/ResourceTypes/User',
  },
};

/** SCIM Group ResourceType definition (RFC 7643 §6) */
export const SCIM_GROUP_RESOURCE_TYPE = {
  id: 'Group',
  name: 'Group',
  endpoint: '/Groups',
  description: 'Group',
  schema: SCIM_CORE_GROUP_SCHEMA,
  schemaExtensions: [],
  meta: {
    resourceType: 'ResourceType',
    location: '/ResourceTypes/Group',
  },
};

// ─── ServiceProviderConfig ─────────────────────────────────────────────────

/** SCIM ServiceProviderConfig (RFC 7644 §4) */
export const SCIM_SERVICE_PROVIDER_CONFIG = {
  schemas: [SCIM_SP_CONFIG_SCHEMA],
  documentationUri: 'https://github.com/pranems/SCIMServer',
  patch: { supported: true },
  bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: true },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description: 'Authentication scheme using the OAuth Bearer Token Standard',
      specUri: 'https://www.rfc-editor.org/info/rfc6750',
      documentationUri: 'https://github.com/pranems/SCIMServer#authentication',
    },
  ],
  meta: {
    resourceType: 'ServiceProviderConfig',
    location: '/ServiceProviderConfig',
  },
};

// ─── Runtime immutability ───────────────────────────────────────────────────
//
// Deep-freeze all schema constants to prevent accidental runtime mutation.
// These objects are shared references used by ScimSchemaRegistry, discovery
// endpoints, and attribute characteristic filtering (G8e / RFC 7643 §2.4).
// Any mutation would corrupt the shared state for all consumers.
//
// TypeScript `as const` provides compile-time readonly guarantees only;
// Object.freeze provides the runtime guarantee.

/** Recursively freeze an object and all nested objects/arrays. */
function deepFreeze<T>(obj: T): T {
  Object.freeze(obj);
  if (obj !== null && typeof obj === 'object') {
    for (const value of Object.values(obj as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
  }
  return obj;
}

deepFreeze(USER_SCHEMA_ATTRIBUTES);
deepFreeze(ENTERPRISE_USER_ATTRIBUTES);
deepFreeze(GROUP_SCHEMA_ATTRIBUTES);
deepFreeze(SCIM_USER_SCHEMA_DEFINITION);
deepFreeze(SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION);
deepFreeze(SCIM_GROUP_SCHEMA_DEFINITION);
deepFreeze(SCIM_USER_RESOURCE_TYPE);
deepFreeze(SCIM_GROUP_RESOURCE_TYPE);
deepFreeze(SCIM_SERVICE_PROVIDER_CONFIG);
