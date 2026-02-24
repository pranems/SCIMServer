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
 * Result of schema validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
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
