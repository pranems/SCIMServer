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
 * 13 persisted settings — see docs/SCHEMA_TEMPLATES_DESIGN.md §9.1.
 *
 * All values use string|boolean to match the existing endpoint config
 * convention (Entra ID sends "True"/"False" strings).
 */
export interface ProfileSettings {
  /** Allow multi-member PATCH add to group */
  MultiOpPatchRequestAddMultipleMembersToGroup?: boolean | string;
  /** Allow multi-member PATCH remove from group */
  MultiOpPatchRequestRemoveMultipleMembersFromGroup?: boolean | string;
  /** Allow remove-all-members via path=members */
  PatchOpAllowRemoveAllMembers?: boolean | string;
  /** Enable dot-notation path resolution in PATCH */
  VerbosePatchSupported?: boolean | string;
  /** Per-endpoint log level override */
  logLevel?: string | number;
  /** DELETE → soft-delete (active=false) */
  SoftDeleteEnabled?: boolean | string;
  /** Require extension URNs in schemas[] */
  StrictSchemaValidation?: boolean | string;
  /** Mandatory ETag on PUT/PATCH/DELETE */
  RequireIfMatch?: boolean | string;
  /** Coerce "True"/"False" strings to booleans */
  AllowAndCoerceBooleanStrings?: boolean | string;
  /** Re-activate soft-deleted on conflict */
  ReprovisionOnConflictForSoftDeletedResource?: boolean | string;
  /** Enable per-endpoint bearer token validation */
  PerEndpointCredentialsEnabled?: boolean | string;
  /** Warn on readOnly attribute stripping */
  IncludeWarningAboutIgnoredReadOnlyAttribute?: boolean | string;
  /** Strip (don't reject) readOnly PATCH ops */
  IgnoreReadOnlyAttributesInPatch?: boolean | string;
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
   * Built at profile load time, consumed at zero cost per request.
   * Prefixed with _ to indicate it's a runtime-only field (not persisted to DB).
   * @see SchemaCharacteristicsCache
   */
  _schemaCache?: SchemaCharacteristicsCache;
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
