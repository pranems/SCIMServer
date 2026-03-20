/**
 * SCIM Attribute Projection — RFC 7644 §3.4.2.5 + RFC 7643 §2.4
 *
 * Implements the `attributes` and `excludedAttributes` query parameters
 * for SCIM list and GET operations, PLUS schema-driven response filtering
 * for the `returned` attribute characteristic.
 *
 * Per RFC 7644:
 * - "attributes" — A multi-valued list of strings indicating the names
 *   of resource attributes to return in the response. Only the specified
 *   attributes (plus always-returned: id, schemas, meta) are included.
 * - "excludedAttributes" — A multi-valued list of strings indicating the
 *   names of resource attributes to be removed from the default set.
 *
 * Per RFC 7643 §2.4 `returned` characteristic:
 * - "always"  — Always returned regardless of query params.
 * - "default" — Returned by default, removable via excludedAttributes.
 * - "never"   — MUST NOT appear in any response (e.g. password).
 * - "request" — Only returned when explicitly requested via `attributes`.
 *
 * Both parameters are comma-separated, case-insensitive, and support
 * dotted sub-attribute paths (e.g., "name.givenName").
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.5
 * @see https://datatracker.ietf.org/doc/html/rfc7643#section-2.4
 */

/**
 * Attributes that MUST always be returned per RFC 7643 §7 ("returned": "always").
 * These are never excluded by "attributes" or "excludedAttributes" parameters.
 *
 * Includes framework attributes (schemas, id, meta) plus resource-type attributes
 * that are declared as returned:"always" in the schema definitions.
 */
const ALWAYS_RETURNED_BASE = new Set(['schemas', 'id', 'meta', 'username']);

function getAlwaysReturnedForResource(
  resource: Record<string, unknown>,
  schemaAlwaysReturned?: Set<string>,
): Set<string> {
  const alwaysReturned = new Set(ALWAYS_RETURNED_BASE);

  // Merge schema-driven always-returned attributes (R-RET-1)
  if (schemaAlwaysReturned) {
    for (const attr of schemaAlwaysReturned) {
      alwaysReturned.add(attr);
    }
  }

  const meta = resource['meta'];
  const resourceType =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)['resourceType']
      : undefined;
  const isGroupByMeta = typeof resourceType === 'string' && resourceType.toLowerCase() === 'group';

  const schemas = resource['schemas'];
  const isGroupBySchema =
    Array.isArray(schemas) &&
    schemas.some(
      (schema) => typeof schema === 'string' && schema.toLowerCase() === 'urn:ietf:params:scim:schemas:core:2.0:group',
    );

  if (isGroupByMeta || isGroupBySchema) {
    alwaysReturned.add('displayname');
    alwaysReturned.add('active');
  }

  return alwaysReturned;
}

/**
 * Apply attribute projection to a single SCIM resource.
 *
 * @param resource  The full SCIM resource object
 * @param attributes  Comma-separated list of attribute names to include (undefined = all)
 * @param excludedAttributes  Comma-separated list of attribute names to exclude (undefined = none)
 * @param requestOnlyAttrs  Set of lowercase attribute names with returned:'request' — stripped unless in `attributes`
 * @param schemaAlwaysReturned  Optional Set of lowercase attribute names with returned:'always' from schema definitions
 * @param alwaysSubs  Optional Map of parent attr → Set of sub-attr names with returned:'always' (R-RET-3)
 * @returns A new object with only the requested attributes
 *
 * Per RFC 7644 §3.4.2.5: If both are specified, attributes takes precedence.
 */
