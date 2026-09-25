import { AUTH_METHOD_FLAGS } from './endpoint-auth-flags';

export type SettingCategory =
  | 'Validation & schema'
  | 'Concurrency & ETags'
  | 'Lifecycle & deletes'
  | 'PATCH semantics'
  | 'Discovery'
  | 'Logging & privacy'
  | 'Authentication methods';

interface SettingBase {
  key: string;
  label: string;
  displayLabel: string;
  description: string;
}

export interface BooleanSettingDefinition extends SettingBase {
  kind: 'boolean';
  defaultValue: boolean;
  category: SettingCategory;
}

export interface EnumSettingDefinition extends SettingBase {
  kind: 'enum';
  options: ReadonlyArray<{ value: string; label: string }>;
  defaultValue: string;
}

export interface NumberSettingDefinition extends SettingBase {
  kind: 'number';
  min: number;
  max: number;
  serverDefault: number;
}

export type EndpointSettingDefinition =
  | BooleanSettingDefinition
  | EnumSettingDefinition
  | NumberSettingDefinition;

export const CATEGORY_ORDER: readonly SettingCategory[] = [
  'Authentication methods',
  'Validation & schema',
  'PATCH semantics',
  'Lifecycle & deletes',
  'Concurrency & ETags',
  'Discovery',
  'Logging & privacy',
];

export const BOOLEAN_FLAGS: ReadonlyArray<BooleanSettingDefinition> = [
  {
    kind: 'boolean',
    key: 'StrictSchemaValidation',
    label: 'StrictSchemaValidation',
    displayLabel: 'Strict schema validation',
    description: 'Reject resources whose schemas[] is missing a declared extension URN.',
    defaultValue: false,
    category: 'Validation & schema',
  },
  {
    kind: 'boolean',
    key: 'AllowAndCoerceBooleanStrings',
    label: 'AllowAndCoerceBooleanStrings',
    displayLabel: 'Coerce boolean strings',
    description: 'Coerce "True" / "False" string values to real booleans on write.',
    defaultValue: true,
    category: 'Validation & schema',
  },
  {
    kind: 'boolean',
    key: 'RequireIfMatch',
    label: 'RequireIfMatch',
    displayLabel: 'Require If-Match',
    description: 'Mandate an If-Match ETag header on PUT, PATCH, and DELETE requests.',
    defaultValue: false,
    category: 'Concurrency & ETags',
  },
  {
    kind: 'boolean',
    key: 'UserSoftDeleteEnabled',
    label: 'UserSoftDeleteEnabled',
    displayLabel: 'User soft delete',
    description: 'PATCH active=false soft-deactivates the user (default RFC behavior).',
    defaultValue: true,
    category: 'Lifecycle & deletes',
  },
  {
    kind: 'boolean',
    key: 'UserHardDeleteEnabled',
    label: 'UserHardDeleteEnabled',
    displayLabel: 'User hard delete',
    description: 'DELETE /Users/{id} permanently removes the row.',
    defaultValue: true,
    category: 'Lifecycle & deletes',
  },
  {
    kind: 'boolean',
    key: 'GroupHardDeleteEnabled',
    label: 'GroupHardDeleteEnabled',
    displayLabel: 'Group hard delete',
    description: 'DELETE /Groups/{id} permanently removes the group.',
    defaultValue: true,
    category: 'Lifecycle & deletes',
  },
  {
    kind: 'boolean',
    key: 'MultiMemberPatchOpForGroupEnabled',
    label: 'MultiMemberPatchOpForGroupEnabled',
    displayLabel: 'Multi-member Group PATCH',
    description: 'Accept multi-member add/remove inside a single PATCH operation on a Group.',
    defaultValue: true,
    category: 'PATCH semantics',
  },
  {
    kind: 'boolean',
    key: 'PatchOpAllowRemoveAllMembers',
    label: 'PatchOpAllowRemoveAllMembers',
    displayLabel: 'Allow removing all Group members',
    description: 'Allow remove path=members to clear the entire membership list.',
    defaultValue: false,
    category: 'PATCH semantics',
  },
  {
    kind: 'boolean',
    key: 'VerbosePatchSupported',
    label: 'VerbosePatchSupported',
    displayLabel: 'Verbose PATCH paths',
    description: 'Resolve dot-notation paths such as name.familyName inside PATCH.',
    defaultValue: false,
    category: 'PATCH semantics',
  },
  {
    kind: 'boolean',
    key: 'IncludeWarningAboutIgnoredReadOnlyAttribute',
    label: 'IncludeWarningAboutIgnoredReadOnlyAttribute',
    displayLabel: 'Warn when read-only values are ignored',
    description: 'Append a warning when a read-only attribute is silently stripped.',
    defaultValue: false,
    category: 'PATCH semantics',
  },
  {
    kind: 'boolean',
    key: 'IgnoreReadOnlyAttributesInPatch',
    label: 'IgnoreReadOnlyAttributesInPatch',
    displayLabel: 'Ignore read-only PATCH attributes',
    description: 'Strip instead of reject read-only attributes encountered in PATCH operations.',
    defaultValue: false,
    category: 'PATCH semantics',
  },
  {
    kind: 'boolean',
    key: 'SchemaDiscoveryEnabled',
    label: 'SchemaDiscoveryEnabled',
    displayLabel: 'Schema discovery',
    description: 'Expose Schemas, ResourceTypes, and ServiceProviderConfig under this endpoint.',
    defaultValue: true,
    category: 'Discovery',
  },
  {
    kind: 'boolean',
    key: 'EnforceResourceTypes',
    label: 'EnforceResourceTypes',
    displayLabel: 'Enforce resource types',
    description: 'Return 404 for a resource type this endpoint does not serve.',
    defaultValue: true,
    category: 'Discovery',
  },
  {
    kind: 'boolean',
    key: 'RfcCompliantSubAttributes',
    label: 'RfcCompliantSubAttributes',
    displayLabel: 'RFC-compliant sub-attributes',
    description: 'Reject complex sub-attributes that exceed the RFC 7643 nesting model.',
    defaultValue: false,
    category: 'Validation & schema',
  },
  ...AUTH_METHOD_FLAGS.map((flag): BooleanSettingDefinition => ({
    kind: 'boolean',
    key: flag.key,
    label: flag.label,
    displayLabel: flag.shortLabel,
    description: flag.description,
    defaultValue: flag.defaultValue,
    category: 'Authentication methods',
  })),
  {
    kind: 'boolean',
    key: 'PersistRequestSecrets',
    label: 'PersistRequestSecrets',
    displayLabel: 'Persist request secrets',
    description: 'Retired compatibility setting. Secret-bearing values are always redacted before durable request-log storage.',
    defaultValue: false,
    category: 'Logging & privacy',
  },
  {
    kind: 'boolean',
    key: 'logFileEnabled',
    label: 'logFileEnabled',
    displayLabel: 'Write endpoint log file',
    description: 'Write this endpoint to the server log file in addition to the database request log.',
    defaultValue: true,
    category: 'Logging & privacy',
  },
];

