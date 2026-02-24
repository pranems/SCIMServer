/**
 * SchemaValidator — Phase 8: SCIM Payload Validation Engine
 *
 * Pure domain class (zero NestJS/Prisma dependencies) that validates
 * SCIM resource payloads against schema attribute definitions.
 *
 * Validations performed:
 *  1. Required attributes (on create/replace only, not patch)
 *  2. Attribute type checking (string, boolean, integer, decimal, complex, dateTime, reference, binary)
 *  3. Mutability constraints (readOnly attributes should not be set by client on create/replace)
 *  4. Unknown attribute detection (strict mode only)
 *  5. Multi-valued / single-valued enforcement
 *  6. Sub-attribute validation for complex types
 *
 * @see RFC 7643 §2.1 — Attribute Characteristics
 * @see RFC 7643 §7 — Schema Definition
 */

import type {
  SchemaAttributeDefinition,
  SchemaDefinition,
  ValidationError,
  ValidationOptions,
  ValidationResult,
} from './validation-types';

/**
 * Reserved top-level SCIM keys that are never user-defined attributes.
 * These are excluded from unknown-attribute detection.
 */
const RESERVED_KEYS = new Set([
  'schemas',
  'id',
  'externalId',
  'meta',
]);

export class SchemaValidator {
  /**
   * Validate a SCIM payload against one or more schema definitions.
   *
   * @param payload - The incoming request body (top-level SCIM object)
   * @param schemas - Array of schema definitions applicable to this resource
   *                  (core schema + any extension schemas)
   * @param options - Controls strict mode, operation mode
   * @returns ValidationResult with errors (if any)
   */
  static validate(
    payload: Record<string, unknown>,
    schemas: readonly SchemaDefinition[],
    options: ValidationOptions,
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Build a unified lookup of attribute name → definition, keyed by lowercase name.
    // Core schema attributes are merged at top level.
    // Extension schema attributes are available under their URN key.
    const coreAttributes = new Map<string, SchemaAttributeDefinition>();
    const extensionSchemas = new Map<string, SchemaDefinition>();

    for (const schema of schemas) {
      if (schema.id.startsWith('urn:ietf:params:scim:schemas:core:')) {
        // Core schema: attributes live at the top level of the payload
        for (const attr of schema.attributes) {
          coreAttributes.set(attr.name.toLowerCase(), attr);
        }
      } else {
        // Extension schema: attributes live under the URN key
        extensionSchemas.set(schema.id, schema);
      }
    }

    // ── 1. Required attribute check (create/replace only) ──────────────
    if (options.mode !== 'patch') {
      for (const attr of coreAttributes.values()) {
        if (attr.required && !(this.findKeyIgnoreCase(payload, attr.name))) {
          errors.push({
            path: attr.name,
            message: `Required attribute '${attr.name}' is missing.`,
            scimType: 'invalidValue',
          });
        }
      }

      // Check required extension attributes
      for (const [urn, schema] of extensionSchemas) {
        const extPayload = payload[urn] as Record<string, unknown> | undefined;
        // Extension schemas with required attributes only apply if the extension block exists
        // OR if the extension itself is marked as required on the resource type
        if (extPayload && typeof extPayload === 'object') {
          for (const attr of schema.attributes) {
            if (attr.required && !(this.findKeyIgnoreCase(extPayload, attr.name))) {
              errors.push({
                path: `${urn}.${attr.name}`,
                message: `Required attribute '${attr.name}' is missing in extension '${urn}'.`,
                scimType: 'invalidValue',
              });
            }
          }
        }
      }
    }

    // ── 2-5. Per-attribute validation (type, mutability, unknown) ───────
    for (const [key, value] of Object.entries(payload)) {
      // Skip reserved SCIM keys
      if (RESERVED_KEYS.has(key)) continue;

      // Extension URN blocks are validated separately
      if (key.startsWith('urn:')) {
        const extSchema = extensionSchemas.get(key);
        if (!extSchema) {
          // Unknown extension URN in strict mode → already handled by enforceStrictSchemaValidation
          continue;
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          this.validateAttributes(
            value as Record<string, unknown>,
            extSchema.attributes,
            key,
            options,
            errors,
          );
        }
        continue;
      }

      // Core attribute
      const attrDef = coreAttributes.get(key.toLowerCase());

      if (!attrDef) {
        if (options.strictMode) {
          errors.push({
            path: key,
            message: `Unknown attribute '${key}' is not defined in the schema. Rejected in strict mode.`,
            scimType: 'invalidSyntax',
          });
        }
        continue;
      }

      this.validateAttribute(key, value, attrDef, options, errors);
    }

    // Validate extension block attributes
    for (const [urn, schema] of extensionSchemas) {
      const extPayload = payload[urn] as Record<string, unknown> | undefined;
      if (extPayload && typeof extPayload === 'object' && !Array.isArray(extPayload)) {
        this.validateAttributes(extPayload, schema.attributes, urn, options, errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate all attributes in a nested object (e.g., an extension block).
   */
  private static validateAttributes(
    obj: Record<string, unknown>,
    attrDefs: readonly SchemaAttributeDefinition[],
    pathPrefix: string,
    options: ValidationOptions,
    errors: ValidationError[],
  ): void {
    const attrMap = new Map<string, SchemaAttributeDefinition>();
    for (const a of attrDefs) {
      attrMap.set(a.name.toLowerCase(), a);
    }

    for (const [key, value] of Object.entries(obj)) {
      const attrDef = attrMap.get(key.toLowerCase());
      if (!attrDef) {
        if (options.strictMode) {
          errors.push({
            path: `${pathPrefix}.${key}`,
            message: `Unknown attribute '${key}' is not defined in extension schema '${pathPrefix}'.`,
            scimType: 'invalidSyntax',
          });
        }
        continue;
      }
      this.validateAttribute(`${pathPrefix}.${key}`, value, attrDef, options, errors);
    }
  }

  /**
   * Validate a single attribute value against its definition.
   */
  private static validateAttribute(
    path: string,
    value: unknown,
    attrDef: SchemaAttributeDefinition,
    options: ValidationOptions,
    errors: ValidationError[],
  ): void {
    // Null/undefined values are valid (means "not set") — required check is done separately
    if (value === null || value === undefined) return;

    // ── Mutability check ──
    if (attrDef.mutability === 'readOnly' && (options.mode === 'create' || options.mode === 'replace')) {
      errors.push({
        path,
        message: `Attribute '${attrDef.name}' is readOnly and cannot be set by the client.`,
        scimType: 'mutability',
      });
      return; // Don't further validate readOnly attributes set by client
    }

    // ── Multi-valued check ──
    if (attrDef.multiValued) {
      if (!Array.isArray(value)) {
        errors.push({
          path,
          message: `Attribute '${attrDef.name}' is multi-valued and must be an array.`,
          scimType: 'invalidSyntax',
        });
        return;
      }
      // Validate each element
      for (let i = 0; i < value.length; i++) {
        this.validateSingleValue(`${path}[${i}]`, value[i], attrDef, options, errors);
      }
      return;
    }

    // Single-valued but got array
    if (Array.isArray(value)) {
      errors.push({
        path,
        message: `Attribute '${attrDef.name}' is single-valued but received an array.`,
        scimType: 'invalidSyntax',
      });
      return;
    }

    this.validateSingleValue(path, value, attrDef, options, errors);
  }

  /**
   * Validate a single (non-array) value against its attribute type.
   */
  private static validateSingleValue(
    path: string,
    value: unknown,
    attrDef: SchemaAttributeDefinition,
    options: ValidationOptions,
    errors: ValidationError[],
  ): void {
    if (value === null || value === undefined) return;

    switch (attrDef.type) {
      case 'string':
      case 'reference':
      case 'binary':
        if (typeof value !== 'string') {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be a string, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be a boolean, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
        }
        break;

      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be an integer, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
        }
        break;

      case 'decimal':
        if (typeof value !== 'number') {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be a number, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
        }
        break;

      case 'dateTime':
        if (typeof value !== 'string') {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be a dateTime string, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
        }
        // Basic ISO 8601 validation
        if (typeof value === 'string' && isNaN(Date.parse(value))) {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' is not a valid dateTime: '${value}'.`,
            scimType: 'invalidValue',
          });
        }
        break;

      case 'complex':
        if (typeof value !== 'object' || Array.isArray(value)) {
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' must be a complex object, got ${typeof value}.`,
            scimType: 'invalidValue',
          });
          break;
        }
        // Recursively validate sub-attributes if defined
        if (attrDef.subAttributes && attrDef.subAttributes.length > 0) {
          this.validateSubAttributes(
            path,
            value as Record<string, unknown>,
            attrDef.subAttributes,
            options,
            errors,
          );
        }
        break;

      default:
        // Unknown type — skip validation (forward-compatible)
        break;
    }
  }

  /**
   * Validate sub-attributes of a complex attribute.
   */
  private static validateSubAttributes(
    parentPath: string,
    obj: Record<string, unknown>,
    subAttrDefs: readonly SchemaAttributeDefinition[],
    options: ValidationOptions,
    errors: ValidationError[],
  ): void {
    const subMap = new Map<string, SchemaAttributeDefinition>();
    for (const sa of subAttrDefs) {
      subMap.set(sa.name.toLowerCase(), sa);
    }

    for (const [key, value] of Object.entries(obj)) {
      const subDef = subMap.get(key.toLowerCase());
      if (!subDef) {
        if (options.strictMode) {
          errors.push({
            path: `${parentPath}.${key}`,
            message: `Unknown sub-attribute '${key}' in complex attribute.`,
            scimType: 'invalidSyntax',
          });
        }
        continue;
      }
      // Sub-attributes are always single-valued in SCIM (multi-valued applies at the parent level)
      this.validateSingleValue(`${parentPath}.${key}`, value, subDef, options, errors);
    }
  }

  /**
   * Case-insensitive key existence check — SCIM attribute names are case-insensitive.
   */
  private static findKeyIgnoreCase(
    obj: Record<string, unknown>,
    attrName: string,
  ): boolean {
    const lower = attrName.toLowerCase();
    return Object.keys(obj).some(k => k.toLowerCase() === lower);
  }
}
