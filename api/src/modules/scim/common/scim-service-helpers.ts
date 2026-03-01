/**
 * Shared SCIM Service Helpers (G17 — Service Deduplication)
 *
 * Extracts duplicate private methods from EndpointScimUsersService and
 * EndpointScimGroupsService into reusable pure functions and a
 * parameterized SchemaHelpers class.
 *
 * @see RFC 7643 §2.1 — Attribute Characteristics
 * @see RFC 7644 §3.14 — ETag/If-Match
 * @see RFC 7644 §3.6 — Soft Delete Guard
 */

import { createScimError } from './scim-errors';
import { assertIfMatch } from '../interceptors/scim-etag.interceptor';
import {
  getConfigBoolean,
  getConfigBooleanWithDefault,
  ENDPOINT_CONFIG_FLAGS,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import type { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { SchemaValidator } from '../../../domain/validation';
import type { SchemaDefinition, SchemaAttributeDefinition } from '../../../domain/validation';
import type { ScimLogger } from '../../logging/scim-logger.service';
import type { LogCategory } from '../../logging/log-levels';
import type { PatchOperation } from '../../../domain/patch/patch-types';

// ─── Pure Utility Functions ─────────────────────────────────────────────────

/**
 * Safely parse JSON, returning an empty object on failure.
 */
export function parseJson<T>(value: string | null | undefined): T {
  if (!value) {
    return {} as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Validate that a required SCIM schema URN is present in the request's schemas[] array.
 * Case-insensitive comparison per RFC 7643 §3.1.
 */
export function ensureSchema(schemas: string[] | undefined, requiredSchema: string): void {
  const requiredLower = requiredSchema.toLowerCase();
  if (!schemas || !schemas.some((s) => s.toLowerCase() === requiredLower)) {
    throw createScimError({
      status: 400,
      scimType: 'invalidSyntax',
      detail: `Missing required schema '${requiredSchema}'.`,
    });
  }
}

/**
 * Phase 7: Pre-write If-Match enforcement (RFC 7644 §3.14).
 *
 * When the client sends an If-Match header, the resource's current version-based
 * ETag must match — otherwise 412 Precondition Failed is thrown BEFORE the write.
 * When RequireIfMatch is enabled, a missing If-Match header → 428 Precondition Required.
 */
export function enforceIfMatch(
  currentVersion: number,
  ifMatch?: string,
  config?: EndpointConfig,
): void {
  const requireIfMatch = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.REQUIRE_IF_MATCH);

  if (!ifMatch) {
    if (requireIfMatch) {
      throw createScimError({
        status: 428,
        detail:
          'If-Match header is required for this operation. Include the resource ETag (e.g., If-Match: W/"v1").',
      });
    }
    return;
  }

  const currentETag = `W/"v${currentVersion}"`;
  assertIfMatch(currentETag, ifMatch);
}

/**
 * Recursively sanitize boolean-like string values ("True"/"False") to actual booleans,
 * but ONLY for attributes whose schema type is "boolean".
 *
 * V16/V17 fix: Only converts declared boolean attribute names (e.g. "active", "primary")
 * to prevent corrupting string attributes like roles[].value = "true".
 *
 * Microsoft Entra ID sends primary as string "True" but the SCIM spec expects boolean true.
 *
 * @param obj          - The object to sanitize (mutated in place)
 * @param booleanKeys  - Set of lowercase attribute names that are type "boolean"
 */
export function sanitizeBooleanStrings(
  obj: Record<string, unknown>,
  booleanKeys: Set<string>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          sanitizeBooleanStrings(item as Record<string, unknown>, booleanKeys);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      sanitizeBooleanStrings(value as Record<string, unknown>, booleanKeys);
    } else if (typeof value === 'string' && booleanKeys.has(key.toLowerCase())) {
      const lower = value.toLowerCase();
      if (lower === 'true') obj[key] = true;
      else if (lower === 'false') obj[key] = false;
    }
  }
}

/**
 * RFC 7644 §3.6: Guard against operations on soft-deleted resources.
 *
 * When SoftDeleteEnabled is active, a resource with deletedAt set is considered
 * deleted and MUST return 404 for all subsequent operations (GET, PATCH, PUT, DELETE).
 * Note: A resource disabled via PATCH (active=false) is NOT soft-deleted — only DELETE sets deletedAt.
 */
export function guardSoftDeleted(
  record: { deletedAt?: Date | null },
  config: EndpointConfig | undefined,
  scimId: string,
  logger: ScimLogger,
  logCategory: LogCategory,
): void {
  const softDelete = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.SOFT_DELETE_ENABLED);
  if (softDelete && record.deletedAt != null) {
    logger.debug(logCategory, 'Soft-deleted resource accessed — returning 404', { scimId });
    throw createScimError({
      status: 404,
      scimType: 'noTarget',
      detail: `Resource ${scimId} not found.`,
    });
  }
}