export const ENUM_SETTINGS: ReadonlyArray<EnumSettingDefinition> = [
  {
    kind: 'enum',
    key: 'PrimaryEnforcement',
    label: 'PrimaryEnforcement',
    displayLabel: 'Primary enforcement',
    description: 'How a resource with more than one primary=true sub-attribute is handled.',
    options: [
      { value: 'passthrough', label: 'passthrough (accept as-is)' },
      { value: 'normalize', label: 'normalize (keep first primary)' },
      { value: 'reject', label: 'reject (422 on duplicate primary)' },
    ],
    defaultValue: 'passthrough',
  },
  {
    kind: 'enum',
    key: 'logLevel',
    label: 'logLevel',
    displayLabel: 'Log level',
    description: 'Per-endpoint log verbosity override. Falls back to the server global level when unset.',
    options: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF'].map((value) => ({ value, label: value })),
    defaultValue: 'INFO',
  },
];

export const NUMBER_SETTINGS: ReadonlyArray<NumberSettingDefinition> = [
  {
    kind: 'number', key: 'JwksFetchTimeoutMs', label: 'JwksFetchTimeoutMs', displayLabel: 'JWKS fetch timeout (ms)',
    description: 'JWKS fetch timeout for the WIF token-mint path.', min: 100, max: 60000, serverDefault: 5000,
  },
  {
    kind: 'number', key: 'JwksFetchRetries', label: 'JwksFetchRetries', displayLabel: 'JWKS fetch retries',
    description: 'Number of retries for a failed JWKS fetch.', min: 0, max: 10, serverDefault: 2,
  },
  {
    kind: 'number', key: 'JwksFetchRetryBackoffMs', label: 'JwksFetchRetryBackoffMs', displayLabel: 'JWKS retry backoff (ms)',
    description: 'Base retry backoff with exponential jitter.', min: 0, max: 10000, serverDefault: 200,
  },
  {
    kind: 'number', key: 'JwksCacheMaxAgeMs', label: 'JwksCacheMaxAgeMs', displayLabel: 'JWKS cache max age (ms)',
    description: 'How long a cached key set is served without refetch.', min: 0, max: 86400000, serverDefault: 600000,
  },
  {
    kind: 'number', key: 'MaxActiveBearerCredentials', label: 'MaxActiveBearerCredentials', displayLabel: 'Maximum active bearer credentials',
    description: 'Maximum active bearer credentials for this endpoint.', min: 1, max: 25, serverDefault: 5,
  },
  {
    kind: 'number', key: 'MaxActiveOAuthClientCredentials', label: 'MaxActiveOAuthClientCredentials', displayLabel: 'Maximum active OAuth clients',
    description: 'Maximum active OAuth client credentials for this endpoint.', min: 1, max: 25, serverDefault: 5,
  },
  {
    kind: 'number', key: 'MaxActiveWifTrusts', label: 'MaxActiveWifTrusts', displayLabel: 'Maximum active WIF trusts',
    description: 'Maximum active WIF trusts for this endpoint.', min: 1, max: 25, serverDefault: 10,
  },
  {
    kind: 'number', key: 'JwksTotalDeadlineMs', label: 'JwksTotalDeadlineMs', displayLabel: 'JWKS total deadline (ms)',
    description: 'Total wall-clock deadline for a JWKS fetch including retries.', min: 100, max: 120000, serverDefault: 10000,
  },
  {
    kind: 'number', key: 'JwksMaxResponseBytes', label: 'JwksMaxResponseBytes', displayLabel: 'Maximum JWKS response bytes',
    description: 'Maximum accepted JWKS response body size.', min: 1024, max: 10485760, serverDefault: 1048576,
  },
  {
    kind: 'number', key: 'JwksMaxKeys', label: 'JwksMaxKeys', displayLabel: 'Maximum JWKS keys',
    description: 'Maximum number of keys accepted in one JWKS.', min: 1, max: 1000, serverDefault: 100,
  },
  {
    kind: 'number', key: 'JwksMaxCacheEntries', label: 'JwksMaxCacheEntries', displayLabel: 'Maximum JWKS cache entries',
    description: 'Maximum JWKS cache cardinality before oldest-entry eviction.', min: 1, max: 1000, serverDefault: 50,
  },
  {
    kind: 'number', key: 'JwksRefreshIntervalMs', label: 'JwksRefreshIntervalMs', displayLabel: 'JWKS refresh interval (ms)',
    description: 'Background refresh cadence for cached key sets.', min: 60000, max: 86400000, serverDefault: 3600000,
  },
  {
    kind: 'number', key: 'JwksUnknownKidMinIntervalMs', label: 'JwksUnknownKidMinIntervalMs', displayLabel: 'Unknown-kid refetch interval (ms)',
    description: 'Minimum interval between refetches triggered by an unknown key id.', min: 0, max: 3600000, serverDefault: 300000,
  },
  {
    kind: 'number', key: 'JwksStaleIfErrorMs', label: 'JwksStaleIfErrorMs', displayLabel: 'JWKS stale-if-error window (ms)',
    description: 'How long stale keys may be served while the issuer is unreachable.', min: 0, max: 604800000, serverDefault: 172800000,
  },
];

