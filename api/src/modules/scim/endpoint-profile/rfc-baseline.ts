/**
 * RFC Baseline Constants - Phase 13
 *
 * Canonical RFC 7643 attribute definitions used by the auto-expand engine
 * to fill missing fields when operators provide shorthand attribute input.
 *
 * These re-export and index the existing constants from scim-schemas.constants.ts
 * rather than duplicating them. The lookup maps enable O(1) attribute resolution
 * by name for any known RFC schema.
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.6 (Auto-Expand)
 * @see RFC 7643 §4.1 (User), §4.2 (Group), §4.3 (EnterpriseUser), §3.1 (Common)
 */
import {
  USER_SCHEMA_ATTRIBUTES,
  ENTERPRISE_USER_ATTRIBUTES,
  GROUP_SCHEMA_ATTRIBUTES,
} from '../discovery/scim-schemas.constants';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
} from '../common/scim-constants';
import type { ScimSchemaAttribute } from '../discovery/scim-schema-registry';

// ─── Re-exports ─────────────────────────────────────────────────────────────

/** RFC 7643 §4.1 - Complete User schema attributes (includes §3.1 common: id, externalId, meta) */
export { USER_SCHEMA_ATTRIBUTES as RFC_USER_ATTRIBUTES } from '../discovery/scim-schemas.constants';

/** RFC 7643 §4.3 - Complete Enterprise User extension attributes */
export { ENTERPRISE_USER_ATTRIBUTES as RFC_ENTERPRISE_USER_ATTRIBUTES } from '../discovery/scim-schemas.constants';

/** RFC 7643 §4.2 - Complete Group schema attributes (includes project's `active` addition) */
export { GROUP_SCHEMA_ATTRIBUTES as RFC_GROUP_ATTRIBUTES } from '../discovery/scim-schemas.constants';

// ─── Attribute Lookup Maps ──────────────────────────────────────────────────

/**
 * Build a case-insensitive name→attribute map from an attribute array.
 * Used by the auto-expand engine to resolve `{ name: "userName" }` → full definition.
 */
function buildAttributeMap(attributes: readonly any[]): ReadonlyMap<string, ScimSchemaAttribute> {
  const map = new Map<string, ScimSchemaAttribute>();
  for (const attr of attributes) {
    map.set(attr.name.toLowerCase(), attr as ScimSchemaAttribute);
  }
  return map;
}

/** User attribute lookup: name (lowercase) → full RFC 7643 §4.1 definition */
export const RFC_USER_ATTRIBUTE_MAP: ReadonlyMap<string, ScimSchemaAttribute> =
  buildAttributeMap(USER_SCHEMA_ATTRIBUTES);

/** EnterpriseUser attribute lookup: name (lowercase) → full RFC 7643 §4.3 definition */
export const RFC_ENTERPRISE_USER_ATTRIBUTE_MAP: ReadonlyMap<string, ScimSchemaAttribute> =
  buildAttributeMap(ENTERPRISE_USER_ATTRIBUTES);

/** Group attribute lookup: name (lowercase) → full RFC 7643 §4.2 definition */
export const RFC_GROUP_ATTRIBUTE_MAP: ReadonlyMap<string, ScimSchemaAttribute> =
  buildAttributeMap(GROUP_SCHEMA_ATTRIBUTES);

// ─── Schema URN → Attribute Map Registry ────────────────────────────────────

/**
 * Master lookup: schema URN → attribute map.
 * When the auto-expand engine encounters a schema id, it uses this to find
 * the baseline attributes for that schema.
 *
 * Only RFC-defined schemas have baselines. Custom/extension schemas with
 * unknown URNs require operators to provide full attribute definitions.
 */
export const RFC_SCHEMA_ATTRIBUTE_MAPS: ReadonlyMap<string, ReadonlyMap<string, ScimSchemaAttribute>> = new Map([
  [SCIM_CORE_USER_SCHEMA, RFC_USER_ATTRIBUTE_MAP],
  [SCIM_ENTERPRISE_USER_SCHEMA, RFC_ENTERPRISE_USER_ATTRIBUTE_MAP],
  [SCIM_CORE_GROUP_SCHEMA, RFC_GROUP_ATTRIBUTE_MAP],
]);

/**
 * Schema URN → full attribute array (for "attributes": "all" expansion).
 * Returns the complete RFC attribute list for a known schema.
 */
export const RFC_SCHEMA_ALL_ATTRIBUTES: ReadonlyMap<string, readonly ScimSchemaAttribute[]> = new Map([
  [SCIM_CORE_USER_SCHEMA, USER_SCHEMA_ATTRIBUTES as unknown as readonly ScimSchemaAttribute[]],
  [SCIM_ENTERPRISE_USER_SCHEMA, ENTERPRISE_USER_ATTRIBUTES as unknown as readonly ScimSchemaAttribute[]],
  [SCIM_CORE_GROUP_SCHEMA, GROUP_SCHEMA_ATTRIBUTES as unknown as readonly ScimSchemaAttribute[]],
]);

// ─── Required Attributes (RFC guardrails) ───────────────────────────────────

/**
 * Attributes that MUST be present on a schema, per RFC 7643.
 * Auto-inject ensures these exist even if the operator omits them.
 *
 * Key: schema URN
 * Value: array of required attribute names (case-sensitive, matching RFC)
 */
export const RFC_REQUIRED_ATTRIBUTES: ReadonlyMap<string, readonly string[]> = new Map([
  // RFC 7643 §4.1: User must have id + userName
  [SCIM_CORE_USER_SCHEMA, ['id', 'userName']],
  // RFC 7643 §4.2: Group must have id + displayName
  [SCIM_CORE_GROUP_SCHEMA, ['id', 'displayName']],
  // EnterpriseUser has no required attributes
  [SCIM_ENTERPRISE_USER_SCHEMA, []],
]);

/**
 * Project-default attributes auto-injected on all resource type schemas.
 * These are NOT RFC-required, but most IdP clients expect them.
 * See design doc §10.2 - "Project" guardrails.
 */
export const PROJECT_AUTO_INJECT_ATTRIBUTES: readonly string[] = [
  'externalId',
  'meta',
];

/**
 * Group-specific project attribute: `active` is always included on Group.
 * Not in RFC 7643 §4.2 - our project addition for soft-delete support.
 * See design doc decision D7.
 */
export const GROUP_ALWAYS_INCLUDE_ATTRIBUTES: readonly string[] = [
  'active',
];