// ─── ReadOnly Attribute Stripping (RFC 7643 §2.2) ───────────────────────────

/**
 * Warning URN for readOnly attribute stripping notifications.
 * Attached to responses when IncludeWarningAboutIgnoredReadOnlyAttribute is enabled.
 */
export const SCIM_WARNING_URN = 'urn:scimserver:api:messages:2.0:Warning';

/**
 * Strip readOnly top-level attributes from a POST/PUT payload.
 *
 * Walks core + extension schemas, finds attributes with `mutability: 'readOnly'`,
 * and deletes matching keys from the payload using case-insensitive matching.
 *
 * Note: `id` and `meta` are also handled here (both are readOnly). `externalId` is
 * readWrite and is never stripped. `schemas` is a reserved structural key and is
 * also never stripped.
 *
 * Sub-attribute stripping (e.g. manager.displayName inside readWrite parent) is
 * deferred to Phase 2.
 *
 * @param payload           - The request body (mutated in place)
 * @param schemaDefinitions - Core + extension schema definitions
 * @returns Array of stripped attribute names (for logging/warning)
 *
 * @see RFC 7643 §2.2 — readOnly attributes SHALL be ignored by the server
 */
export function stripReadOnlyAttributes(
  payload: Record<string, unknown>,
  schemaDefinitions: readonly SchemaDefinition[],
): string[] {
  const { core, extensions } = SchemaValidator.collectReadOnlyAttributes(schemaDefinitions);
  const stripped: string[] = [];

  // Strip core readOnly attributes (case-insensitive)
  for (const key of Object.keys(payload)) {
    // Never strip 'schemas' — it's structural, not a user attribute
    if (key.toLowerCase() === 'schemas') continue;

    if (core.has(key.toLowerCase())) {
      delete payload[key];
      stripped.push(key);
    }
  }

  // Strip readOnly attributes inside extension URN blocks
  for (const [urn, readOnlySet] of extensions) {
    // Find the extension block in the payload (case-insensitive URN matching)
    const urnKey = Object.keys(payload).find(k => k.toLowerCase() === urn.toLowerCase());
    if (!urnKey) continue;

    const extObj = payload[urnKey];
    if (typeof extObj !== 'object' || extObj === null || Array.isArray(extObj)) continue;

    for (const extKey of Object.keys(extObj as Record<string, unknown>)) {
      if (readOnlySet.has(extKey.toLowerCase())) {
        delete (extObj as Record<string, unknown>)[extKey];
        stripped.push(`${urnKey}.${extKey}`);
      }
    }
  }

  return stripped;
}

/**
 * Filter PATCH operations that target readOnly attributes.
 *
 * Removes operations whose target attribute is `mutability: 'readOnly'`.
 * Operations targeting `id` are NEVER stripped — they are kept so G8c can
 * hard-reject them with 400 (id modification must always fail).
 *
 * Handles three PATCH operation forms:
 * 1. Path-based ops (`path: "groups"`) — resolve path → check readOnly
 * 2. No-path ops with object value — check each key in value object
 * 3. Extension URN path ops (`path: "urn:...extensionAttr"`)
 *
 * @param operations        - Array of PATCH operations (not mutated)
 * @param schemaDefinitions - Core + extension schema definitions
 * @returns Object with `filtered` operations (readOnly removed) and `stripped` attribute names
 */