export const ALL_ENDPOINT_SETTINGS: ReadonlyMap<string, EndpointSettingDefinition> = new Map(
  [...BOOLEAN_FLAGS, ...ENUM_SETTINGS, ...NUMBER_SETTINGS].map((setting) => [setting.key, setting]),
);

export const TAB_SETTING_KEYS = {
  users: ['UserSoftDeleteEnabled', 'UserHardDeleteEnabled'],
  groups: [
    'GroupHardDeleteEnabled',
    'MultiMemberPatchOpForGroupEnabled',
    'PatchOpAllowRemoveAllMembers',
  ],
  schemas: ['SchemaDiscoveryEnabled', 'StrictSchemaValidation', 'RfcCompliantSubAttributes'],
  resourceTypes: ['SchemaDiscoveryEnabled', 'EnforceResourceTypes'],
  logs: ['PersistRequestSecrets', 'logFileEnabled', 'logLevel'],
  connectBearer: ['MaxActiveBearerCredentials'],
  connectOauthClient: ['MaxActiveOAuthClientCredentials'],
  connectWif: [
    'MaxActiveWifTrusts',
    'JwksFetchTimeoutMs',
    'JwksFetchRetries',
    'JwksFetchRetryBackoffMs',
    'JwksCacheMaxAgeMs',
    'JwksTotalDeadlineMs',
    'JwksMaxResponseBytes',
    'JwksMaxKeys',
    'JwksMaxCacheEntries',
    'JwksRefreshIntervalMs',
    'JwksUnknownKidMinIntervalMs',
    'JwksStaleIfErrorMs',
  ],
} as const;

export function effectiveBooleanSetting(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const normalized = raw.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

export function effectiveNumberSetting(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}
