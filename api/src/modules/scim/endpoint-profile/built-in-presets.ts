/**
 * Built-in Profile Presets — Phase 13
 *
 * 5 named presets stored as code constants (not in a database table).
 * Each preset is a ShorthandProfileInput that the validation engine
 * auto-expands into a full EndpointProfile at creation time.
 *
 * Default preset: `entra-id` (decision D5).
 * No `custom` preset — operators use inline `profile` instead (decision D13).
 * No ProfilePreset DB table — YAGNI (decision D4).
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §8
 */
import type { BuiltInPreset, ShorthandProfileInput } from './endpoint-profile.types';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  MSFTTEST_CUSTOM_USER_SCHEMA,
  MSFTTEST_CUSTOM_GROUP_SCHEMA,
  MSFTTEST_IETF_USER_SCHEMA,
  MSFTTEST_IETF_GROUP_SCHEMA,
} from '../common/scim-constants';

// ─── Preset Name Constants ─────────────────────────────────────────────────

export const PRESET_ENTRA_ID = 'entra-id';
export const PRESET_ENTRA_ID_MINIMAL = 'entra-id-minimal';
export const PRESET_RFC_STANDARD = 'rfc-standard';
export const PRESET_MINIMAL = 'minimal';
export const PRESET_USER_ONLY = 'user-only';

/** The default preset applied when neither profilePreset nor profile is provided */
export const DEFAULT_PRESET_NAME = PRESET_ENTRA_ID;

// ═══════════════════════════════════════════════════════════════════════════════
// Preset Definitions
// ═══════════════════════════════════════════════════════════════════════════════

// ─── entra-id (Default) ────────────────────────────────────────────────────

const ENTRA_ID_PROFILE: ShorthandProfileInput = {
  schemas: [
    {
      id: SCIM_CORE_USER_SCHEMA,
      name: 'User',
      description: 'User Account',
      attributes: [
        { name: 'userName' },
        { name: 'name' },
        { name: 'displayName', required: true },
        { name: 'nickName' },
        { name: 'profileUrl' },
        { name: 'title' },
        { name: 'userType' },
        { name: 'emails', required: true },
        { name: 'active', returned: 'always' },
        { name: 'externalId', uniqueness: 'server' },
        { name: 'addresses' },
        { name: 'phoneNumbers' },
        { name: 'ims' },
        { name: 'photos' },
        { name: 'roles' },
        { name: 'entitlements' },
        { name: 'preferredLanguage' },
        { name: 'locale' },
        { name: 'timezone' },
        { name: 'password' },
      ],
    },
    {
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise User Extension',
      attributes: 'all',
    },
    {
      id: SCIM_CORE_GROUP_SCHEMA,
      name: 'Group',
      description: 'Group',
      attributes: 'all',
    },
    // Microsoft SCIM Validator extensions (passthrough — no attributes defined)
    { id: MSFTTEST_CUSTOM_USER_SCHEMA, name: 'MsftTestCustomUser', description: 'Microsoft SCIM Validator custom User extension' },
    { id: MSFTTEST_CUSTOM_GROUP_SCHEMA, name: 'MsftTestCustomGroup', description: 'Microsoft SCIM Validator custom Group extension' },
    { id: MSFTTEST_IETF_USER_SCHEMA, name: 'MsftTestIetfUser', description: 'Microsoft SCIM Validator IETF User extension' },
    { id: MSFTTEST_IETF_GROUP_SCHEMA, name: 'MsftTestIetfGroup', description: 'Microsoft SCIM Validator IETF Group extension' },
  ],
  resourceTypes: [
    {
      id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
      schema: SCIM_CORE_USER_SCHEMA,
      schemaExtensions: [
        { schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false },
        { schema: MSFTTEST_CUSTOM_USER_SCHEMA, required: false },
        { schema: MSFTTEST_IETF_USER_SCHEMA, required: false },
      ],
    },
    {
      id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
      schema: SCIM_CORE_GROUP_SCHEMA,
      schemaExtensions: [
        { schema: MSFTTEST_CUSTOM_GROUP_SCHEMA, required: false },
        { schema: MSFTTEST_IETF_GROUP_SCHEMA, required: false },
      ],
    },
  ],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: false },
    etag: { supported: true },
    changePassword: { supported: false },
  },
  settings: {
    AllowAndCoerceBooleanStrings: 'True',
  },
};