export function stripReadOnlyPatchOps(
  operations: PatchOperation[],
  schemaDefinitions: readonly SchemaDefinition[],
): { filtered: PatchOperation[]; stripped: string[] } {
  const { core, extensions } = SchemaValidator.collectReadOnlyAttributes(schemaDefinitions);
  const stripped: string[] = [];
  const filtered: PatchOperation[] = [];

  // Build a combined lookup for extension URN resolution
  const extensionSchemaMap = new Map<string, SchemaDefinition>();
  for (const schema of schemaDefinitions) {
    if (!schema.id.startsWith('urn:ietf:params:scim:schemas:core:')) {
      extensionSchemaMap.set(schema.id.toLowerCase(), schema);
    }
  }

  for (const op of operations) {
    if (op.path) {
      // Path-based operation — resolve the target attribute
      const targetAttr = resolvePathToAttrName(op.path, extensionSchemaMap);

      // NEVER strip operations targeting 'id' — let G8c hard-reject
      if (targetAttr.toLowerCase() === 'id') {
        filtered.push(op);
        continue;
      }

      // Check if the target is a readOnly core attribute
      if (core.has(targetAttr.toLowerCase())) {
        stripped.push(targetAttr);
        continue; // Skip this operation
      }

      // Check if the target is a readOnly extension attribute
      let isReadOnly = false;
      for (const [urn, readOnlySet] of extensions) {
        // Extension path: "urn:...:attrName" or just "attrName" in extension block
        if (op.path.toLowerCase().startsWith(urn.toLowerCase())) {
          const remainder = op.path.slice(urn.length + 1).replace(/\[.*?\]/g, '').split('.')[0];
          if (remainder && readOnlySet.has(remainder.toLowerCase())) {
            stripped.push(`${urn}.${remainder}`);
            isReadOnly = true;
            break;
          }
        }
      }

      if (!isReadOnly) {
        filtered.push(op);
      }
    } else if (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
      // No-path operation — check each key in the value object
      const valueObj = { ...(op.value as Record<string, unknown>) };
      let modified = false;

      for (const key of Object.keys(valueObj)) {
        // Never strip 'id' — let G8c reject
        if (key.toLowerCase() === 'id') continue;

        if (core.has(key.toLowerCase())) {
          delete valueObj[key];
          stripped.push(key);
          modified = true;
        }

        // Check extension URN blocks in no-path value
        if (key.startsWith('urn:')) {
          for (const [urn, readOnlySet] of extensions) {
            if (key.toLowerCase() === urn.toLowerCase()) {
              const extVal = valueObj[key];
              if (typeof extVal === 'object' && extVal !== null && !Array.isArray(extVal)) {
                const extObj = { ...(extVal as Record<string, unknown>) };
                for (const extKey of Object.keys(extObj)) {
                  if (readOnlySet.has(extKey.toLowerCase())) {
                    delete extObj[extKey];
                    stripped.push(`${key}.${extKey}`);
                    modified = true;
                  }
                }
                if (Object.keys(extObj).length === 0) {
                  delete valueObj[key];
                } else {
                  valueObj[key] = extObj;
                }
              }
            }
          }
        }
      }

      // Only include the operation if there are remaining keys
      if (Object.keys(valueObj).length > 0) {
        filtered.push(modified ? { ...op, value: valueObj } : op);
      } else {
        // All keys were readOnly — entire operation is stripped
      }
    } else {
      // Non-object value or array value — keep as-is
      filtered.push(op);
    }
  }

  return { filtered, stripped };
}

/**
 * Resolve a PATCH operation path to the root attribute name.
 * Strips value filters and sub-attribute paths.
 * Handles extension URN-prefixed paths.
 */
function resolvePathToAttrName(
  path: string,
  extensionSchemas: Map<string, SchemaDefinition>,
): string {
  // Strip value filters like [value eq "abc"]
  const clean = path.replace(/\[.*?\]/g, '');

  // Extension URN prefix
  for (const [urnLower] of extensionSchemas) {
    if (clean.toLowerCase().startsWith(urnLower + ':') || clean.toLowerCase().startsWith(urnLower + '.')) {
      const remainder = clean.slice(urnLower.length + 1);
      return remainder.split('.')[0] || clean;
    }
  }

  // Core attribute — first segment
  return clean.split('.')[0];
}

