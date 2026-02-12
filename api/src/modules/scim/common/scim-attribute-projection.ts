/**
 * SCIM Attribute Projection — RFC 7644 §3.4.2.5
 *
 * Implements the `attributes` and `excludedAttributes` query parameters
 * for SCIM list and GET operations.
 *
 * Per RFC 7644:
 * - "attributes" — A multi-valued list of strings indicating the names
 *   of resource attributes to return in the response. Only the specified
 *   attributes (plus always-returned: id, schemas, meta) are included.
 * - "excludedAttributes" — A multi-valued list of strings indicating the
 *   names of resource attributes to be removed from the default set.
 *
 * Both parameters are comma-separated, case-insensitive, and support
 * dotted sub-attribute paths (e.g., "name.givenName").
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.5
 */

/** Attributes that MUST always be returned per RFC 7643 §7 ("returned": "always") */
const ALWAYS_RETURNED = new Set(['schemas', 'id', 'meta']);

/**
 * Apply attribute projection to a single SCIM resource.
 *
 * @param resource  The full SCIM resource object
 * @param attributes  Comma-separated list of attribute names to include (undefined = all)
 * @param excludedAttributes  Comma-separated list of attribute names to exclude (undefined = none)
 * @returns A new object with only the requested attributes
 *
 * Per RFC 7644 §3.4.2.5: If both are specified, attributes takes precedence.
 */
export function applyAttributeProjection(
  resource: Record<string, unknown>,
  attributes?: string,
  excludedAttributes?: string,
): Record<string, unknown> {
  // If neither specified, return as-is
  if (!attributes && !excludedAttributes) {
    return resource;
  }

  // "attributes" takes precedence over "excludedAttributes" per RFC
  if (attributes) {
    return includeOnly(resource, parseAttrList(attributes));
  }

  return excludeAttrs(resource, parseAttrList(excludedAttributes!));
}

/**
 * Apply attribute projection to a list response (all Resources).
 */
export function applyAttributeProjectionToList<T extends Record<string, unknown>>(
  resources: T[],
  attributes?: string,
  excludedAttributes?: string,
): Record<string, unknown>[] {
  if (!attributes && !excludedAttributes) {
    return resources;
  }

  return resources.map(r => applyAttributeProjection(r, attributes, excludedAttributes));
}

// ─── Internals ───────────────────────────────────────────────────────────────

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
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Always include "always returned" attributes
  for (const key of ALWAYS_RETURNED) {
    const match = findKey(resource, key);
    if (match !== undefined) {
      result[match] = resource[match];
    }
  }

  // Group requested attrs by top-level key
  const topLevel = new Map<string, Set<string> | null>(); // null means include full attribute
  for (const attr of attrs) {
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
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const filtered: Record<string, unknown> = {};
        for (const sub of subs) {
          const subKey = findKey(value as Record<string, unknown>, sub);
          if (subKey !== undefined) {
            filtered[subKey] = (value as Record<string, unknown>)[subKey];
          }
        }
        result[key] = filtered;
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
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...resource };

  // Group by top-level
  const topLevel = new Map<string, Set<string> | null>();
  for (const attr of attrs) {
    // Never allow excluding always-returned attributes
    if (ALWAYS_RETURNED.has(attr.toLowerCase().split('.')[0])) continue;

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