const ENTRA_ID_PRESET: BuiltInPreset = {
  metadata: {
    name: PRESET_ENTRA_ID,
    description: 'Entra ID provisioning. Scoped attributes, msfttest extensions, EnterpriseUser.',
    default: true,
  },
  profile: ENTRA_ID_PROFILE,
};

// ─── entra-id-minimal ──────────────────────────────────────────────────────

const ENTRA_ID_MINIMAL_PROFILE: ShorthandProfileInput = {
  schemas: [
    {
      id: SCIM_CORE_USER_SCHEMA,
      name: 'User',
      attributes: [
        { name: 'userName' },
        { name: 'displayName', required: true },
        { name: 'emails', required: true },
        { name: 'active', returned: 'always' },
        { name: 'externalId', uniqueness: 'server' },
        { name: 'password' },
      ],
    },
    {
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise User Extension',
      attributes: 'all',
    },
    {
      id: SCIM_CORE_GROUP_SCHEMA,
      name: 'Group',
      attributes: [
        { name: 'displayName' },
        { name: 'members' },
        { name: 'externalId' },
      ],
    },
    { id: MSFTTEST_CUSTOM_USER_SCHEMA, name: 'MsftTestCustomUser' },
    { id: MSFTTEST_CUSTOM_GROUP_SCHEMA, name: 'MsftTestCustomGroup' },
    { id: MSFTTEST_IETF_USER_SCHEMA, name: 'MsftTestIetfUser' },
    { id: MSFTTEST_IETF_GROUP_SCHEMA, name: 'MsftTestIetfGroup' },
  ],
  resourceTypes: [
    {
      id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
      schema: SCIM_CORE_USER_SCHEMA,
      schemaExtensions: [
        { schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false },
        { schema: MSFTTEST_CUSTOM_USER_SCHEMA, required: false },
        { schema: MSFTTEST_IETF_USER_SCHEMA, required: false },
      ],
    },
    {
      id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
      schema: SCIM_CORE_GROUP_SCHEMA,
      schemaExtensions: [
        { schema: MSFTTEST_CUSTOM_GROUP_SCHEMA, required: false },
        { schema: MSFTTEST_IETF_GROUP_SCHEMA, required: false },
      ],
    },
  ],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: false },
    etag: { supported: true },
    changePassword: { supported: false },
  },
  settings: {
    AllowAndCoerceBooleanStrings: 'True',
  },
};

const ENTRA_ID_MINIMAL_PRESET: BuiltInPreset = {
  metadata: {
    name: PRESET_ENTRA_ID_MINIMAL,
    description: 'Entra ID minimal. Core identity fields only + msfttest + EnterpriseUser.',
  },
  profile: ENTRA_ID_MINIMAL_PROFILE,
};

// ─── rfc-standard ──────────────────────────────────────────────────────────

const RFC_STANDARD_PROFILE: ShorthandProfileInput = {
  schemas: [
    {
      id: SCIM_CORE_USER_SCHEMA,
      name: 'User',
      description: 'User Account',
      attributes: 'all',
    },
    {
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      description: 'Enterprise User Extension',
      attributes: 'all',
    },
    {
      id: SCIM_CORE_GROUP_SCHEMA,
      name: 'Group',
      description: 'Group',
      attributes: 'all',
    },
  ],
  resourceTypes: [
    {
      id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
      schema: SCIM_CORE_USER_SCHEMA,
      schemaExtensions: [
        { schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false },
      ],
    },
    {
      id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
      schema: SCIM_CORE_GROUP_SCHEMA,
      schemaExtensions: [],
    },
  ],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: true },
    etag: { supported: true },
    changePassword: { supported: false },
  },
  settings: {},
};

const RFC_STANDARD_PRESET: BuiltInPreset = {
  metadata: {
    name: PRESET_RFC_STANDARD,
    description: 'Full RFC 7643. All attributes, all capabilities, EnterpriseUser.',
  },
  profile: RFC_STANDARD_PROFILE,
};

