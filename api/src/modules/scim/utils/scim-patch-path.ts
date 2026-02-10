/**
 * SCIM PATCH Path Utilities
 *
 * Provides parsing and resolution for SCIM PATCH operation paths
 * as defined in RFC 7644 §3.5.2 and RFC 7644 §3.10.
 *
 * Handles:
 *   - Simple attribute paths: "displayName"
 *   - ValuePath filter expressions: "emails[type eq \"work\"].value"
 *   - Enterprise extension URN-prefixed paths:
 *       "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager"
 */

// Well-known schema extension URN prefixes (terminated with a colon separator)
const KNOWN_EXTENSION_URNS = [
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
] as const;

/** Result of parsing a valuePath expression like `emails[type eq "work"].value` */
export interface ValuePathExpression {
  /** The multi-valued attribute name, e.g. "emails" */
  attribute: string;
  /** The filter attribute inside the brackets, e.g. "type" */
  filterAttribute: string;
  /** The filter operator, e.g. "eq" */
  filterOperator: string;
  /** The filter comparison value, e.g. "work" */
  filterValue: string;
  /** The sub-attribute after the dot, e.g. "value". May be undefined if path ends at bracket. */
  subAttribute?: string;
}

/** Result of parsing a URN-prefixed extension path */
export interface ExtensionPathExpression {
  /** The full schema URN, e.g. "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" */
  schemaUrn: string;
  /** The attribute path after the URN, e.g. "manager" */
  attributePath: string;
}

/**
 * Determines if a SCIM path is a valuePath filter expression
 * (contains brackets for sub-attribute selection).
 *
 * @example isValuePath("emails[type eq \"work\"].value") → true
 * @example isValuePath("displayName") → false
 */
export function isValuePath(path: string): boolean {
  return path.includes('[') && path.includes(']');
}

/**
 * Parses a SCIM valuePath expression into its constituent parts.
 *
 * @example
 *   parseValuePath('emails[type eq "work"].value')
 *   // → { attribute: "emails", filterAttribute: "type", filterOperator: "eq", filterValue: "work", subAttribute: "value" }
 *
 * @example
 *   parseValuePath('addresses[type eq "work"].streetAddress')
 *   // → { attribute: "addresses", filterAttribute: "type", filterOperator: "eq", filterValue: "work", subAttribute: "streetAddress" }
 */
export function parseValuePath(path: string): ValuePathExpression | null {
  // Pattern: attribute[filterAttr op "filterValue"].subAttribute
  // The sub-attribute is optional (path may end at the closing bracket)
  const regex = /^(\w+)\[(\w+)\s+(eq|ne|co|sw|ew|gt|ge|lt|le)\s+"([^"]+)"\](?:\.(\w+))?$/i;
  const match = path.match(regex);
  if (!match) {
    return null;
  }

  return {
    attribute: match[1],
    filterAttribute: match[2],
    filterOperator: match[3].toLowerCase(),
    filterValue: match[4],
    subAttribute: match[5] ?? undefined,
  };
}

/**
 * Determines if a SCIM path is a URN-prefixed extension attribute path.
 *
 * @example isExtensionPath("urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager") → true
 * @example isExtensionPath("displayName") → false
 */
export function isExtensionPath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return KNOWN_EXTENSION_URNS.some((urn) => lowerPath.startsWith(urn.toLowerCase() + ':'));
}

/**
 * Parses a URN-prefixed extension path into the schema URN and the attribute path.
 *
 * @example
 *   parseExtensionPath("urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager")
 *   // → { schemaUrn: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User", attributePath: "manager" }
 */
export function parseExtensionPath(path: string): ExtensionPathExpression | null {
  const lowerPath = path.toLowerCase();
  for (const urn of KNOWN_EXTENSION_URNS) {
    const prefix = urn.toLowerCase() + ':';
    if (lowerPath.startsWith(prefix)) {
      const attributePath = path.slice(prefix.length); // preserve original casing for the attribute
      if (attributePath.length > 0) {
        return { schemaUrn: urn, attributePath };
      }
    }
  }
  return null;
}

/**
 * Checks whether a single record matches a simple SCIM filter expression.
 * Only `eq` is fully supported (case-insensitive string comparison).
 */
