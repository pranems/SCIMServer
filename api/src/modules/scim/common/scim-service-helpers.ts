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
import type { ScimSchemaRegistry, ScimSchemaDefinition } from '../discovery/scim-schema-registry';
import { SchemaValidator } from '../../../domain/validation';
import type { SchemaDefinition, SchemaAttributeDefinition, SchemaCharacteristicsCache } from '../../../domain/validation';
import { SCHEMA_CACHE_TOP_LEVEL } from '../../../domain/validation';
import type { ScimLogger } from '../../logging/scim-logger.service';
import type { LogCategory } from '../../logging/log-levels';
import type { PatchOperation } from '../../../domain/patch/patch-types';
import { parseScimFilter, extractFilterPaths } from '../filters/scim-filter-parser';
import type { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';

// ─── Cache Flatten Helpers ──────────────────────────────────────────────────

/**
 * Flatten a Parent→Children map into a flat Set of all child names.
 * Unions all children across all parent keys (ignoring parent context).
 *
 * Used to convert the precomputed cache's Parent→Children maps back into
 * the flat Set<string> shape expected by existing consumers
 * (e.g., `getReturnedCharacteristics()` return type).
 */
export function flattenParentChildMap(map: Map<string, Set<string>>): Set<string> {
  const flat = new Set<string>();
  for (const children of map.values()) {
    for (const child of children) {
      flat.add(child);
    }
  }
  return flat;
}

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
 * Parent-context-aware boolean string sanitizer.
 *
 * Recursively walks a SCIM payload and coerces string "True"/"False" to native
 * booleans, using a Parent→Children Map for precision. This prevents name-collision
 * false positives (e.g., core `active` is boolean but extension `active` is string).
 *
 * Parent key convention:
 * - `SCHEMA_CACHE_TOP_LEVEL` ("__top__") — top-level core attributes
 * - Extension URN (lowercase) — top-level extension attributes
 * - Attribute name (lowercase) — sub-attributes of complex/array parents
 *
 * @param obj         - The object to sanitize (mutated in place)
 * @param boolMap     - Parent→Children map of boolean attribute names
 * @param parentKey   - Current parent context (default: __top__)
 */
export function sanitizeBooleanStringsByParent(
  obj: Record<string, unknown>,
  boolMap: Map<string, Set<string>>,
  parentKey: string = SCHEMA_CACHE_TOP_LEVEL,
): void {
  const boolChildren = boolMap.get(parentKey);

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          // Array elements: parent context becomes the array attribute name
          sanitizeBooleanStringsByParent(item as Record<string, unknown>, boolMap, key.toLowerCase());
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested object: could be extension URN object or complex attribute
      sanitizeBooleanStringsByParent(value as Record<string, unknown>, boolMap, key.toLowerCase());
    } else if (typeof value === 'string' && boolChildren?.has(key.toLowerCase())) {
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
  preCollected?: { core: Set<string>; extensions: Map<string, Set<string>>; coreSubAttrs: Map<string, Set<string>>; extensionSubAttrs: Map<string, Map<string, Set<string>>> },
): string[] {
  const { core, extensions, coreSubAttrs, extensionSubAttrs } = preCollected ?? SchemaValidator.collectReadOnlyAttributes(schemaDefinitions);
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

  // R-MUT-2: Strip readOnly sub-attributes within readWrite core parents
  for (const [parentLower, subSet] of coreSubAttrs) {
    const parentKey = Object.keys(payload).find(k => k.toLowerCase() === parentLower);
    if (!parentKey) continue;

    const parentVal = payload[parentKey];
    if (parentVal === null || parentVal === undefined) continue;

    // Handle single complex object
    if (typeof parentVal === 'object' && !Array.isArray(parentVal)) {
      const obj = parentVal as Record<string, unknown>;
      for (const subKey of Object.keys(obj)) {
        if (subSet.has(subKey.toLowerCase())) {
          delete obj[subKey];
          stripped.push(`${parentKey}.${subKey}`);
        }
      }
    }
    // Handle multi-valued (array of complex objects)
    if (Array.isArray(parentVal)) {
      for (const item of parentVal) {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          for (const subKey of Object.keys(obj)) {
            if (subSet.has(subKey.toLowerCase())) {
              delete obj[subKey];
              stripped.push(`${parentKey}[].${subKey}`);
            }
          }
        }
      }
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

  // R-MUT-2: Strip readOnly sub-attrs within readWrite extension parents
  for (const [urn, subMap] of extensionSubAttrs) {
    const urnKey = Object.keys(payload).find(k => k.toLowerCase() === urn.toLowerCase());
    if (!urnKey) continue;

    const extObj = payload[urnKey];
    if (typeof extObj !== 'object' || extObj === null || Array.isArray(extObj)) continue;

    for (const [parentLower, subSet] of subMap) {
      const parentKey = Object.keys(extObj as Record<string, unknown>).find(k => k.toLowerCase() === parentLower);
      if (!parentKey) continue;

      const parentVal = (extObj as Record<string, unknown>)[parentKey];
      if (parentVal === null || parentVal === undefined) continue;

      if (typeof parentVal === 'object' && !Array.isArray(parentVal)) {
        const obj = parentVal as Record<string, unknown>;
        for (const subKey of Object.keys(obj)) {
          if (subSet.has(subKey.toLowerCase())) {
            delete obj[subKey];
            stripped.push(`${urnKey}.${parentKey}.${subKey}`);
          }
        }
      }
      if (Array.isArray(parentVal)) {
        for (const item of parentVal) {
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>;
            for (const subKey of Object.keys(obj)) {
              if (subSet.has(subKey.toLowerCase())) {
                delete obj[subKey];
                stripped.push(`${urnKey}.${parentKey}[].${subKey}`);
              }
            }
          }
        }
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
  preCollected?: { core: Set<string>; extensions: Map<string, Set<string>>; coreSubAttrs: Map<string, Set<string>> },
): { filtered: PatchOperation[]; stripped: string[] } {
  const { core, extensions, coreSubAttrs } = preCollected ?? SchemaValidator.collectReadOnlyAttributes(schemaDefinitions);
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

      // R-MUT-2: Check if path targets a readOnly sub-attr (e.g., "manager.displayName")
      const cleanPath = op.path.replace(/\[.*?\]/g, '');
      const dotIdx = cleanPath.indexOf('.');
      if (dotIdx !== -1) {
        const parentName = cleanPath.substring(0, dotIdx).toLowerCase();
        const subName = cleanPath.substring(dotIdx + 1).split('.')[0].toLowerCase();
        const readOnlySubs = coreSubAttrs.get(parentName);
        if (readOnlySubs && readOnlySubs.has(subName)) {
          stripped.push(`${cleanPath.substring(0, dotIdx)}.${cleanPath.substring(dotIdx + 1).split('.')[0]}`);
          continue;
        }
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
          continue;
        }

        // R-MUT-2: Strip readOnly sub-attrs from complex values in no-path ops
        const readOnlySubs = coreSubAttrs.get(key.toLowerCase());
        if (readOnlySubs && typeof valueObj[key] === 'object' && valueObj[key] !== null && !Array.isArray(valueObj[key])) {
          const subObj = { ...(valueObj[key] as Record<string, unknown>) };
          for (const subKey of Object.keys(subObj)) {
            if (readOnlySubs.has(subKey.toLowerCase())) {
              delete subObj[subKey];
              stripped.push(`${key}.${subKey}`);
              modified = true;
            }
          }
          valueObj[key] = subObj;
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
 * this.schemaHelpers = new ScimSchemaHelpers(schemaRegistry, SCIM_CORE_USER_SCHEMA, endpointContext);
 * ```
 */
export class ScimSchemaHelpers {
  constructor(
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly coreSchemaUrn: string,
    private readonly endpointContextStorage?: EndpointContextStorage,
  ) {}

  /**
   * Convert profile schemas (from EndpointProfile) to SchemaDefinition[] suitable
   * for SchemaValidator calls. Profile schemas carry the full expanded attribute
   * definitions including custom extensions with their `returned`, `mutability`,
   * `caseExact`, `uniqueness` characteristics.
   *
   * Only includes schemas relevant to this service's resource type:
   * - The core schema matching this.coreSchemaUrn
   * - Extension schemas declared on resource types that use this core schema
   *
   * Merges profile schemas with global registry schemas. Profile schemas take
   * precedence when the same schema ID exists in both (profile is more specific).
   */
  private getProfileAwareSchemaDefinitions(): SchemaDefinition[] {
    const profile = this.endpointContextStorage?.getProfile?.();
    if (!profile?.schemas || profile.schemas.length === 0) {
      // No profile or no profile schemas — fall back to global registry only
      return this.getGlobalSchemaDefinitions();
    }

    // Build the set of schema URNs relevant to this resource type:
    // core + extensions declared on RTs that use this core schema.
    const relevantUrns = new Set<string>([this.coreSchemaUrn]);
    if (profile.resourceTypes) {
      for (const rt of profile.resourceTypes) {
        if (rt.schema === this.coreSchemaUrn) {
          for (const ext of rt.schemaExtensions) {
            relevantUrns.add(ext.schema);
          }
        }
      }
    }

    const profileSchemaMap = new Map<string, ScimSchemaDefinition>();
    for (const ps of profile.schemas) {
      if (ps.id) profileSchemaMap.set(ps.id, ps);
    }

    const schemas: SchemaDefinition[] = [];
    const seenIds = new Set<string>();

    // Include only relevant profile schemas
    for (const urn of relevantUrns) {
      const ps = profileSchemaMap.get(urn);
      if (ps && ps.attributes && Array.isArray(ps.attributes)) {
        seenIds.add(ps.id);
        schemas.push({
          id: ps.id,
          attributes: ps.attributes as unknown as SchemaAttributeDefinition[],
          isCoreSchema: ps.id === this.coreSchemaUrn,
        });
      }
    }

    // Fill in any relevant schemas from the global registry not already covered
    const globalSchemas = this.getGlobalSchemaDefinitions();
    for (const gs of globalSchemas) {
      if (!seenIds.has(gs.id) && relevantUrns.has(gs.id)) {
        schemas.push(gs);
      }
    }

    return schemas;
  }

  /**
   * Get schema definitions from the global ScimSchemaRegistry only.
   * This is the original behavior before profile-awareness was added.
   */
  private getGlobalSchemaDefinitions(): SchemaDefinition[] {
    const coreSchema = this.schemaRegistry.getSchema(this.coreSchemaUrn);
    const schemas: SchemaDefinition[] = [];
    if (coreSchema) schemas.push({ ...coreSchema, isCoreSchema: true } as SchemaDefinition);
    const extUrns = this.schemaRegistry.getExtensionUrns();
    for (const urn of extUrns) {
      const ext = this.schemaRegistry.getSchema(urn);
      if (ext) schemas.push(ext as SchemaDefinition);
    }
    return schemas;
  }

  /**
   * Strict Schema Validation — when StrictSchemaValidation is enabled, reject
   * any request body that contains extension URN keys not listed in the
   * request's `schemas[]` array or not registered for this endpoint.
   *
   * Uses the endpoint's profile resourceTypes to determine registered extensions
   * (per-endpoint, not global defaults). Falls back to the global schema registry
   * if no profile is available.
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

    // Get registered extension URNs from the endpoint's profile (per-endpoint)
    // Uses precomputed cache when available; falls back to profile scan, then global registry
    const registeredUrns = this.getExtensionUrns();
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

    const cache = this.getSchemaCache(endpointId);
    const result = SchemaValidator.validate(dto, schemas, {
      strictMode: true,
      mode,
    }, cache ? { coreAttrMap: cache.coreAttrMap, extensionSchemaMap: cache.extensionSchemaMap } : undefined);

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
   *
   * Profile-aware: when a profile is set in context, profile schemas for
   * declared URNs are used (with full attribute characteristics including
   * custom extensions). Falls back to global registry for unknown URNs.
   */
  buildSchemaDefinitions(
    dto: Record<string, unknown>,
    endpointId: string,
  ): SchemaDefinition[] {
    const profile = this.endpointContextStorage?.getProfile?.();
    const profileSchemaMap = new Map<string, ScimSchemaDefinition>();
    if (profile?.schemas) {
      for (const ps of profile.schemas) {
        if (ps.id) profileSchemaMap.set(ps.id, ps);
      }
    }

    const schemas: SchemaDefinition[] = [];

    // Core schema: prefer profile version, fall back to global
    const profileCore = profileSchemaMap.get(this.coreSchemaUrn);
    if (profileCore && Array.isArray(profileCore.attributes)) {
      schemas.push({
        id: profileCore.id,
        attributes: profileCore.attributes as unknown as SchemaAttributeDefinition[],
        isCoreSchema: true,
      });
    } else {
      const globalCore = this.schemaRegistry.getSchema(this.coreSchemaUrn);
      if (globalCore) schemas.push({ ...globalCore, isCoreSchema: true } as SchemaDefinition);
    }

    // Extension schemas declared in payload's schemas[]
    const declaredSchemas = (dto.schemas as string[] | undefined) ?? [];
    for (const urn of declaredSchemas) {
      if (urn !== this.coreSchemaUrn) {
        const profileExt = profileSchemaMap.get(urn);
        if (profileExt && Array.isArray(profileExt.attributes)) {
          schemas.push({
            id: profileExt.id,
            attributes: profileExt.attributes as unknown as SchemaAttributeDefinition[],
          });
        } else {
          const globalExt = this.schemaRegistry.getSchema(urn);
          if (globalExt) schemas.push(globalExt as SchemaDefinition);
        }
      }
    }

    return schemas;
  }

  /**
   * Get all schema definitions (core + registered extensions) for the endpoint.
   *
   * When an EndpointContextStorage is available and has a profile set,
   * profile schemas are used (they include custom extensions with full
   * attribute characteristics). Falls back to the global ScimSchemaRegistry.
   */
  getSchemaDefinitions(endpointId?: string): SchemaDefinition[] {
    return this.getProfileAwareSchemaDefinitions();
  }

  // ─── Precomputed Cache Accessors (Parent→Children Maps) ───────────

  /**
   * Get the precomputed SchemaCharacteristicsCache from the endpoint profile.
   * Falls back to building one from schema definitions if the profile doesn't
   * have a cache yet (legacy data loaded from DB before cache was introduced).
   *
   * @returns SchemaCharacteristicsCache or undefined if no schemas available
   */
  private getSchemaCache(endpointId?: string): SchemaCharacteristicsCache | undefined {
    const profile = this.endpointContextStorage?.getProfile?.();
    const cacheKey = this.coreSchemaUrn;

    // Check for existing cache for THIS resource type
    if (profile?._schemaCaches?.[cacheKey]?.booleansByParent instanceof Map) {
      return profile._schemaCaches[cacheKey];
    }

    // Fallback: build cache from schema definitions
    const schemas = this.getSchemaDefinitions(endpointId);
    if (schemas.length === 0) return undefined;

    const extensionUrns = this.getExtensionUrns(endpointId);
    const cache = SchemaValidator.buildCharacteristicsCache(schemas, extensionUrns);

    // Attach to profile for next access within this request
    if (profile) {
      if (!profile._schemaCaches) profile._schemaCaches = {};
      profile._schemaCaches[cacheKey] = cache;
    }

    return cache;
  }

  /**
   * Get the Parent→Children boolean map from the precomputed cache.
   * Used by sanitizeBooleanStringsByParent() for parent-context-aware coercion.
   */
  getBooleansByParent(endpointId?: string): Map<string, Set<string>> {
    return this.getSchemaCache(endpointId)?.booleansByParent ?? new Map();
  }

  /**
   * Get the Parent→Children never-returned map from the precomputed cache.
   * Includes returned:'never' AND mutability:'writeOnly' attributes.
   */
  getNeverReturnedByParent(endpointId?: string): Map<string, Set<string>> {
    return this.getSchemaCache(endpointId)?.neverReturnedByParent ?? new Map();
  }

  /**
   * Get unique attributes from the precomputed cache.
   */
  getUniqueAttributesCached(endpointId?: string): Array<{ schemaUrn: string | null; attrName: string; caseExact: boolean }> {
    return this.getSchemaCache(endpointId)?.uniqueAttrs ?? [];
  }

  /**
   * Get precomputed attribute definition maps from cache.
   * Used by services for passing to SchemaValidator.validate/validatePatchOperationValue.
   */
  getAttrMaps(endpointId?: string): { coreAttrMap: Map<string, SchemaAttributeDefinition>; extensionSchemaMap: Map<string, SchemaDefinition> } | undefined {
    const cache = this.getSchemaCache(endpointId);
    return cache ? { coreAttrMap: cache.coreAttrMap, extensionSchemaMap: cache.extensionSchemaMap } : undefined;
  }

  /**
   * Coerce boolean-typed string values to native booleans using parent-context-aware maps.
   *
   * Gated by AllowAndCoerceBooleanStrings (default: true). Uses the precomputed
   * booleansByParent cache for zero-recomputation coercion with parent-key precision.
   */
  coerceBooleansByParentIfEnabled(
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

    const boolMap = this.getBooleansByParent(endpointId);
    sanitizeBooleanStringsByParent(dto, boolMap);
  }

  /**
   * Collect returned characteristic sets (never + request + always + alwaysSubs) for the resource's schemas.
   *
   * Uses the precomputed cache when available — flattens Parent→Children maps
   * into flat Sets for backward compatibility with projection consumers.
   * Falls back to SchemaValidator.collectReturnedCharacteristics() if no cache.
   */
  getReturnedCharacteristics(endpointId?: string): { never: Set<string>; request: Set<string>; always: Set<string>; alwaysSubs: Map<string, Set<string>> } {
    const cache = this.getSchemaCache(endpointId);
    if (cache) {
      return {
        never: flattenParentChildMap(cache.neverReturnedByParent),
        request: flattenParentChildMap(cache.requestReturnedByParent),
        always: flattenParentChildMap(cache.alwaysReturnedByParent),
        alwaysSubs: cache.alwaysReturnedSubs,
      };
    }
    // Fallback: no cache available (no schemas)
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
   * Get the returned:'always' attribute names from schema definitions.
   * Used by controllers to pass schema-driven always-returned set to projection (R-RET-1).
   */
  getAlwaysReturnedAttributes(endpointId?: string): Set<string> {
    const { always } = this.getReturnedCharacteristics(endpointId);
    return always;
  }

  /**
   * Get sub-attributes with returned:'always' grouped by parent attribute (R-RET-3).
   * Map of parentAttrLower → Set<subAttrNameLower>.
   */
  getAlwaysReturnedSubAttrs(endpointId?: string): Map<string, Set<string>> {
    const { alwaysSubs } = this.getReturnedCharacteristics(endpointId);
    return alwaysSubs;
  }

  /**
   * Get attribute names/paths with caseExact:true (R-CASE-1).
   * Returns Set of lowercase dotted paths (e.g., 'id', 'meta.location').
   *
   * Uses the precomputed cache when available — reconstructs dotted paths
   * from Parent→Children maps. Falls back to collectCaseExactAttributes().
   */
  getCaseExactAttributes(endpointId?: string): Set<string> {
    const cache = this.getSchemaCache(endpointId);
    if (cache) {
      return cache.caseExactPaths;
    }
    const schemas = this.getSchemaDefinitions(endpointId);
    return SchemaValidator.collectCaseExactAttributes(schemas);
  }

  /**
   * Validate that attribute paths used in a SCIM filter are known to the
   * schema definitions for this endpoint's resource type.
   *
   * Parses the filter string, extracts attribute paths, and validates them
   * against registered schemas. Throws 400 invalidFilter if any path is
   * unknown (RFC 7644 §3.4.2.2).
   */
  validateFilterPaths(filter: string, endpointId?: string): void {
    const schemas = this.getSchemaDefinitions(endpointId);
    if (schemas.length === 0) return;

    let ast;
    try {
      ast = parseScimFilter(filter);
    } catch {
      // Syntax error already handled by buildUserFilter / buildGroupFilter
      return;
    }
    const paths = extractFilterPaths(ast);
    if (paths.length === 0) return;

    const cache = this.getSchemaCache(endpointId);
    const result = SchemaValidator.validateFilterAttributePaths(paths, schemas,
      cache ? { coreAttrMap: cache.coreAttrMap, extensionSchemaMap: cache.extensionSchemaMap } : undefined,
    );
    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: `Filter validation failed: ${details}`,
      });
    }
  }

  /**
   * Get the extension URNs registered for this endpoint.
   *
   * Checks the precomputed cache first (zero-allocation O(1) return).
   * Falls back to profile.resourceTypes scan, then global registry.
   *
   * Note: reads _schemaCaches directly (not via getSchemaCache()) to avoid
   * circular calls — getSchemaCache() calls getExtensionUrns() during build.
   */
  getExtensionUrns(endpointId?: string): readonly string[] {
    // Check cache directly — avoid getSchemaCache() to prevent circular call
    const profile = this.endpointContextStorage?.getProfile?.();
    const cacheKey = this.coreSchemaUrn;
    if (profile?._schemaCaches?.[cacheKey]?.booleansByParent instanceof Map) {
      return profile._schemaCaches[cacheKey].extensionUrns;
    }

    // Fallback: compute from profile resourceTypes
    if (profile?.resourceTypes && profile.resourceTypes.length > 0) {
      const urns = new Set<string>();
      for (const rt of profile.resourceTypes) {
        if (rt.schemaExtensions) {
          for (const ext of rt.schemaExtensions) {
            urns.add(ext.schema);
          }
        }
      }
      return [...urns];
    }
    // Fallback: global registry defaults (no profile available)
    return [...this.schemaRegistry.getExtensionUrns()];
  }

  /**
   * Strip readOnly attributes from a POST/PUT payload using the endpoint's
   * registered schema definitions.
   *
   * Uses the precomputed cache when available to avoid per-request tree walks.
   *
   * @returns Array of stripped attribute names (for logging/warning)
   */
  stripReadOnlyAttributesFromPayload(
    payload: Record<string, unknown>,
    endpointId?: string,
  ): string[] {
    const cache = this.getSchemaCache(endpointId);
    if (cache) {
      return stripReadOnlyAttributes(payload, [], cache.readOnlyCollected);
    }
    const schemas = this.getSchemaDefinitions(endpointId);
    return stripReadOnlyAttributes(payload, schemas);
  }

  /**
   * Filter PATCH operations targeting readOnly attributes using the endpoint's
   * registered schema definitions.
   *
   * Uses the precomputed cache when available to avoid per-request tree walks.
   *
   * @returns Object with filtered operations and stripped attribute names
   */
  stripReadOnlyFromPatchOps(
    operations: PatchOperation[],
    endpointId?: string,
  ): { filtered: PatchOperation[]; stripped: string[] } {
    const cache = this.getSchemaCache(endpointId);
    if (cache) {
      return stripReadOnlyPatchOps(operations, [], cache.readOnlyCollected);
    }
    const schemas = this.getSchemaDefinitions(endpointId);
    return stripReadOnlyPatchOps(operations, schemas);
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

    const cache = this.getSchemaCache(endpointId);
    let result;

    if (cache) {
      // Use precomputed maps from cache — skip per-call map building
      const schemas = this.buildSchemaDefinitions(incomingDto, endpointId);
      result = SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas, {
        coreAttrMap: cache.coreAttrMap,
        extensionSchemaMap: cache.extensionSchemaMap,
      });
    } else {
      const schemas = this.buildSchemaDefinitions(incomingDto, endpointId);
      if (schemas.length === 0) return;
      result = SchemaValidator.checkImmutable(existingPayload, incomingDto, schemas);
    }

    if (!result.valid) {
      const details = result.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
      throw createScimError({
        status: 400,
        scimType: 'mutability',
        detail: `Immutable attribute violation: ${details}`,
      });
    }
  }

  /**
   * Collect schema attributes with `uniqueness: 'server'` that are not
   * already handled by hardcoded column-based checks (userName, externalId, displayName).
   *
   * Returns descriptors for custom extension attributes that need JSONB-level
   * uniqueness enforcement. Each descriptor includes the schema URN (for extension
   * attribute location) and the caseExact flag for comparison mode.
   *
   * Uses the precomputed cache when available. Falls back to collectUniqueAttributes().
   *
   * @see RFC 7643 §2.1 — `uniqueness: 'server'` SHOULD be unique within the endpoint
   */
  getUniqueAttributes(endpointId?: string): Array<{ schemaUrn: string | null; attrName: string; caseExact: boolean }> {
    const cache = this.getSchemaCache(endpointId);
    if (cache) {
      return cache.uniqueAttrs;
    }
    const schemas = this.getSchemaDefinitions(endpointId);
    return SchemaValidator.collectUniqueAttributes(schemas);
  }
}

// ─── Schema-Driven Uniqueness Enforcement (RFC 7643 §2.1) ──────────────────

/**
 * Extract a value from a SCIM payload for a given schema attribute descriptor.
 *
 * For core schema attrs (schemaUrn=null): looks up `payload[attrName]`
 * For extension attrs: looks up `payload[schemaUrn][attrName]`
 *
 * Returns undefined if the attribute is not present in the payload.
 */
export function extractPayloadValue(
  payload: Record<string, unknown>,
  desc: { schemaUrn: string | null; attrName: string },
): unknown {
  if (desc.schemaUrn === null) {
    // Core attribute — look up at top level (case-insensitive key match)
    for (const key of Object.keys(payload)) {
      if (key.toLowerCase() === desc.attrName.toLowerCase()) {
        return payload[key];
      }
    }
    return undefined;
  }

  // Extension attribute — find the extension URN block first
  for (const key of Object.keys(payload)) {
    if (key.toLowerCase() === desc.schemaUrn.toLowerCase()) {
      const extBlock = payload[key];
      if (extBlock && typeof extBlock === 'object') {
        const block = extBlock as Record<string, unknown>;
        for (const extKey of Object.keys(block)) {
          if (extKey.toLowerCase() === desc.attrName.toLowerCase()) {
            return block[extKey];
          }
        }
      }
      return undefined;
    }
  }
  return undefined;
}

/**
 * Compare two string values using caseExact semantics.
 * Returns true if values match.
 */
function uniquenessValuesMatch(a: unknown, b: unknown, caseExact: boolean): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return a === b;
  }
  return caseExact ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Extract a value from a raw JSON payload string (as stored in the DB).
 */
function extractFromRawPayload(
  rawPayload: string | Record<string, unknown>,
  desc: { schemaUrn: string | null; attrName: string },
): unknown {
  let parsed: Record<string, unknown>;
  if (typeof rawPayload === 'string') {
    try { parsed = JSON.parse(rawPayload) as Record<string, unknown>; }
    catch { return undefined; }
  } else {
    parsed = rawPayload;
  }
  return extractPayloadValue(parsed, desc);
}

/**
 * Schema-driven uniqueness enforcement for custom extension attributes.
 *
 * Scans all schema attributes where `uniqueness === 'server'` (excluding
 * hardcoded column attrs: userName, externalId, displayName, id), extracts
 * the incoming value from the payload, and checks all existing resources
 * in the same endpoint for conflicts.
 *
 * Uses the attribute's `caseExact` characteristic to decide comparison mode:
 * - caseExact: true → exact string comparison
 * - caseExact: false → case-insensitive comparison
 *
 * @param endpointId      The endpoint to scope uniqueness within
 * @param payload         The incoming SCIM request payload
 * @param uniqueAttrs     Array of unique attribute descriptors from SchemaValidator.collectUniqueAttributes()
 * @param existingResources  All existing resources from the repository (as raw records with rawPayload)
 * @param excludeScimId   Exclude this resource from conflict detection (for PUT/PATCH self-exclusion)
 *
 * @throws 409 uniqueness error if a conflict is found
 */
export function assertSchemaUniqueness(
  endpointId: string,
  payload: Record<string, unknown>,
  uniqueAttrs: Array<{ schemaUrn: string | null; attrName: string; caseExact: boolean }>,
  existingResources: Array<{ scimId: string; rawPayload: string | Record<string, unknown>; deletedAt?: Date | null }>,
  excludeScimId?: string,
): void {
  if (uniqueAttrs.length === 0) return;

  for (const desc of uniqueAttrs) {
    const incomingValue = extractPayloadValue(payload, desc);
    if (incomingValue === undefined || incomingValue === null) continue;

    for (const existing of existingResources) {
      // Skip self (for PUT/PATCH)
      if (excludeScimId && existing.scimId === excludeScimId) continue;
      // Skip soft-deleted resources
      if (existing.deletedAt != null) continue;

      const existingValue = extractFromRawPayload(existing.rawPayload, desc);
      if (existingValue === undefined || existingValue === null) continue;

      if (uniquenessValuesMatch(incomingValue, existingValue, desc.caseExact)) {
        const attrPath = desc.schemaUrn
          ? `${desc.schemaUrn}:${desc.attrName}`
          : desc.attrName;
        throw createScimError({
          status: 409,
          scimType: 'uniqueness',
          detail: `Attribute '${attrPath}' value '${String(incomingValue)}' must be unique within the endpoint.`,
        });
      }
    }
  }
}
