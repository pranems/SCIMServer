/**
 * Schema Validation Types — Phase 8
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
 * @see RFC 7643 §2.2 — readOnly attributes MAY be sent but SHALL be ignored
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
  /** Operation mode — 'create' | 'replace' enforce required attributes; 'patch' does not */
  mode: 'create' | 'replace' | 'patch';
}