// ─── minimal ───────────────────────────────────────────────────────────────

const MINIMAL_PROFILE: ShorthandProfileInput = {
  schemas: [
    {
      id: SCIM_CORE_USER_SCHEMA,
      name: 'User',
      attributes: [
        { name: 'userName' },
        { name: 'displayName' },
        { name: 'active' },
        { name: 'externalId' },
        { name: 'emails' },
        { name: 'password' },
      ],
    },
    {
      id: SCIM_CORE_GROUP_SCHEMA,
      name: 'Group',
      attributes: [
        { name: 'displayName' },
        { name: 'members' },
        { name: 'externalId' },
      ],
    },
  ],
  resourceTypes: [
    {
      id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
      schema: SCIM_CORE_USER_SCHEMA,
      schemaExtensions: [],
    },
    {
      id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
      schema: SCIM_CORE_GROUP_SCHEMA,
      schemaExtensions: [],
    },
  ],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 100 },
    sort: { supported: false },
    etag: { supported: false },
    changePassword: { supported: false },
  },
  settings: {},
};

const MINIMAL_PRESET: BuiltInPreset = {
  metadata: {
    name: PRESET_MINIMAL,
    description: 'Bare minimum for testing. No extensions.',
  },
  profile: MINIMAL_PROFILE,
};

// ─── user-only ─────────────────────────────────────────────────────────────

const USER_ONLY_PROFILE: ShorthandProfileInput = {
  schemas: [
    {
      id: SCIM_CORE_USER_SCHEMA,
      name: 'User',
      attributes: [
        { name: 'userName' },
        { name: 'name' },
        { name: 'displayName' },
        { name: 'emails' },
        { name: 'active' },
        { name: 'externalId' },
        { name: 'title' },
        { name: 'password' },
      ],
    },
    {
      id: SCIM_ENTERPRISE_USER_SCHEMA,
      name: 'EnterpriseUser',
      attributes: 'all',
    },
  ],
  resourceTypes: [
    {
      id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
      schema: SCIM_CORE_USER_SCHEMA,
      schemaExtensions: [
        { schema: SCIM_ENTERPRISE_USER_SCHEMA, required: false },
      ],
    },
  ],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: true },
    etag: { supported: true },
    changePassword: { supported: false },
  },
  settings: {},
};

const USER_ONLY_PRESET: BuiltInPreset = {
  metadata: {
    name: PRESET_USER_ONLY,
    description: 'User provisioning only. No Group resource type. EnterpriseUser.',
  },
  profile: USER_ONLY_PROFILE,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Preset Registry
// ═══════════════════════════════════════════════════════════════════════════════

/** All built-in presets indexed by name */
export const BUILT_IN_PRESETS: ReadonlyMap<string, BuiltInPreset> = new Map([
  [PRESET_ENTRA_ID, ENTRA_ID_PRESET],
  [PRESET_ENTRA_ID_MINIMAL, ENTRA_ID_MINIMAL_PRESET],
  [PRESET_RFC_STANDARD, RFC_STANDARD_PRESET],
  [PRESET_MINIMAL, MINIMAL_PRESET],
  [PRESET_USER_ONLY, USER_ONLY_PRESET],
]);

/** All preset names in display order */
export const PRESET_NAMES: readonly string[] = [
  PRESET_ENTRA_ID,
  PRESET_ENTRA_ID_MINIMAL,
  PRESET_RFC_STANDARD,
  PRESET_MINIMAL,
  PRESET_USER_ONLY,
];

/**
 * Get a built-in preset by name.
 * @throws Error if the preset name is not recognized.
 */
export function getBuiltInPreset(name: string): BuiltInPreset {
  const preset = BUILT_IN_PRESETS.get(name);
  if (!preset) {
    const validNames = PRESET_NAMES.join(', ');
    throw new Error(`Unknown preset "${name}". Valid presets: ${validNames}`);
  }
  return preset;
}

/**
 * Get all preset metadata (for listing — excludes the full profile).
 */
export function getAllPresetMetadata() {
  return PRESET_NAMES.map(name => BUILT_IN_PRESETS.get(name)!.metadata);
}