export function matchesFilter(
  item: Record<string, unknown>,
  filterAttribute: string,
  filterOperator: string,
  filterValue: string
): boolean {
  // RFC 7643 §2.1: attribute names are case-insensitive — find the key regardless of casing
  const lowerAttr = filterAttribute.toLowerCase();
  const actual = Object.entries(item).find(([k]) => k.toLowerCase() === lowerAttr)?.[1];

  switch (filterOperator) {
    case 'eq': {
      if (typeof actual === 'string' && typeof filterValue === 'string') {
        return actual.toLowerCase() === filterValue.toLowerCase();
      }
      return String(actual) === String(filterValue);
    }
    default:
      // For unsupported operators, fall back to strict equality
      return String(actual) === String(filterValue);
  }
}

/**
 * Applies a valuePath PATCH operation (add/replace) to a rawPayload.
 *
 * Finds the matching element inside the multi-valued attribute array and
 * updates the specified sub-attribute in place.
 *
 * @returns The updated rawPayload (mutated in-place for the array entry)
 */
export function applyValuePathUpdate(
  rawPayload: Record<string, unknown>,
  parsed: ValuePathExpression,
  value: unknown
): Record<string, unknown> {
  const arr = rawPayload[parsed.attribute];

  if (!Array.isArray(arr)) {
    // If the attribute doesn't exist as an array yet, we can't resolve the filter
    // Return payload as-is (no match)
    return rawPayload;
  }

  const matchIdx = arr.findIndex((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    return matchesFilter(
      item as Record<string, unknown>,
      parsed.filterAttribute,
      parsed.filterOperator,
      parsed.filterValue
    );
  });

  if (matchIdx >= 0) {
    if (parsed.subAttribute) {
      // Update specific sub-attribute: emails[type eq "work"].value = "new@example.com"
      (arr[matchIdx] as Record<string, unknown>)[parsed.subAttribute] = value;
    } else {
      // Replace the entire matched element
      arr[matchIdx] = value;
    }
    rawPayload[parsed.attribute] = [...arr];
  }

  return rawPayload;
}

/**
 * Removes the matching element from a multi-valued attribute array based on a valuePath filter.
 *
 * @returns The updated rawPayload
 */
export function removeValuePathEntry(
  rawPayload: Record<string, unknown>,
  parsed: ValuePathExpression
): Record<string, unknown> {
  const arr = rawPayload[parsed.attribute];
  if (!Array.isArray(arr)) {
    return rawPayload;
  }

  if (parsed.subAttribute) {
    // Remove just the sub-attribute from the matching element
    const matchIdx = arr.findIndex((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      return matchesFilter(
        item as Record<string, unknown>,
        parsed.filterAttribute,
        parsed.filterOperator,
        parsed.filterValue
      );
    });
    if (matchIdx >= 0) {
      const entry = { ...(arr[matchIdx] as Record<string, unknown>) };
      delete entry[parsed.subAttribute];
      arr[matchIdx] = entry;
      rawPayload[parsed.attribute] = [...arr];
    }
  } else {
    // Remove the entire matched element from the array
    rawPayload[parsed.attribute] = arr.filter((item: unknown) => {
      if (typeof item !== 'object' || item === null) return true;
      return !matchesFilter(
        item as Record<string, unknown>,
        parsed.filterAttribute,
        parsed.filterOperator,
        parsed.filterValue
      );
    });
  }

  return rawPayload;
}

/**
 * Applies an 'add' operation with a valuePath expression.
 * Unlike applyValuePathUpdate (which only updates existing elements),
 * this creates the array or a new element if no matching entry exists.
 *
 * @example
 *   addValuePathEntry(rawPayload, parsed('emails[type eq "work"].value'), 'new@example.com')
 *   // If no emails with type=work exist, creates: [{type: "work", value: "new@example.com"}]
 */
