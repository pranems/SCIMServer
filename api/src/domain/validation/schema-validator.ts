/**
 * SchemaValidator — Phase 8: SCIM Payload Validation Engine
 *
 * Pure domain class (zero NestJS/Prisma dependencies) that validates
 * SCIM resource payloads against schema attribute definitions.
 *
 * Validations performed:
 *  1. Required attributes (on create/replace only, not patch)
 *  2. Attribute type checking (string, boolean, integer, decimal, complex, dateTime, reference, binary)
 *  3. Mutability constraints (readOnly attributes rejected on create/replace AND on PATCH operations)
 *  4. Unknown attribute detection (strict mode only)
 *  5. Multi-valued / single-valued enforcement
 *  6. Sub-attribute validation for complex types
 *  7. Canonical value enforcement (V10)
 *  8. Required sub-attribute enforcement (V9)
 *  9. Strict ISO 8601 dateTime format validation (V31)
 * 10. schemas array validation (V25)
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

/**
 * Determine whether a schema definition represents the core schema for a resource type.
 * Core schema attributes live at the top level of the SCIM payload.
 * Extension schema attributes live under the extension URN key.
 *
 * Uses explicit `isCoreSchema` flag when set (for custom resource types),
 * otherwise falls back to the standard SCIM prefix convention.
 */
function isCoreSchema(schema: SchemaDefinition): boolean {
  if (schema.isCoreSchema !== undefined) return schema.isCoreSchema;
  return schema.id.startsWith('urn:ietf:params:scim:schemas:core:');
}

/**
 * xsd:dateTime regex (RFC 7643 §2.3.5).
 * Validates ISO 8601 / xsd:dateTime format:
 *   YYYY-MM-DDTHH:MM:SSZ  or  YYYY-MM-DDTHH:MM:SS.sss±HH:MM
 * Not anchored to allow timezone offset variants.
 */
