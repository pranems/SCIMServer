/**
 * Endpoint Profile Types — Phase 13
 *
 * Defines the `EndpointProfile` interface that replaces the fragmented
 * `Endpoint.config` + `EndpointSchema` + `EndpointResourceType` model
 * with a single JSONB document containing RFC-native discovery format
 * plus project-specific settings.
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.1
 * @see RFC 7643 §6, §7
 * @see RFC 7644 §4
 */
import type { ScimSchemaDefinition, ScimResourceType, ScimSchemaAttribute } from '../discovery/scim-schema-registry';
import type { SchemaCharacteristicsCache } from '../../../domain/validation/validation-types';

// ─── ServiceProviderConfig ─────────────────────────────────────────────────

/** RFC 7644 §4 — Capability sub-objects */
export interface SpcCapability {
  supported: boolean;
}

export interface SpcBulk extends SpcCapability {
  maxOperations?: number;
  maxPayloadSize?: number;
}

export interface SpcFilter extends SpcCapability {
  maxResults?: number;
}

export interface SpcAuthenticationScheme {
  type: string;
  name: string;
  description: string;
  specUri?: string;
  documentationUri?: string;
  primary?: boolean;
}

/** RFC 7644 §4 — ServiceProviderConfig shape stored in the profile */
export interface ServiceProviderConfig {
  schemas?: readonly string[];
  documentationUri?: string;
  patch: SpcCapability;
  bulk: SpcBulk;
  filter: SpcFilter;
  changePassword: SpcCapability;
  sort: SpcCapability;
  etag: SpcCapability;
  authenticationSchemes?: SpcAuthenticationScheme[];
  meta?: {
    resourceType: string;
    location: string;
  };
}

// ─── Profile Settings ──────────────────────────────────────────────────────

/**
 * Project-specific behavioral flags stored in `profile.settings`.
 * Settings v7: 13 boolean flags + logLevel.
 *
 * All values use string|boolean to match the existing endpoint config
 * convention (Entra ID sends "True"/"False" strings).
 */
export interface ProfileSettings {
  // ─── Settings v7: New flags ──────────────────────────────────────
  /** PATCH {active:false} deactivates user (default true) */
  UserSoftDeleteEnabled?: boolean | string;
  /** DELETE /Users/{id} permanently removes user (default true) */
  UserHardDeleteEnabled?: boolean | string;
  /** DELETE /Groups/{id} permanently removes group (default true) */
  GroupHardDeleteEnabled?: boolean | string;
  /** Multi-member add/remove in single PATCH op on Group (default true) */
  MultiMemberPatchOpForGroupEnabled?: boolean | string;
  /** Endpoint-scoped discovery endpoints respond (default true) */
  SchemaDiscoveryEnabled?: boolean | string;

  // ─── Unchanged flags ─────────────────────────────────────────────
  /** Allow remove-all-members via path=members (default false) */
  PatchOpAllowRemoveAllMembers?: boolean | string;
  /** Enable dot-notation path resolution in PATCH */
  VerbosePatchSupported?: boolean | string;
  /** Per-endpoint log level override */
  logLevel?: string | number;
  /** Require extension URNs in schemas[] (default true) */
  StrictSchemaValidation?: boolean | string;
  /** Mandatory ETag on PUT/PATCH/DELETE */
  RequireIfMatch?: boolean | string;
  /** Coerce "True"/"False" strings to booleans (default true) */
  AllowAndCoerceBooleanStrings?: boolean | string;
  /** Enable per-endpoint bearer token validation */
  PerEndpointCredentialsEnabled?: boolean | string;
  /** Warn on readOnly attribute stripping */
  IncludeWarningAboutIgnoredReadOnlyAttribute?: boolean | string;
  /** Strip (don't reject) readOnly PATCH ops */
  IgnoreReadOnlyAttributesInPatch?: boolean | string;

  // ─── Deprecated (settings v7 clean break) ────────────────────────
  /** @deprecated Replaced by UserSoftDeleteEnabled + UserHardDeleteEnabled */
  SoftDeleteEnabled?: boolean | string;
  /** @deprecated Replaced by MultiMemberPatchOpForGroupEnabled */
  MultiOpPatchRequestAddMultipleMembersToGroup?: boolean | string;
  /** @deprecated Replaced by MultiMemberPatchOpForGroupEnabled */
  MultiOpPatchRequestRemoveMultipleMembersFromGroup?: boolean | string;
  /** @deprecated Removed — POST collision always 409 */
  ReprovisionOnConflictForSoftDeletedResource?: boolean | string;

  /** Enable per-endpoint log file under logs/endpoints/ */
  logFileEnabled?: boolean | string;
  /** Allow any additional settings */
  [key: string]: unknown;
}

// ─── EndpointProfile ───────────────────────────────────────────────────────

/**
 * The unified endpoint profile — stored as a single JSONB column on Endpoint.
 *
 * Contains three RFC-native discovery document sections plus project settings:
 * - `schemas`             — RFC 7643 §7 schema definitions
 * - `resourceTypes`       — RFC 7643 §6 resource type declarations
 * - `serviceProviderConfig` — RFC 7644 §4 capability advertisement
 * - `settings`            — Project-specific behavioral flags (not RFC-governed)
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.1
 */
export interface EndpointProfile {
  /** RFC 7643 §7 — Schema definitions with attribute characteristics */
  schemas: ScimSchemaDefinition[];

  /** RFC 7643 §6 — Resource type declarations with extension bindings */
  resourceTypes: ScimResourceType[];

  /** RFC 7644 §4 — Server capability advertisement */
  serviceProviderConfig: ServiceProviderConfig;

  /** Project-specific behavioral flags (13 persisted + extensible) */
  settings: ProfileSettings;

  /**
   * Precomputed Parent→Children maps for schema attribute characteristics.
   * Built lazily per resource type (keyed by core schema URN) at first access.
   * Prefixed with _ to indicate it's a runtime-only field (not persisted to DB).
   * @see SchemaCharacteristicsCache
   */
  _schemaCaches?: Record<string, SchemaCharacteristicsCache>;
}

// ─── Shorthand Types ───────────────────────────────────────────────────────

/**
 * Shorthand schema input — used in presets and by operators.
 * Attributes can be:
 * - "all"        → expand to full RFC attribute list for this schema
 * - object[]     → array of attribute definitions (may be partial for known RFC attrs)
 * - undefined    → no attributes (extension schema with passthrough storage)
 */
export interface ShorthandSchemaInput {
  id: string;
  name: string;
  description?: string;
  attributes?: 'all' | Partial<ScimSchemaAttribute>[] | undefined;
}

/**
 * Shorthand profile input — what operators can submit.
 * The server auto-expands this into a full EndpointProfile.
 */
export interface ShorthandProfileInput {
  schemas?: ShorthandSchemaInput[];
  resourceTypes?: ScimResourceType[];
  serviceProviderConfig?: Partial<ServiceProviderConfig>;
  settings?: ProfileSettings;
}

// ─── Preset Metadata ───────────────────────────────────────────────────────

/** Metadata for a built-in preset (returned by GET /admin/profile-presets) */
export interface PresetMetadata {
  name: string;
  description: string;
  default?: boolean;
}

/** A built-in preset: metadata + the shorthand profile definition */
export interface BuiltInPreset {
  metadata: PresetMetadata;
  profile: ShorthandProfileInput;
}