export function addValuePathEntry(
  rawPayload: Record<string, unknown>,
  parsed: ValuePathExpression,
  value: unknown
): Record<string, unknown> {
  let arr = rawPayload[parsed.attribute] as unknown[] | undefined;

  if (!Array.isArray(arr)) {
    arr = [];
  }

  const matchIdx = arr.findIndex((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    return matchesFilter(
      item as Record<string, unknown>,
      parsed.filterAttribute,
      parsed.filterOperator,
      parsed.filterValue
    );
  });

  if (matchIdx >= 0) {
    // Update existing matching element
    if (parsed.subAttribute) {
      (arr[matchIdx] as Record<string, unknown>)[parsed.subAttribute] = value;
    } else {
      arr[matchIdx] = value;
    }
  } else {
    // Create new element with filter criteria and the value
    const newEntry: Record<string, unknown> = {
      [parsed.filterAttribute]: parsed.filterValue,
    };
    if (parsed.subAttribute) {
      newEntry[parsed.subAttribute] = value;
    }
    arr.push(newEntry);
  }

  rawPayload[parsed.attribute] = [...arr];
  return rawPayload;
}

/**
 * Applies an add/replace operation to a URN extension attribute inside rawPayload.
 *
 * @example
 *   applyExtensionUpdate(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager" },
 *     { value: "MANAGER_ID" }
 *   )
 *   // Sets rawPayload["urn:...:User"].manager = { value: "MANAGER_ID" }
 */
export function applyExtensionUpdate(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionPathExpression,
  value: unknown
): Record<string, unknown> {
  const ext = (rawPayload[parsed.schemaUrn] as Record<string, unknown>) ?? {};

  // Complex attributes like 'manager' should be stored as objects.
  // When a string value is provided, wrap it as {value: string} per SCIM spec
  // (manager is a complex attribute with a 'value' sub-attribute).
  if (parsed.attributePath.toLowerCase() === 'manager' && typeof value === 'string') {
    ext[parsed.attributePath] = { value };
  } else {
    ext[parsed.attributePath] = value;
  }

  rawPayload[parsed.schemaUrn] = { ...ext };
  return rawPayload;
}

/**
 * Removes an attribute from a URN extension object inside rawPayload.
 *
 * @example
 *   removeExtensionAttribute(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager" }
 *   )
 *   // Deletes rawPayload["urn:...:User"].manager
 */
export function removeExtensionAttribute(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionPathExpression
): Record<string, unknown> {
  const ext = rawPayload[parsed.schemaUrn];
  if (typeof ext === 'object' && ext !== null) {
    const copy = { ...(ext as Record<string, unknown>) };
    delete copy[parsed.attributePath];
    rawPayload[parsed.schemaUrn] = copy;
  }
  return rawPayload;
}

/**
 * Resolves dot-notation keys and extension URN keys from a no-path PATCH value
 * into the appropriate nested structure in rawPayload.
 *
 * Microsoft Entra ID sends no-path PATCH operations with keys like:
 *   - "name.givenName"  → should update rawPayload.name.givenName
 *   - "urn:...:User:employeeNumber" → should update rawPayload["urn:...:User"].employeeNumber
 *   - "displayName" → should update rawPayload.displayName (flat key, no resolution needed)
 *
 * @param rawPayload The current raw payload to update
 * @param updateObj  The key-value pairs from the no-path PATCH value
 * @returns The updated rawPayload with dot-notation and URN keys resolved
 */
export function resolveNoPathValue(
  rawPayload: Record<string, unknown>,
  updateObj: Record<string, unknown>
): Record<string, unknown> {
  for (const [key, value] of Object.entries(updateObj)) {
    if (isExtensionPath(key)) {
      // Extension URN key: urn:...:User:employeeNumber → update extension namespace
      const parsed = parseExtensionPath(key);
      if (parsed) {
        rawPayload = applyExtensionUpdate(rawPayload, parsed, value);
      } else {
        rawPayload[key] = value;
      }
    } else if (key.includes('.')) {
      // Dot-notation: name.givenName → update nested object
      const dotIndex = key.indexOf('.');
      const parentAttr = key.substring(0, dotIndex);
      const childAttr = key.substring(dotIndex + 1);
      const existing = rawPayload[parentAttr];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        rawPayload[parentAttr] = { ...(existing as Record<string, unknown>), [childAttr]: value };
      } else {
        rawPayload[parentAttr] = { [childAttr]: value };
      }
    } else {
      rawPayload[key] = value;
    }
  }
  return rawPayload;
}
