/**
 * Schema Validation Types - Phase 8
 *
 * Pure domain types for SCIM payload validation against schema definitions.
 * No NestJS or Prisma dependencies.
 */

/**
 * A single validation error describing what's wrong and where.
 */
export interface ValidationError {
  /** Dot-path to the invalid attribute (e.g. "name.givenName", "emails[0].value") */
  path: string;
  /** Human-readable description of the violation */
  message: string;
  /** SCIM error scimType for the error response (RFC 7644 §3.12) */
  scimType?: string;
}

/**
 * A non-fatal validation warning (e.g. readOnly attribute silently ignored).
 * @see RFC 7643 §2.2 - readOnly attributes MAY be sent but SHALL be ignored
 */
export interface ValidationWarning {
  /** Dot-path to the attribute that triggered the warning */
  path: string;
  /** Human-readable description of the warning */
  message: string;
}

/**
 * Result of schema validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  /** Non-fatal warnings (e.g. readOnly attributes that were ignored) */
  warnings?: ValidationWarning[];
}

// ─── Schema Characteristics Cache ──────────────────────────────────────────

/**
 * Precomputed URN-qualified dot-path maps for schema attribute characteristics.
 *
 * Built once at profile load time via `SchemaValidator.buildCharacteristicsCache()`.
 * Each map is keyed by a **URN-qualified dot-path** (lowercase) that encodes the
 * full ancestry of the attribute's parent, eliminating name-collision ambiguity:
 *
 * - **Top-level core attrs**:  `urn:ietf:params:scim:schemas:core:2.0:user`
 * - **Top-level ext attrs**:   `urn:ietf:params:scim:schemas:extension:enterprise:2.0:user`
 * - **Core sub-attrs**:        `urn:...:core:2.0:user.emails`  (children: `primary`, `value`, ...)
 * - **Extension sub-attrs**:   `urn:...:enterprise:2.0:user.manager`  (children: `$ref`, `displayname`, ...)
 * - **Deeper nesting**:        `urn:...:core:2.0:user.name.honorificprefix` (if ever complex)
 *
 * Values are Sets of lowercase child attribute names matching the characteristic.
 *
 * This structure provides:
 * - **Zero collisions**: Core `manager` vs extension `manager` have distinct keys
 * - **Zero per-request cost**: Precomputed once, O(1) lookups at runtime
 * - **Parent-context recursion**: Consumer builds `parentPath` through JSON tree walk
 * - **Arbitrary depth**: Dot-path extends naturally for any nesting level
 *
 * At runtime, the walker starts with `coreSchemaUrn` as the initial parentPath.
 * When it encounters a key starting with `urn:`, it switches to that URN as the
 * new parentPath.  For all other keys, it appends `.${key}` to the current path.
 *
 * @see RFC 7643 §2 - Attribute Characteristics
 * @see docs/SCHEMA_AND_RESOURCETYPE_DATA_STRUCTURE_ANALYSIS.md
 */
export interface SchemaCharacteristicsCache {
  /** Parent → Set of boolean-typed child attribute names */
  booleansByParent: Map<string, Set<string>>;
  /** Parent → Set of returned:'never' or writeOnly child attribute names */
  neverReturnedByParent: Map<string, Set<string>>;
  /** Parent → Set of returned:'always' child attribute names */
  alwaysReturnedByParent: Map<string, Set<string>>;
  /** Parent → Set of returned:'request' child attribute names */
  requestReturnedByParent: Map<string, Set<string>>;
  /** Parent → Set of mutability:'immutable' child attribute names */
  immutableByParent: Map<string, Set<string>>;
  /** Parent → Set of caseExact:true child attribute names */
  caseExactByParent: Map<string, Set<string>>;
  /** Pre-flattened set of caseExact:true attribute paths (lowercase, dotted for sub-attrs) - consumer convenience */
  caseExactPaths: Set<string>;
  /** Unique-server attributes with schema URN context (for JSONB uniqueness) */
  uniqueAttrs: Array<{ schemaUrn: string | null; attrName: string; caseExact: boolean }>;
  /** Extension schema URNs declared on this endpoint's resource types */
  extensionUrns: readonly string[];
  /** The lowercase core schema URN used as the root key in all *ByParent maps */
  coreSchemaUrn: string;
  /** Set of all schema URNs (lowercase) present in the cache for top-level key identification */
  schemaUrnSet: ReadonlySet<string>;
  /** Precomputed core attribute lookup: lowercase name → SchemaAttributeDefinition */
  coreAttrMap: Map<string, SchemaAttributeDefinition>;
  /** Precomputed extension schema lookup: URN → SchemaDefinition */
  extensionSchemaMap: Map<string, SchemaDefinition>;
  /** Parent → Set of mutability:'readOnly' child attribute names */
  readOnlyByParent: Map<string, Set<string>>;
  /** Precomputed readOnly attribute sets - structured shape for stripReadOnlyAttributes */
  readOnlyCollected: {
    core: Set<string>;
    extensions: Map<string, Set<string>>;
    coreSubAttrs: Map<string, Set<string>>;
    extensionSubAttrs: Map<string, Map<string, Set<string>>>;
  };
}

/**
 * Attribute definition shape (mirrors ScimSchemaAttribute from registry).
 * Redefined here to keep the domain layer framework-free.
 */
export interface SchemaAttributeDefinition {
  name: string;
  type: string; // 'string' | 'boolean' | 'decimal' | 'integer' | 'dateTime' | 'reference' | 'complex' | 'binary'
  multiValued: boolean;
  required: boolean;
  mutability?: string; // 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly'
  returned?: string;
  caseExact?: boolean;
  uniqueness?: string;
  canonicalValues?: readonly string[];
  referenceTypes?: readonly string[];
  subAttributes?: readonly SchemaAttributeDefinition[];
}

/**
 * Schema definition (represents one SCIM schema's attribute list).
 */
export interface SchemaDefinition {
  /** Schema URN identifier (e.g. urn:ietf:params:scim:schemas:core:2.0:User) */
  id: string;
  /** Attribute definitions for this schema */
  attributes: readonly SchemaAttributeDefinition[];
  /**
   * When true, this schema is treated as the core schema for the resource type.
   * Core schema attributes live at the top level of the SCIM payload.
   * When omitted, falls back to prefix-based detection (urn:ietf:params:scim:schemas:core:).
   * Set explicitly for custom resource types whose URNs don't use the standard prefix.
   */
  isCoreSchema?: boolean;
}

/**
 * Options controlling how validation is performed.
 */
export interface ValidationOptions {
  /** Whether strict mode is active (unknown attributes → error) */
  strictMode: boolean;
  /** Operation mode - 'create' | 'replace' enforce required attributes; 'patch' does not */
  mode: 'create' | 'replace' | 'patch';
}