export function applyAttributeProjection(
  resource: Record<string, unknown>,
  attributes?: string,
  excludedAttributes?: string,
  requestOnlyAttrs?: Set<string>,
  schemaAlwaysReturned?: Set<string>,
  alwaysSubs?: Map<string, Set<string>>,
): Record<string, unknown> {
  let result = resource;

  // "attributes" takes precedence over "excludedAttributes" per RFC
  if (attributes) {
    result = includeOnly(resource, parseAttrList(attributes), schemaAlwaysReturned, alwaysSubs);
  } else if (excludedAttributes) {
    result = excludeAttrs(resource, parseAttrList(excludedAttributes), schemaAlwaysReturned);
  }

  // Strip returned:'request' attributes (unless explicitly named in `attributes`)
  if (requestOnlyAttrs && requestOnlyAttrs.size > 0) {
    const requestedSet = attributes ? parseAttrList(attributes) : new Set<string>();
    result = stripRequestOnlyAttrs(result, requestOnlyAttrs, requestedSet);
  }

  return result;
}

/**
 * Apply attribute projection to a list response (all Resources).
 */
export function applyAttributeProjectionToList<T extends Record<string, unknown>>(
  resources: T[],
  attributes?: string,
  excludedAttributes?: string,
  requestOnlyAttrs?: Set<string>,
  schemaAlwaysReturned?: Set<string>,
  alwaysSubs?: Map<string, Set<string>>,
): Record<string, unknown>[] {
  if (!attributes && !excludedAttributes && (!requestOnlyAttrs || requestOnlyAttrs.size === 0)) {
    return resources;
  }

  return resources.map(r => applyAttributeProjection(r, attributes, excludedAttributes, requestOnlyAttrs, schemaAlwaysReturned, alwaysSubs));
}

/**
 * Strip attributes with `returned: 'never'` from a SCIM resource.
 *
 * Per RFC 7643 §2.4: attributes with returned='never' MUST NOT appear
 * in any SCIM response (e.g. password). This applies to ALL responses
 * including POST, PUT, PATCH — not just GET/LIST.
 *
 * Handles both top-level attributes and attributes within extension URN objects.
 *
 * @param resource   The SCIM resource to filter (mutated in place for performance)
 * @param neverAttrs Set of lowercase attribute names with returned:'never'
 * @returns The resource with never-returned attributes removed
 */