const XSD_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

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
      if (isCoreSchema(schema)) {
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
    // RFC 7643 §2.2: readOnly attributes are server-assigned and MUST NOT be
    // provided by clients — therefore they are exempt from the required check.
    // Without this exemption, `id` (required:true + mutability:readOnly) would
    // be impossible to satisfy: omitting it fails "required", including it fails
    // "readOnly". The required check still enforces client-writable attributes
    // like userName and displayName.
    if (options.mode !== 'patch') {
      for (const attr of coreAttributes.values()) {
        if (attr.required && attr.mutability !== 'readOnly' && !(this.findKeyIgnoreCase(payload, attr.name))) {
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
            if (attr.required && attr.mutability !== 'readOnly' && !(this.findKeyIgnoreCase(extPayload, attr.name))) {
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

    // ── V25: Validate schemas array ────────────────────────────────────
    if (Array.isArray(payload.schemas)) {
      const knownUrns = new Set<string>();
      for (const s of schemas) {
        knownUrns.add(s.id);
      }
      for (const urn of payload.schemas as unknown[]) {
        if (typeof urn !== 'string') {
          errors.push({
            path: 'schemas',
            message: `Each entry in 'schemas' must be a string.`,
            scimType: 'invalidValue',
          });
        } else if (options.strictMode && !knownUrns.has(urn)) {
          errors.push({
            path: 'schemas',
            message: `Schema URN '${urn}' is not recognized for this resource type.`,
            scimType: 'invalidValue',
          });
        }
      }
    } else if (payload.schemas !== undefined) {
      errors.push({
        path: 'schemas',
        message: `'schemas' must be an array of schema URN strings.`,
        scimType: 'invalidSyntax',
      });
    }

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
        } else if (!XSD_DATETIME_RE.test(value)) {
          // V31: Strict xsd:dateTime format (RFC 7643 §2.3.5)
          errors.push({
            path,
            message: `Attribute '${attrDef.name}' is not a valid xsd:dateTime (expected ISO 8601 format like 2011-08-01T21:32:44.882Z): '${value}'.`,
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

    // ── V10: Canonical values enforcement ────────────────────────────
    // If the attribute defines canonicalValues and the value is a string,
    // verify the value is one of the allowed canonical values (case-insensitive).
    if (
      attrDef.canonicalValues &&
      attrDef.canonicalValues.length > 0 &&
      typeof value === 'string'
    ) {
      const lower = value.toLowerCase();
      const allowed = attrDef.canonicalValues.map(cv => cv.toLowerCase());
      if (!allowed.includes(lower)) {
        errors.push({
          path,
          message: `Attribute '${attrDef.name}' value '${value}' is not one of the canonical values: [${attrDef.canonicalValues.join(', ')}].`,
          scimType: 'invalidValue',
        });
      }
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

    // V9: Required sub-attribute enforcement (create/replace only)
    if (options.mode !== 'patch') {
      for (const sa of subAttrDefs) {
        if (sa.required && !this.findKeyIgnoreCase(obj, sa.name)) {
          errors.push({
            path: `${parentPath}.${sa.name}`,
            message: `Required sub-attribute '${sa.name}' is missing in '${parentPath}'.`,
            scimType: 'invalidValue',
          });
        }
      }
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
   * Check immutable attribute enforcement (RFC 7643 §2.2).
   *
   * Compares two SCIM payloads (existing resource vs incoming/updated resource)
   * and reports errors for any attribute where:
   *  - `mutability === 'immutable'`
   *  - The attribute was previously set (not null/undefined) in the existing resource
   *  - The value has changed in the incoming resource
   *
   * Immutable attributes may be set on creation but MUST NOT be modified thereafter.
   *
   * @param existing  - The current resource payload (before modification)
   * @param incoming  - The new resource payload (after modification / incoming PUT body)
   * @param schemas   - Schema definitions for the resource type
   * @returns ValidationResult with immutability violation errors (if any)
   */
  static checkImmutable(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    schemas: readonly SchemaDefinition[],
  ): ValidationResult {
    const errors: ValidationError[] = [];

    const coreAttributes = new Map<string, SchemaAttributeDefinition>();
    const extensionSchemas = new Map<string, SchemaDefinition>();

    for (const schema of schemas) {
      if (isCoreSchema(schema)) {
        for (const attr of schema.attributes) {
          coreAttributes.set(attr.name.toLowerCase(), attr);
        }
      } else {
        extensionSchemas.set(schema.id, schema);
      }
    }

    // Check core attributes
    for (const [, attrDef] of coreAttributes) {
      this.checkImmutableAttribute(
        attrDef.name,
        existing,
        incoming,
        attrDef,
        errors,
      );
    }

    // Check extension attributes
    for (const [urn, schema] of extensionSchemas) {
      const existingExt = existing[urn] as Record<string, unknown> | undefined;
      const incomingExt = incoming[urn] as Record<string, unknown> | undefined;
      if (!existingExt && !incomingExt) continue;

      for (const attrDef of schema.attributes) {
        this.checkImmutableAttribute(
          `${urn}.${attrDef.name}`,
          existingExt ?? {},
          incomingExt ?? {},
          attrDef,
          errors,
        );
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check a single attribute for immutability violation.
   */
  private static checkImmutableAttribute(
    path: string,
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
    attrDef: SchemaAttributeDefinition,
    errors: ValidationError[],
  ): void {
    if (attrDef.mutability !== 'immutable') {
      // For complex attributes with sub-attributes, check sub-attribute immutability
      if (attrDef.type === 'complex' && attrDef.subAttributes) {
        const hasImmutableSubs = attrDef.subAttributes.some(sa => sa.mutability === 'immutable');
        if (!hasImmutableSubs) return;

        const existingVal = this.getValueIgnoreCase(existing, attrDef.name);
        const incomingVal = this.getValueIgnoreCase(incoming, attrDef.name);

        if (attrDef.multiValued) {
          // Multi-valued complex: compare each matched element's immutable sub-attrs
          this.checkImmutableMultiValuedComplex(
            path, existingVal, incomingVal, attrDef.subAttributes, errors,
          );
        } else if (existingVal && incomingVal &&
                   typeof existingVal === 'object' && typeof incomingVal === 'object') {
          for (const subDef of attrDef.subAttributes) {
            this.checkImmutableAttribute(
              `${path}.${subDef.name}`,
              existingVal as Record<string, unknown>,
              incomingVal as Record<string, unknown>,
              subDef,
              errors,
            );
          }
        }
      }
      return;
    }

    // This attribute IS immutable
    const existingVal = this.getValueIgnoreCase(existing, attrDef.name);
    const incomingVal = this.getValueIgnoreCase(incoming, attrDef.name);

    // Not previously set → allow (first write)
    if (existingVal === null || existingVal === undefined) return;

    // Not present in incoming → allow (attribute not being modified)
    if (incomingVal === undefined) return;

    // Compare values
    if (!this.deepEqual(existingVal, incomingVal)) {
      errors.push({
        path,
        message: `Attribute '${attrDef.name}' is immutable and cannot be changed once set.`,
        scimType: 'mutability',
      });
    }
  }

  /**
   * Check immutable sub-attributes in multi-valued complex arrays.
   * Matches elements by a shared identifier (typically 'value' sub-attribute).
   */
  private static checkImmutableMultiValuedComplex(
    parentPath: string,
    existingVal: unknown,
    incomingVal: unknown,
    subAttributes: readonly SchemaAttributeDefinition[],
    errors: ValidationError[],
  ): void {
    if (!Array.isArray(existingVal) || !Array.isArray(incomingVal)) return;

    const immutableSubs = subAttributes.filter(sa => sa.mutability === 'immutable');

    // Build a lookup of existing elements by 'value' sub-attribute (the standard SCIM identifier)
    const existingMap = new Map<string, Record<string, unknown>>();
    for (const item of existingVal) {
      if (item && typeof item === 'object' && 'value' in item) {
        existingMap.set(String((item as Record<string, unknown>).value), item as Record<string, unknown>);
      }
    }

    for (let i = 0; i < incomingVal.length; i++) {
      const incomingItem = incomingVal[i];
      if (!incomingItem || typeof incomingItem !== 'object') continue;
      const incomingObj = incomingItem as Record<string, unknown>;

      // Try to match with existing element by 'value'
      if ('value' in incomingObj) {
        const matchKey = String(incomingObj.value);
        const existingItem = existingMap.get(matchKey);
        if (existingItem) {
          for (const subDef of immutableSubs) {
            this.checkImmutableAttribute(
              `${parentPath}[${i}].${subDef.name}`,
              existingItem,
              incomingObj,
              subDef,
              errors,
            );
          }
        }
      }
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

  /**
   * Case-insensitive key value retrieval.
   */
  private static getValueIgnoreCase(
    obj: Record<string, unknown>,
    attrName: string,
  ): unknown {
    const lower = attrName.toLowerCase();
    const key = Object.keys(obj).find(k => k.toLowerCase() === lower);
    return key !== undefined ? obj[key] : undefined;
  }

  /**
   * Deep equality comparison for SCIM attribute values.
   */
  private static deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEqual(val, b[i]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const aObj = a as Record<string, unknown>;
      const bObj = b as Record<string, unknown>;
      const aKeys = Object.keys(aObj);
      const bKeys = Object.keys(bObj);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(key => this.deepEqual(aObj[key], bObj[key]));
    }

    return false;
  }

  // ─── V16: Schema-aware Boolean attribute name collection ─────────────

  /**
   * Collect all attribute names whose schema type is "boolean", including
   * sub-attributes of complex types.  The returned Set contains lowercase
   * names so callers can do a case-insensitive check.
   *
   * This is used by `sanitizeBooleanStrings()` in the service layer so that
   * only actual boolean attributes are coerced from string → boolean
   * (prevents corruption of string attributes like `roles[].value = "true"`).
   *
   * @param schemas  Schema definitions (core + extension)
   * @returns Set of lowercase attribute names that are boolean-typed
   */
  static collectBooleanAttributeNames(
    schemas: readonly SchemaDefinition[],
  ): Set<string> {
    const names = new Set<string>();

    const collect = (attrs: readonly SchemaAttributeDefinition[]): void => {
      for (const attr of attrs) {
        if (attr.type === 'boolean') {
          names.add(attr.name.toLowerCase());
        }
        if (attr.subAttributes) {
          collect(attr.subAttributes);
        }
      }
    };

    for (const schema of schemas) {
      collect(schema.attributes);
    }

    return names;
  }

  // ─── V32: Filter attribute path validation ──────────────────────────

  /**
   * Validate that all attribute paths referenced in a parsed filter AST
   * are known in the given schema definitions.
   *
   * Returns validation errors for any unknown attribute paths.
   * Intended for use when StrictSchemaValidation is enabled.
   *
   * @param filterPaths - Array of attribute path strings from the filter AST
   * @param schemas     - Schema definitions for the resource type
   * @returns ValidationResult with errors for unknown paths
   */
  static validateFilterAttributePaths(
    filterPaths: readonly string[],
    schemas: readonly SchemaDefinition[],
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Build attribute lookup
    const coreAttributes = new Map<string, SchemaAttributeDefinition>();
    const extensionSchemas = new Map<string, SchemaDefinition>();
    for (const schema of schemas) {
      if (isCoreSchema(schema)) {
        for (const attr of schema.attributes) {
          coreAttributes.set(attr.name.toLowerCase(), attr);
        }
      } else {
        extensionSchemas.set(schema.id, schema);
      }
    }

    // Also allow meta sub-attributes (resourceType, created, lastModified, location, version)
    const metaSubAttrs = new Set([
      'resourcetype', 'created', 'lastmodified', 'location', 'version',
    ]);

    for (const attrPath of filterPaths) {
      // Reserved/meta paths are always valid
      if (attrPath.toLowerCase() === 'id' ||
          attrPath.toLowerCase() === 'externalid' ||
          attrPath.toLowerCase().startsWith('meta.')) {
        // Validate meta sub-path
        if (attrPath.toLowerCase().startsWith('meta.')) {
          const subPath = attrPath.toLowerCase().slice(5);
          if (!metaSubAttrs.has(subPath)) {
            errors.push({
              path: attrPath,
              message: `Unknown meta sub-attribute '${attrPath}' in filter.`,
              scimType: 'invalidFilter',
            });
          }
        }
        continue;
      }

      // Extension URN paths
      let resolved = false;
      for (const [urn, schema] of extensionSchemas) {
        if (attrPath.startsWith(urn + ':') || attrPath.startsWith(urn + '.')) {
          const remainder = attrPath.slice(urn.length + 1);
          const extAttrMap = new Map<string, SchemaAttributeDefinition>();
          for (const a of schema.attributes) {
            extAttrMap.set(a.name.toLowerCase(), a);
          }
          if (remainder) {
            const segments = remainder.split('.');
            const found = this.walkAttributePath(segments, extAttrMap);
            if (!found) {
              errors.push({
                path: attrPath,
                message: `Unknown attribute '${attrPath}' is not defined in extension schema '${urn}'.`,
                scimType: 'invalidFilter',
              });
            } else if (found.mutability === 'writeOnly') {
              // CROSS-03: writeOnly attributes MUST NOT be used in filter expressions
              // RFC 7643 §2.2: writeOnly attributes are meaningful only in write operations
              errors.push({
                path: attrPath,
                message: `Attribute '${attrPath}' has mutability 'writeOnly' and cannot be used in filter expressions.`,
                scimType: 'invalidFilter',
              });
            }
          }
          resolved = true;
          break;
        }
      }
      if (resolved) continue;

      // Core attribute path
      const segments = attrPath.split('.');
      const found = this.walkAttributePath(segments, coreAttributes);
      if (!found) {
        errors.push({
          path: attrPath,
          message: `Unknown attribute '${attrPath}' is not defined in the schema. Filter references an unrecognized attribute.`,
          scimType: 'invalidFilter',
        });
      } else if (found.mutability === 'writeOnly') {
        // CROSS-03: writeOnly attributes MUST NOT be used in filter expressions
        errors.push({
          path: attrPath,
          message: `Attribute '${attrPath}' has mutability 'writeOnly' and cannot be used in filter expressions.`,
          scimType: 'invalidFilter',
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── V2: PATCH Operation Pre-Validation ──────────────────────────────

  /**
   * Validate a single PATCH operation value BEFORE it is applied by the engine.
   *
   * Resolves the PATCH path to the matching schema attribute definition and
   * validates the operation value against it:
   *  - readOnly mutability check (G8c) — rejects add/replace/remove targeting readOnly attrs
   *  - type checking, canonical values, etc.
   *
   * Does NOT check required (patch mode) or immutable (done post-PATCH by H-2).
   *
   * @param op     - Operation type: 'add' | 'replace' | 'remove'
   * @param path   - SCIM attribute path (e.g. "userName", "name.givenName", "emails[type eq \"work\"].value")
   * @param value  - Operation value (may be object for no-path ops)
   * @param schemas - Schema definitions for the resource type
   * @returns ValidationResult with errors (if any)
   */
  static validatePatchOperationValue(
    op: string,
    path: string | undefined,
    value: unknown,
    schemas: readonly SchemaDefinition[],
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // Build attribute index
    const coreAttributes = new Map<string, SchemaAttributeDefinition>();
    const extensionSchemas = new Map<string, SchemaDefinition>();
    for (const schema of schemas) {
      if (isCoreSchema(schema)) {
        for (const attr of schema.attributes) {
          coreAttributes.set(attr.name.toLowerCase(), attr);
        }
      } else {
        extensionSchemas.set(schema.id, schema);
      }
    }

    const opLower = op.toLowerCase();

    // No path — value is an object whose keys are top-level attributes
    if (!path) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        for (const [key, val] of Object.entries(obj)) {
          if (RESERVED_KEYS.has(key)) continue;
          // Extension blocks
          if (key.startsWith('urn:')) {
            const extSchema = extensionSchemas.get(key);
            if (extSchema && val && typeof val === 'object' && !Array.isArray(val)) {
              // G8c: Check readOnly on extension attributes
              for (const [extKey] of Object.entries(val as Record<string, unknown>)) {
                const extAttrDef = extSchema.attributes.find(
                  a => a.name.toLowerCase() === extKey.toLowerCase(),
                );
                if (extAttrDef?.mutability === 'readOnly') {
                  errors.push({
                    path: `${key}:${extKey}`,
                    message: `Attribute '${extKey}' is readOnly and cannot be modified via PATCH.`,
                    scimType: 'mutability',
                  });
                }
              }
              this.validateAttributes(
                val as Record<string, unknown>,
                extSchema.attributes,
                key,
                { strictMode: false, mode: 'patch' },
                errors,
              );
            }
            continue;
          }
          const attrDef = coreAttributes.get(key.toLowerCase());
          if (attrDef) {
            // G8c: readOnly mutability check for no-path operations
            if (attrDef.mutability === 'readOnly') {
              errors.push({
                path: key,
                message: `Attribute '${attrDef.name}' is readOnly and cannot be modified via PATCH.`,
                scimType: 'mutability',
              });
              continue;
            }
            this.validateAttribute(key, val, attrDef, { strictMode: false, mode: 'patch' }, errors);
          }
        }
      }
      return { valid: errors.length === 0, errors };
    }

    // Resolve the path to its attribute definition
    const attrDef = this.resolvePatchPath(path, coreAttributes, extensionSchemas);

    // G8c: Also check if the ROOT attribute in the path chain is readOnly.
    // e.g. "groups[value eq \"x\"].display" — `groups` is readOnly, so the
    // entire sub-path is unreachable for client writes.
    const rootAttrDef = this.resolveRootAttribute(path, coreAttributes, extensionSchemas);

    if (rootAttrDef?.mutability === 'readOnly') {
      errors.push({
        path,
        message: `Attribute '${rootAttrDef.name}' is readOnly and cannot be ${opLower === 'remove' ? 'removed' : 'modified'} via PATCH.`,
        scimType: 'mutability',
      });
      return { valid: false, errors };
    }

    if (attrDef) {
      // G8c: readOnly mutability pre-check — reject any operation targeting a readOnly attr
      if (attrDef.mutability === 'readOnly') {
        errors.push({
          path,
          message: `Attribute '${attrDef.name}' is readOnly and cannot be ${opLower === 'remove' ? 'removed' : 'modified'} via PATCH.`,
          scimType: 'mutability',
        });
        return { valid: false, errors };
      }

      // For remove ops, skip further value validation (no value expected)
      if (opLower === 'remove') {
        return { valid: true, errors: [] };
      }

      this.validateAttribute(
        path,
        value,
        attrDef,
        { strictMode: false, mode: 'patch' },
        errors,
      );
    } else if (opLower === 'remove') {
      // Remove ops with unresolved paths: no value validation needed
      return { valid: true, errors: [] };
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Resolve a SCIM PATCH path to its attribute definition.
   *
   * Handles formats:
   *  - "attrName" → core attribute
   *  - "attrName.subAttrName" → sub-attribute of complex core attr
   *  - "urn:...:ExtUrn:attrName" → extension attribute
   *  - "attrName[filter]" → multi-valued attribute (returns parent def)
   *  - "attrName[filter].subAttr" → sub-attribute via value filter
   */
  private static resolvePatchPath(
    path: string,
    coreAttributes: Map<string, SchemaAttributeDefinition>,
    extensionSchemas: Map<string, SchemaDefinition>,
  ): SchemaAttributeDefinition | undefined {
    // Strip value filter (e.g., emails[type eq "work"].value → emails.value)
    const cleanPath = path.replace(/\[.*?\]/g, '');

    // Check for extension URN prefix
    for (const [urn, schema] of extensionSchemas) {
      if (cleanPath.startsWith(urn + ':') || cleanPath.startsWith(urn + '.')) {
        const remainder = cleanPath.slice(urn.length + 1);
        const extAttrMap = new Map<string, SchemaAttributeDefinition>();
        for (const a of schema.attributes) {
          extAttrMap.set(a.name.toLowerCase(), a);
        }
        if (!remainder) return undefined;
        const segments = remainder.split('.');
        return this.walkAttributePath(segments, extAttrMap);
      }
    }

    // Core attribute path
    const segments = cleanPath.split('.');
    return this.walkAttributePath(segments, coreAttributes);
  }

  /**
   * Walk a dot-separated path through an attribute hierarchy.
   */
  private static walkAttributePath(
    segments: string[],
    attrMap: Map<string, SchemaAttributeDefinition>,
  ): SchemaAttributeDefinition | undefined {
    if (segments.length === 0) return undefined;

    const attrDef = attrMap.get(segments[0].toLowerCase());
    if (!attrDef) return undefined;
    if (segments.length === 1) return attrDef;

    // Walk into sub-attributes
    if (attrDef.subAttributes && attrDef.subAttributes.length > 0) {
      const subMap = new Map<string, SchemaAttributeDefinition>();
      for (const sa of attrDef.subAttributes) {
        subMap.set(sa.name.toLowerCase(), sa);
      }
      return this.walkAttributePath(segments.slice(1), subMap);
    }

    return undefined;
  }

  // ─── G8e: Returned characteristic collection ──────────────────────

  /**
   * Collect attribute names grouped by their `returned` characteristic.
   *
   * Per RFC 7643 §2.4:
   *  - `never`   — MUST NOT be returned in any response
   *  - `request` — returned only when explicitly requested via `attributes` param
   *  - `always`  — always included in responses (id, schemas, meta, etc.)
   *  - `default` — returned by default, excludable via `excludedAttributes`
   *
   * @param schemas  Core + extension schema definitions
   * @returns Object with `never` and `request` sets of lowercase attribute names
   */
  static collectReturnedCharacteristics(
    schemas: readonly SchemaDefinition[],
  ): { never: Set<string>; request: Set<string>; always: Set<string>; alwaysSubs: Map<string, Set<string>> } {
    const never = new Set<string>();
    const request = new Set<string>();
    const always = new Set<string>();
    // R-RET-3: Sub-attr returned:'always' — map of parentAttrLower → Set<subAttrNameLower>
    const alwaysSubs = new Map<string, Set<string>>();

    const collect = (attrs: readonly SchemaAttributeDefinition[], parentName?: string): void => {
      for (const attr of attrs) {
        const returned = attr.returned?.toLowerCase();
        const mutability = attr.mutability?.toLowerCase();
        if (returned === 'never') {
          never.add(attr.name.toLowerCase());
        } else if (returned === 'request') {
          request.add(attr.name.toLowerCase());
        } else if (returned === 'always') {
          if (parentName) {
            // R-RET-3: Sub-attribute with returned:'always'
            if (!alwaysSubs.has(parentName)) {
              alwaysSubs.set(parentName, new Set());
            }
            alwaysSubs.get(parentName)!.add(attr.name.toLowerCase());
          } else {
            always.add(attr.name.toLowerCase());
          }
        }
        // R-MUT-1: writeOnly mutability implies returned:never as defense-in-depth
        // Even if returned is not explicitly 'never', writeOnly values MUST NOT appear in responses
        if (mutability === 'writeonly') {
          never.add(attr.name.toLowerCase());
        }
        // Sub-attributes inherit parent returned if not specified,
        // but individual sub-attrs can override — collect those too
        if (attr.subAttributes) {
          collect(attr.subAttributes, attr.name.toLowerCase());
        }
      }
    };

    for (const schema of schemas) {
      collect(schema.attributes);
    }

    return { never, request, always, alwaysSubs };
  }

  // ─── CaseExact attribute collection (R-CASE-1) ───────────────────

  /**
   * Collect all attribute names/paths with `caseExact: true` from the schemas.
   * Returns a Set of lowercase attribute paths (e.g., 'id', 'meta.location', 'emails.value').
   * Sub-attributes use dotted path notation: 'parentAttr.subAttr'.
   *
   * Used by in-memory filter evaluation to determine case-sensitive comparison.
   *
   * @param schemas  Core + extension schema definitions
   * @returns Set of lowercase paths for caseExact:true attributes
   */
  static collectCaseExactAttributes(
    schemas: readonly SchemaDefinition[],
  ): Set<string> {
    const result = new Set<string>();

    const collect = (attrs: readonly SchemaAttributeDefinition[], prefix = ''): void => {
      for (const attr of attrs) {
        const fullPath = prefix ? `${prefix}.${attr.name.toLowerCase()}` : attr.name.toLowerCase();
        if (attr.caseExact === true) {
          result.add(fullPath);
        }
        if (attr.subAttributes) {
          collect(attr.subAttributes, attr.name.toLowerCase());
        }
      }
    };

    for (const schema of schemas) {
      collect(schema.attributes);
    }

    return result;
  }

  // ─── ReadOnly attribute collection (for strip helpers) ────────────

  /**
   * Collect all top-level attribute names with `mutability: 'readOnly'`
   * from core + extension schemas. Returns lowercase names grouped by
   * schema (core attrs at top level, extension attrs keyed by URN).
   *
   * Used by `stripReadOnlyAttributes()` to remove client-supplied readOnly
   * attributes before storage per RFC 7643 §2.2.
   *
   * @param schemas  Core + extension schema definitions
   * @returns Object with `core` Set of lowercase readOnly core attr names
   *          and `extensions` Map of URN → Set of lowercase readOnly attr names
   */
  static collectReadOnlyAttributes(
    schemas: readonly SchemaDefinition[],
  ): { core: Set<string>; extensions: Map<string, Set<string>>; coreSubAttrs: Map<string, Set<string>>; extensionSubAttrs: Map<string, Map<string, Set<string>>> } {
    const core = new Set<string>();
    const extensions = new Map<string, Set<string>>();
    // R-MUT-2: readOnly sub-attrs within readWrite parents (dotted paths)
    const coreSubAttrs = new Map<string, Set<string>>();
    const extensionSubAttrs = new Map<string, Map<string, Set<string>>>();

    for (const schema of schemas) {
      if (isCoreSchema(schema)) {
        for (const attr of schema.attributes) {
          if (attr.mutability === 'readOnly') {
            core.add(attr.name.toLowerCase());
          } else if (attr.subAttributes) {
            // R-MUT-2: Collect readOnly sub-attrs within non-readOnly parents
            for (const sub of attr.subAttributes) {
              if (sub.mutability === 'readOnly') {
                const parentKey = attr.name.toLowerCase();
                if (!coreSubAttrs.has(parentKey)) {
                  coreSubAttrs.set(parentKey, new Set());
                }
                coreSubAttrs.get(parentKey)!.add(sub.name.toLowerCase());
              }
            }
          }
        }
      } else {
        const extSet = new Set<string>();
        const extSubMap = new Map<string, Set<string>>();
        for (const attr of schema.attributes) {
          if (attr.mutability === 'readOnly') {
            extSet.add(attr.name.toLowerCase());
          } else if (attr.subAttributes) {
            for (const sub of attr.subAttributes) {
              if (sub.mutability === 'readOnly') {
                const parentKey = attr.name.toLowerCase();
                if (!extSubMap.has(parentKey)) {
                  extSubMap.set(parentKey, new Set());
                }
                extSubMap.get(parentKey)!.add(sub.name.toLowerCase());
              }
            }
          }
        }
        if (extSet.size > 0) {
          extensions.set(schema.id, extSet);
        }
        if (extSubMap.size > 0) {
          extensionSubAttrs.set(schema.id, extSubMap);
        }
      }
    }

    return { core, extensions, coreSubAttrs, extensionSubAttrs };
  }

  // ─── G8c: PATCH path utilities ────────────────────────────────────

  private static resolveRootAttribute(
    path: string,
    coreAttributes: Map<string, SchemaAttributeDefinition>,
    extensionSchemas: Map<string, SchemaDefinition>,
  ): SchemaAttributeDefinition | undefined {
    // Strip value filters
    const cleanPath = path.replace(/\[.*?\]/g, '');

    // Extension URN prefix → root is the first extension attribute
    for (const [urn, schema] of extensionSchemas) {
      if (cleanPath.startsWith(urn + ':') || cleanPath.startsWith(urn + '.')) {
        const remainder = cleanPath.slice(urn.length + 1);
        if (!remainder) return undefined;
        const rootName = remainder.split('.')[0];
        return schema.attributes.find(
          a => a.name.toLowerCase() === rootName.toLowerCase(),
        );
      }
    }

    // Core attribute — first segment
    const rootName = cleanPath.split('.')[0];
    return coreAttributes.get(rootName.toLowerCase());
  }
}