// ─── Schema-Aware Helpers (parameterized by core schema URN) ────────────────

/**
 * Provides parameterized helpers that depend on a SchemaRegistry and a
 * core schema URN (e.g. SCIM_CORE_USER_SCHEMA or SCIM_CORE_GROUP_SCHEMA).
 *
 * Instantiate once per service in the constructor:
 * ```ts
 * this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_USER_SCHEMA);
 * ```
 */
export class ScimSchemaHelpers {
  constructor(
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly coreSchemaUrn: string,
  ) {}

  /**
   * Strict Schema Validation — when StrictSchemaValidation is enabled, reject
   * any request body that contains extension URN keys not listed in the
   * request's `schemas[]` array or not registered in the schema registry.
   *
   * RFC 7643 §3.1: "The 'schemas' attribute is a REQUIRED attribute and is an
   * array of Strings containing URIs that are used to indicate the namespaces
   * of the SCIM schemas."
   */
  enforceStrictSchemaValidation(
    dto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    const declaredLower = new Set(declaredSchemas.map((s) => s.toLowerCase()));
    const registeredUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    const registeredLower = new Set(registeredUrns.map((u) => u.toLowerCase()));

    for (const key of Object.keys(dto)) {
      if (key.startsWith('urn:')) {
        const keyLower = key.toLowerCase();
        if (!declaredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidSyntax',
            detail:
              `Extension URN "${key}" found in request body but not declared in schemas[]. ` +
              `When StrictSchemaValidation is enabled, all extension URNs must be listed in the schemas array.`,
          });
        }
        if (!registeredLower.has(keyLower)) {
          throw createScimError({
            status: 400,
            scimType: 'invalidValue',
            detail:
              `Extension URN "${key}" is not a registered extension schema for this endpoint. ` +
              `Registered extensions: [${registeredUrns.join(', ')}].`,
          });
        }
      }
    }
  }

  /**
   * Phase 8: Attribute-level payload validation against schema definitions.
   *
   * When StrictSchemaValidation is enabled, validates:
   *  - Required attributes are present (create/replace only)
   *  - Attribute types match schema definitions
   *  - Mutability constraints (readOnly rejection)
   *  - Unknown attributes in strict mode
   *  - Multi-valued / single-valued enforcement
   *  - Sub-attribute validation for complex types
   *
   * @see RFC 7643 §2.1 — Attribute Characteristics
   */
  validatePayloadSchema(
    dto: Record<string, unknown>,
    endpointId: string,
    config: EndpointConfig | undefined,
    mode: 'create' | 'replace' | 'patch',
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(dto, endpointId);
    if (schemas.length === 0) return;

    const result = SchemaValidator.validate(dto, schemas, {
      strictMode: true,
      mode,
    });

    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: result.errors[0]?.scimType ?? 'invalidValue',
        detail: `Schema validation failed: ${details}`,
      });
    }
  }

  /**
   * Build schema definitions from the registry for a given payload.
   * Includes the core schema + any extension URNs declared in schemas[].
   */
  buildSchemaDefinitions(
    dto: Record<string, unknown>,
    endpointId: string,
  ): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(this.coreSchemaUrn, endpointId);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) {
      schemas.push(coreSchema as SchemaDefinition);
    }

    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    for (const urn of declaredSchemas) {
      if (urn !== this.coreSchemaUrn) {
        const extSchema = this.schemaRegistry.getSchema(urn, endpointId);
        if (extSchema) {
          schemas.push(extSchema as SchemaDefinition);
        }
      }
    }

    return schemas;
  }

  /**
   * Get all schema definitions (core + registered extensions) for the endpoint.
   */
  getSchemaDefinitions(endpointId?: string): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(this.coreSchemaUrn, endpointId);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) schemas.push(coreSchema as SchemaDefinition);
    const extUrns = this.schemaRegistry.getExtensionUrns(endpointId);
    for (const urn of extUrns) {
      const ext = this.schemaRegistry.getSchema(urn, endpointId);
      if (ext) schemas.push(ext as SchemaDefinition);
    }
    return schemas;
  }

  /**
   * Build the set of boolean attribute names for the resource's schema.
   * Collects names from core + extension schemas.
   */
  getBooleanKeys(endpointId?: string): Set<string> {
    const schemas = this.getSchemaDefinitions(endpointId);
    return SchemaValidator.collectBooleanAttributeNames(schemas);
  }

  /**
   * Collect returned characteristic sets (never + request) for the resource's schemas.
   */
  getReturnedCharacteristics(endpointId?: string): { never: Set<string>; request: Set<string> } {
    const schemas = this.getSchemaDefinitions(endpointId);
    return SchemaValidator.collectReturnedCharacteristics(schemas);
  }

  /**
   * Get the returned:'request' attribute names for the resource type.
   * Used by controllers to filter response attributes per RFC 7643 §2.4.
   */
  getRequestOnlyAttributes(endpointId?: string): Set<string> {
    const { request } = this.getReturnedCharacteristics(endpointId);
    return request;
  }

  /**
   * Get the extension URNs registered for this endpoint.
   */
  getExtensionUrns(endpointId?: string): readonly string[] {
    return this.schemaRegistry.getExtensionUrns(endpointId);
  }

  /**
   * Strip readOnly attributes from a POST/PUT payload using the endpoint's
   * registered schema definitions.
   *
   * @returns Array of stripped attribute names (for logging/warning)
   */
  stripReadOnlyAttributesFromPayload(
    payload: Record<string, unknown>,
    endpointId?: string,
  ): string[] {
    const schemas = this.getSchemaDefinitions(endpointId);
    return stripReadOnlyAttributes(payload, schemas);
  }

  /**
   * Filter PATCH operations targeting readOnly attributes using the endpoint's
   * registered schema definitions.
   *
   * @returns Object with filtered operations and stripped attribute names
   */
  stripReadOnlyFromPatchOps(
    operations: PatchOperation[],
    endpointId?: string,
  ): { filtered: PatchOperation[]; stripped: string[] } {
    const schemas = this.getSchemaDefinitions(endpointId);
    return stripReadOnlyPatchOps(operations, schemas);
  }

  /**
   * Coerce boolean-typed string values to native booleans on write payloads.
   *
   * Gated by AllowAndCoerceBooleanStrings (default: true). When enabled, converts
   * attributes like primary = "True" → true before schema validation,
   * preventing StrictSchemaValidation from rejecting valid-intent payloads.
   *
   * @see RFC 7644 §3.12 — "Be liberal in what you accept" (Postel's Law)
   */
  coerceBooleanStringsIfEnabled(
    dto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    const coerceEnabled = getConfigBooleanWithDefault(
      config,
      ENDPOINT_CONFIG_FLAGS.ALLOW_AND_COERCE_BOOLEAN_STRINGS,
      true,
    );
    if (!coerceEnabled) return;

    const booleanKeys = this.getBooleanKeys(endpointId);
    sanitizeBooleanStrings(dto, booleanKeys);
  }

  /**
   * H-2: Immutable attribute enforcement (RFC 7643 §2.2).
   *
   * Compares the existing resource state with the incoming payload
   * and rejects changes to attributes declared as immutable.
   * Only runs when StrictSchemaValidation is enabled.
   *
   * @param existingPayload - Reconstructed existing resource payload (caller builds this)
   * @param incomingDto     - Incoming request payload
   */
  checkImmutableAttributes(
    existingPayload: Record<string, unknown>,
    incomingDto: Record<string, unknown>,
    endpointId: string,
    config?: EndpointConfig,
  ): void {
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION)) {
      return;
    }

    const schemas = this.buildSchemaDefinitions(incomingDto, endpointId);
    if (schemas.length === 0) return;

    const result = SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas);

    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'mutability',
        detail: `Immutable attribute violation: ${details}`,
      });
    }
  }
}