export function stripReturnedNever(
  resource: Record<string, unknown>,
  neverAttrs: Set<string>,
): Record<string, unknown> {
  if (!neverAttrs || neverAttrs.size === 0) return resource;

  for (const key of Object.keys(resource)) {
    if (neverAttrs.has(key.toLowerCase())) {
      delete resource[key];
      continue;
    }
    // Check inside extension URN objects (e.g. "urn:...": { password: "..." })
    const value = resource[key];
    if (typeof key === 'string' && key.startsWith('urn:') && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const extObj = value as Record<string, unknown>;
      for (const extKey of Object.keys(extObj)) {
        if (neverAttrs.has(extKey.toLowerCase())) {
          delete extObj[extKey];
        }
      }
      // FP-1 fix: If extension is now empty after stripping, remove the entire extension
      if (Object.keys(extObj).length === 0) {
        delete resource[key];
      }
    }
  }

  return resource;
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * Strip returned:'request' attributes from a resource.
 * These should only appear when explicitly requested via `attributes` param.
 */
function stripRequestOnlyAttrs(
  resource: Record<string, unknown>,
  requestOnlyAttrs: Set<string>,
  requestedAttrs: Set<string>,
): Record<string, unknown> {
  const result = { ...resource };

  for (const key of Object.keys(result)) {
    const keyLower = key.toLowerCase();
    // Only strip if it's in request-only set AND not explicitly requested
    if (requestOnlyAttrs.has(keyLower) && !requestedAttrs.has(keyLower)) {
      delete result[key];
      continue;
    }
    // Check inside extension URN objects
    const value = result[key];
    if (typeof key === 'string' && key.startsWith('urn:') && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const keyLower = key.toLowerCase();
      const extCopy = { ...(value as Record<string, unknown>) };
      let changed = false;
      for (const extKey of Object.keys(extCopy)) {
        const extKeyLower = extKey.toLowerCase();
        // Check both bare name and fully-qualified URN:attrName form
        const fqn = `${keyLower}:${extKeyLower}`;
        if (requestOnlyAttrs.has(extKeyLower) && !requestedAttrs.has(extKeyLower) && !requestedAttrs.has(fqn)) {
          delete extCopy[extKey];
          changed = true;
        }
      }
      if (changed) result[key] = extCopy;
    }
  }

  return result;
}

function parseAttrList(raw: string): Set<string> {
  return new Set(
    raw.split(',').map(a => a.trim().toLowerCase()).filter(a => a.length > 0)
  );
}

/**
 * Include only the specified attributes + always-returned ones.
 * Supports dotted paths — e.g. "name.givenName" will keep only that sub-attribute.
 */
function includeOnly(
  resource: Record<string, unknown>,
  attrs: Set<string>,
  schemaAlwaysReturned?: Set<string>,
  alwaysSubs?: Map<string, Set<string>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const alwaysReturned = getAlwaysReturnedForResource(resource, schemaAlwaysReturned);

  // Always include "always returned" attributes
  for (const key of alwaysReturned) {
    const match = findKey(resource, key);
    if (match !== undefined) {
      result[match] = resource[match];
    }
  }

  // Group requested attrs by top-level key
  const topLevel = new Map<string, Set<string> | null>(); // null means include full attribute
  for (const attr of attrs) {
    // Handle URN-prefixed attributes FIRST (RFC 7644 §3.10)
    // URN paths like "urn:ext:1.0" contain dots in version numbers, so we must
    // resolve them against resource keys BEFORE dot-based splitting.
    if (attr.startsWith('urn:')) {
      // Check if exact match for a resource key (e.g., "urn:ext:1.0" → include all)
      if (findKey(resource, attr) !== undefined) {
        topLevel.set(attr, null);
        continue;
      }
      // Check if a resource key is a prefix (e.g., "urn:ext:1.0:attrName" → sub-attr)
      let urnHandled = false;
      for (const resourceKey of Object.keys(resource)) {
        const keyLower = resourceKey.toLowerCase();
        if (!keyLower.startsWith('urn:')) continue;
        if (attr.startsWith(keyLower + ':')) {
          const subAttr = attr.substring(keyLower.length + 1);
          if (subAttr) {
            if (topLevel.has(keyLower) && topLevel.get(keyLower) === null) {
              // Already including full extension — skip
            } else {
              if (!topLevel.has(keyLower)) topLevel.set(keyLower, new Set());
              topLevel.get(keyLower)!.add(subAttr);
            }
            urnHandled = true;
            break;
          }
        }
      }
      if (urnHandled) continue;
      // Fall through to dot-based splitting for URNs not matching any resource key
    }

    const dot = attr.indexOf('.');
    if (dot === -1) {
      topLevel.set(attr, null); // full attribute
    } else {
      const top = attr.substring(0, dot);
      const sub = attr.substring(dot + 1);
      if (topLevel.has(top) && topLevel.get(top) === null) {
        continue; // already including full attribute
      }
      if (!topLevel.has(top)) {
        topLevel.set(top, new Set());
      }
      topLevel.get(top)!.add(sub);
    }
  }

  for (const [attrLower, subs] of topLevel) {
    const key = findKey(resource, attrLower);
    if (key === undefined) continue;

    if (subs === null) {
      // Include entire attribute
      result[key] = resource[key];
    } else {
      // Include only sub-attributes
      const value = resource[key];

      // R-RET-3: Merge in always-returned sub-attrs for this parent
      const alwaysSubsForAttr = alwaysSubs?.get(attrLower);
      const effectiveSubs = new Set(subs);
      if (alwaysSubsForAttr) {
        for (const alwaysSub of alwaysSubsForAttr) {
          effectiveSubs.add(alwaysSub);
        }
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const filtered: Record<string, unknown> = {};
        for (const sub of effectiveSubs) {
          const subKey = findKey(value as Record<string, unknown>, sub);
          if (subKey !== undefined) {
            filtered[subKey] = (value as Record<string, unknown>)[subKey];
          }
        }
        result[key] = filtered;
      } else if (Array.isArray(value)) {
        // R-RET-3: For multi-valued complex attrs (e.g., emails[]), filter each item
        result[key] = value.map(item => {
          if (typeof item !== 'object' || item === null) return item;
          const filtered: Record<string, unknown> = {};
          for (const sub of effectiveSubs) {
            const subKey = findKey(item as Record<string, unknown>, sub);
            if (subKey !== undefined) {
              filtered[subKey] = (item as Record<string, unknown>)[subKey];
            }
          }
          return filtered;
        });
      } else {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Exclude specified attributes from the resource.
 * Supports dotted paths — e.g. "name.givenName" removes only that sub-attribute.
 */
function excludeAttrs(
  resource: Record<string, unknown>,
  attrs: Set<string>,
  schemaAlwaysReturned?: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...resource };
  const alwaysReturned = getAlwaysReturnedForResource(resource, schemaAlwaysReturned);

  // Group by top-level
  const topLevel = new Map<string, Set<string> | null>();
  for (const attr of attrs) {
    // Never allow excluding always-returned attributes
    if (alwaysReturned.has(attr.toLowerCase().split('.')[0])) continue;

    // Handle URN-prefixed attributes (RFC 7644 §3.10)
    // URN paths like "urn:ext:2.0:attrName" contain dots in version numbers,
    // so we must resolve them against resource keys BEFORE dot-based splitting.
    if (attr.startsWith('urn:')) {
      // Exact match for a resource key — exclude entire extension
      if (findKey(result, attr) !== undefined) {
        // Never exclude always-returned URN extensions
        if (!alwaysReturned.has(attr)) {
          topLevel.set(attr, null);
        }
        continue;
      }
      // Check if a resource key is a prefix (e.g., "urn:ext:2.0:department" → sub-attr)
      let urnHandled = false;
      for (const resourceKey of Object.keys(result)) {
        const keyLower = resourceKey.toLowerCase();
        if (!keyLower.startsWith('urn:')) continue;
        if (attr.startsWith(keyLower + ':')) {
          const subAttr = attr.substring(keyLower.length + 1);
          if (subAttr) {
            // Never exclude always-returned sub-attributes (e.g., returned:always)
            if (alwaysReturned.has(subAttr.toLowerCase())) {
              urnHandled = true;
              break;
            }
            if (topLevel.has(keyLower) && topLevel.get(keyLower) === null) {
              // Already excluding full extension — skip
            } else {
              if (!topLevel.has(keyLower)) topLevel.set(keyLower, new Set());
              topLevel.get(keyLower)!.add(subAttr);
            }
            urnHandled = true;
            break;
          }
        }
      }
      if (urnHandled) continue;
      // Fall through to dot-based splitting for URNs not matching any resource key
    }

    const dot = attr.indexOf('.');
    if (dot === -1) {
      topLevel.set(attr, null);
    } else {
      const top = attr.substring(0, dot);
      const sub = attr.substring(dot + 1);
      if (topLevel.has(top) && topLevel.get(top) === null) continue;
      if (!topLevel.has(top)) topLevel.set(top, new Set());
      topLevel.get(top)!.add(sub);
    }
  }

  for (const [attrLower, subs] of topLevel) {
    const key = findKey(result, attrLower);
    if (key === undefined) continue;

    if (subs === null) {
      delete result[key];
    } else {
      const value = result[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const copy = { ...(value as Record<string, unknown>) };
        for (const sub of subs) {
          const subKey = findKey(copy, sub);
          if (subKey !== undefined) delete copy[subKey];
        }
        result[key] = copy;
      }
    }
  }

  return result;
}

/** Case-insensitive key lookup in an object. Returns the actual key or undefined. */
function findKey(obj: Record<string, unknown>, needle: string): string | undefined {
  const lower = needle.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}
