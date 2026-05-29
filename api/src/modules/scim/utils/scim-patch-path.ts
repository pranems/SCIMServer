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
import { KNOWN_EXTENSION_URNS } from '../common/scim-constants';

// CWE-1321 / js/remote-property-injection - prototype pollution sink barrier.
// The engines call guardPrototypePollution() at parse-time, so in practice
// the keys flowing into the sinks below are already validated. This in-util
// guard is defense-in-depth and serves as the CodeQL barrier that the
// interprocedural taint analysis does not always trace from the engines.
const PROTOTYPE_POLLUTING_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Throws when `key` is reserved by JavaScript's object model and writing to
 * it would pollute `Object.prototype` or interfere with built-in behavior.
 * Returns the key unchanged on the safe path so it can be inlined at sinks:
 *   `obj[safePropertyKey(parsed.attribute)] = value`
 *
 * Exported so engines outside this module can apply the same barrier at
 * their own sink sites (e.g. `rawPayload[safePropertyKey(originalPath)]`).
 */
export function safePropertyKey(key: string): string {
  if (typeof key !== 'string' || PROTOTYPE_POLLUTING_KEYS.has(key)) {
    throw new Error(
      `[scim-patch-path] Refusing to write to reserved property key '${String(key)}' (CWE-1321 prototype pollution guard).`,
    );
  }
  return key;
}

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

/**
 * Result of parsing a URN-prefixed extension path in the flat or dotted form.
 *
 * Flat:    `urn:...:User:manager`               -> { schemaUrn, attributePath: 'manager' }
 * Dotted:  `urn:...:User:manager.displayName`   -> { schemaUrn, attributePath: 'manager', subAttribute: 'displayName' }
 *
 * The valuePath form (`urn:...:Mailbox:aliases[type eq "smtp"].value`) is
 * represented by the separate `ExtensionValuePathExpression` interface so it
 * can carry the nested `ValuePathExpression`. Discriminate via the
 * `isExtensionValuePath()` type guard.
 */
export interface ExtensionPathExpression {
  /** The full schema URN, e.g. "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User" */
  schemaUrn: string;
  /** The top-level attribute name after the URN, e.g. "manager" */
  attributePath: string;
  /** F6: present when the path was dotted (e.g. "manager.displayName"). */
  subAttribute?: string;
}

/**
 * Result of parsing a URN-prefixed extension path that contains a valuePath
 * filter expression (F7). Example:
 *   `urn:...:Mailbox:aliases[type eq "smtp"].value`
 * Engines dispatch on this shape via `isExtensionValuePath()` and call
 * `applyExtensionValuePathUpdate` / `removeExtensionValuePathEntry`, both of
 * which return `ValuePathOpResult` so the engine can emit a SCIM `noTarget`
 * error on zero-match filters (RFC 7644 §3.5.2.2).
 */
export interface ExtensionValuePathExpression {
  /** The full schema URN. */
  schemaUrn: string;
  /** The inner valuePath expression scoped to the extension namespace. */
  valuePath: ValuePathExpression;
}

/** Discriminator between flat/dotted and valuePath extension shapes. */
export function isExtensionValuePath(
  parsed: unknown,
): parsed is ExtensionValuePathExpression {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'valuePath' in (parsed as Record<string, unknown>)
  );
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
export function isExtensionPath(path: string, extensionUrns?: readonly string[]): boolean {
  const urns = extensionUrns ?? KNOWN_EXTENSION_URNS;
  const lowerPath = path.toLowerCase();
  return urns.some((urn) => lowerPath.startsWith(urn.toLowerCase() + ':'));
}

/**
 * Parses a URN-prefixed extension path into one of three shapes per RFC 7644
 * §3.10 syntax:
 *
 *   flat       `urn:...:User:manager`                 -> ExtensionPathExpression (no subAttribute)
 *   dotted     `urn:...:User:manager.displayName`     -> ExtensionPathExpression (subAttribute='displayName')
 *   valuePath  `urn:...:Mailbox:aliases[type eq "x"]` -> ExtensionValuePathExpression
 *
 * Use `isExtensionValuePath()` to discriminate at call sites.
 *
 * @example
 *   parseExtensionPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager')
 *   // -> { schemaUrn: '...User', attributePath: 'manager' }
 *
 * @example
 *   parseExtensionPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager.displayName')
 *   // -> { schemaUrn: '...User', attributePath: 'manager', subAttribute: 'displayName' }
 *
 * @example
 *   parseExtensionPath('urn:...:Mailbox:aliases[type eq "smtp"].value', [URN])
 *   // -> { schemaUrn: '...Mailbox', valuePath: { attribute: 'aliases', ... } }
 */
export function parseExtensionPath(
  path: string,
  extensionUrns?: readonly string[],
): ExtensionPathExpression | ExtensionValuePathExpression | null {
  const urns = extensionUrns ?? KNOWN_EXTENSION_URNS;
  const lowerPath = path.toLowerCase();
  for (const urn of urns) {
    const prefix = urn.toLowerCase() + ':';
    if (!lowerPath.startsWith(prefix)) continue;
    // preserve original casing for the attribute (RFC 7643 §2.1)
    const remainder = path.slice(prefix.length);
    if (remainder.length === 0) continue;

    // F7: valuePath form. parseValuePath returns null if the bracket form is
    // malformed; in that case we fall back to the flat-path interpretation
    // (literal remainder as attributePath) so the existing behavior is
    // preserved for unparseable bracket expressions.
    if (remainder.includes('[')) {
      const vp = parseValuePath(remainder);
      if (vp) {
        return { schemaUrn: urn, valuePath: vp };
      }
      // Fall through to flat-path treatment
    }

    // F6: dotted form. The first '.' splits attributePath from subAttribute.
    // URNs (which contain dots in version segments like "2.0") have already
    // been stripped at this point so the dot must be a SCIM sub-attribute
    // separator.
    const dotIdx = remainder.indexOf('.');
    if (dotIdx > 0 && dotIdx < remainder.length - 1) {
      return {
        schemaUrn: urn,
        attributePath: remainder.slice(0, dotIdx),
        subAttribute: remainder.slice(dotIdx + 1),
      };
    }

    // Flat form (pre-F6 behavior)
    return { schemaUrn: urn, attributePath: remainder };
  }
  return null;
}

/**
 * Checks whether a single record matches a simple SCIM filter expression.
 * Only `eq` is fully supported. String comparison respects `caseExact`:
 * when `caseExact` is true, comparison is case-sensitive; otherwise case-insensitive.
 *
 * Boolean-aware: When comparing a boolean actual value against a string filter
 * value (e.g., `primary eq "True"`), the comparison coerces the boolean to
 * its string representation for a case-insensitive match. This handles the
 * common case where SCIM clients use filter expressions like
 * `roles[primary eq "True"]` against boolean attributes.
 *
 * @param caseExact  When true, string comparison is case-sensitive per RFC 7643 §2.2.
 */
export function matchesFilter(
  item: Record<string, unknown>,
  filterAttribute: string,
  filterOperator: string,
  filterValue: string,
  caseExact = false,
): boolean {
  // RFC 7643 §2.1: attribute names are case-insensitive - find the key regardless of casing
  const lowerAttr = filterAttribute.toLowerCase();
  const actual = Object.entries(item).find(([k]) => k.toLowerCase() === lowerAttr)?.[1];

  switch (filterOperator) {
    case 'eq': {
      if (typeof actual === 'string' && typeof filterValue === 'string') {
        return caseExact
          ? actual === filterValue
          : actual.toLowerCase() === filterValue.toLowerCase();
      }
      // Boolean-to-string comparison: `true` eq "True" → match
      if (typeof actual === 'boolean') {
        return String(actual).toLowerCase() === filterValue.toLowerCase();
      }
      return String(actual) === String(filterValue);
    }
    default:
      // For unsupported operators, fall back to strict equality
      if (typeof actual === 'boolean') {
        return String(actual).toLowerCase() === filterValue.toLowerCase();
      }
      return String(actual) === String(filterValue);
  }
}

/**
 * Result shape returned by valuePath apply/remove utilities.
 *
 * `matched` indicates whether the filter inside the valuePath actually selected
 * an array entry. When it is `false`, callers SHOULD raise a SCIM `noTarget`
 * error per RFC 7644 §3.5.2.2.
 */
export interface ValuePathOpResult {
  matched: boolean;
  payload: Record<string, unknown>;
}

/**
 * Applies a valuePath PATCH operation (add/replace) to a rawPayload.
 *
 * Finds the matching element inside the multi-valued attribute array and
 * updates the specified sub-attribute in place.
 *
 * @returns `{ matched, payload }`. When `matched === false` the payload is
 *   returned unchanged and the caller is responsible for emitting a SCIM
 *   `noTarget` error if the operation requires a successful filter match
 *   (RFC 7644 §3.5.2.2).
 */
export function applyValuePathUpdate(
  rawPayload: Record<string, unknown>,
  parsed: ValuePathExpression,
  value: unknown,
  caseExact = false,
): ValuePathOpResult {
  // Validate keys at entry so a prototype-polluting attribute name throws
  // BEFORE any property reads (reading `rawPayload['__proto__']` would resolve
  // to Object.prototype instead of undefined and silently mask the attack).
  safePropertyKey(parsed.attribute);
  if (parsed.subAttribute) safePropertyKey(parsed.subAttribute);
  const arr = rawPayload[parsed.attribute];

  if (!Array.isArray(arr)) {
    return { matched: false, payload: rawPayload };
  }

  const matchIdx = arr.findIndex((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    return matchesFilter(
      item as Record<string, unknown>,
      parsed.filterAttribute,
      parsed.filterOperator,
      parsed.filterValue,
      caseExact,
    );
  });

  if (matchIdx < 0) {
    return { matched: false, payload: rawPayload };
  }

  if (parsed.subAttribute) {
    (arr[matchIdx] as Record<string, unknown>)[safePropertyKey(parsed.subAttribute)] = value;
  } else {
    arr[matchIdx] = value;
  }
  rawPayload[safePropertyKey(parsed.attribute)] = [...arr];

  return { matched: true, payload: rawPayload };
}

/**
 * Removes the matching element from a multi-valued attribute array based on a valuePath filter.
 *
 * @returns `{ matched, payload }`. When `matched === false` the payload is
 *   returned unchanged and the caller is responsible for emitting a SCIM
 *   `noTarget` error (RFC 7644 §3.5.2.2).
 */
export function removeValuePathEntry(
  rawPayload: Record<string, unknown>,
  parsed: ValuePathExpression,
  caseExact = false,
): ValuePathOpResult {
  // See applyValuePathUpdate: entry-validate to throw before any read.
  safePropertyKey(parsed.attribute);
  if (parsed.subAttribute) safePropertyKey(parsed.subAttribute);
  const arr = rawPayload[parsed.attribute];
  if (!Array.isArray(arr)) {
    return { matched: false, payload: rawPayload };
  }

  if (parsed.subAttribute) {
    const matchIdx = arr.findIndex((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      return matchesFilter(
        item as Record<string, unknown>,
        parsed.filterAttribute,
        parsed.filterOperator,
        parsed.filterValue,
        caseExact,
      );
    });
    if (matchIdx < 0) {
      return { matched: false, payload: rawPayload };
    }
    const entry = { ...(arr[matchIdx] as Record<string, unknown>) };
    delete entry[safePropertyKey(parsed.subAttribute)];
    arr[matchIdx] = entry;
    rawPayload[safePropertyKey(parsed.attribute)] = [...arr];
    return { matched: true, payload: rawPayload };
  }

  const beforeLen = arr.length;
  const filtered = arr.filter((item: unknown) => {
    if (typeof item !== 'object' || item === null) return true;
    return !matchesFilter(
      item as Record<string, unknown>,
      parsed.filterAttribute,
      parsed.filterOperator,
      parsed.filterValue,
      caseExact,
    );
  });
  rawPayload[safePropertyKey(parsed.attribute)] = filtered;
  return { matched: filtered.length < beforeLen, payload: rawPayload };
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
  value: unknown,
  caseExact = false,
): Record<string, unknown> {
  // See applyValuePathUpdate: entry-validate to throw before any read.
  safePropertyKey(parsed.attribute);
  safePropertyKey(parsed.filterAttribute);
  if (parsed.subAttribute) safePropertyKey(parsed.subAttribute);
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
      parsed.filterValue,
      caseExact,
    );
  });

  if (matchIdx >= 0) {
    // Update existing matching element
    if (parsed.subAttribute) {
      (arr[matchIdx] as Record<string, unknown>)[safePropertyKey(parsed.subAttribute)] = value;
    } else {
      arr[matchIdx] = value;
    }
  } else {
    // Create new element with filter criteria and the value
    const newEntry: Record<string, unknown> = {
      [safePropertyKey(parsed.filterAttribute)]: parsed.filterValue,
    };
    if (parsed.subAttribute) {
      newEntry[safePropertyKey(parsed.subAttribute)] = value;
    }
    arr.push(newEntry);
  }

  rawPayload[safePropertyKey(parsed.attribute)] = [...arr];
  return rawPayload;
}

/**
 * Applies an add/replace operation to a URN extension attribute inside rawPayload.
 *
 * Handles both the flat form (`urn:...:User:manager`, no `subAttribute`) and
 * the dotted form (`urn:...:User:manager.displayName`, `subAttribute='displayName'`).
 * For the valuePath form use `applyExtensionValuePathUpdate` instead.
 *
 * @example
 *   applyExtensionUpdate(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager" },
 *     { value: "MANAGER_ID" }
 *   )
 *   // Sets rawPayload["urn:...:User"].manager = { value: "MANAGER_ID" }
 *
 * @example
 *   applyExtensionUpdate(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager", subAttribute: "displayName" },
 *     null
 *   )
 *   // Deletes manager.displayName, preserves manager.value (F6 + F1).
 */
export function applyExtensionUpdate(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionPathExpression,
  value: unknown
): Record<string, unknown> {
  const ext = (rawPayload[parsed.schemaUrn] as Record<string, unknown>) ?? {};

  // F6: dotted form. Update only the named sub-attribute of the complex parent,
  // using F1 merge semantics so a null incoming value deletes only that
  // sub-key and preserves siblings of the parent complex.
  if (parsed.subAttribute) {
    const parent = ext[parsed.attributePath];
    const parentObj: Record<string, unknown> =
      typeof parent === 'object' && parent !== null && !Array.isArray(parent)
        ? { ...(parent as Record<string, unknown>) }
        : {};
    if (value === null || value === undefined) {
      delete parentObj[safePropertyKey(parsed.subAttribute)];
    } else {
      parentObj[safePropertyKey(parsed.subAttribute)] = value;
    }
    ext[safePropertyKey(parsed.attributePath)] = parentObj;
    rawPayload[parsed.schemaUrn] = { ...ext };
    return rawPayload;
  }

  // RFC 7644 §3.5.2.3: If the target attribute value is set to the attribute's
  // default or an empty value, the attribute SHALL be removed from the resource.
  // Detect "empty" values: null, undefined, "", or an object whose only key is
  // "value" set to null / "".
  if (isEmptyScimValue(value)) {
    delete ext[safePropertyKey(parsed.attributePath)];
    rawPayload[parsed.schemaUrn] = { ...ext };
    return rawPayload;
  }

  // Complex attributes like 'manager' should be stored as objects.
  // When a string value is provided, wrap it as {value: string} per SCIM spec
  // (manager is a complex attribute with a 'value' sub-attribute).
  if (parsed.attributePath.toLowerCase() === 'manager' && typeof value === 'string') {
    ext[safePropertyKey(parsed.attributePath)] = { value };
  } else {
    ext[safePropertyKey(parsed.attributePath)] = value;
  }

  rawPayload[parsed.schemaUrn] = { ...ext };
  return rawPayload;
}

/**
 * Determines whether a SCIM PATCH value represents an "empty" or "unset" intent.
 *
 * Per RFC 7644 §3.5.2.3 - "replace":
 *   If the target location specifies a single-valued attribute, the attribute's
 *   value is replaced.  If the target location specifies a multi-valued attribute
 *   and a value selection filter ("valuePath"), the selected values are replaced.
 *   If the value is set to the attribute's default or an empty value, the attribute
 *   SHALL be removed from the resource.
 *
 * Empty values include:
 *   - null or undefined
 *   - empty string ""
 *   - object with a single "value" key set to null or ""  (e.g. `{"value":""}`)
 */
function isEmptyScimValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') {
    return true;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === 'value') {
      return obj.value === null || obj.value === undefined || obj.value === '';
    }
  }
  return false;
}

/**
 * Removes an attribute from a URN extension object inside rawPayload.
 *
 * Honors the dotted form too: when `parsed.subAttribute` is set, only the
 * sub-attribute of the complex parent is deleted; the parent and its other
 * sub-attributes are preserved.
 *
 * @example
 *   removeExtensionAttribute(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager" }
 *   )
 *   // Deletes rawPayload["urn:...:User"].manager
 *
 * @example
 *   removeExtensionAttribute(rawPayload,
 *     { schemaUrn: "urn:...:User", attributePath: "manager", subAttribute: "displayName" }
 *   )
 *   // Deletes only manager.displayName (F6)
 */
export function removeExtensionAttribute(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionPathExpression
): Record<string, unknown> {
  const ext = rawPayload[parsed.schemaUrn];
  if (typeof ext === 'object' && ext !== null) {
    const copy = { ...(ext as Record<string, unknown>) };
    if (parsed.subAttribute) {
      const parent = copy[parsed.attributePath];
      if (typeof parent === 'object' && parent !== null && !Array.isArray(parent)) {
        const parentCopy = { ...(parent as Record<string, unknown>) };
        delete parentCopy[safePropertyKey(parsed.subAttribute)];
        copy[safePropertyKey(parsed.attributePath)] = parentCopy;
      }
    } else {
      delete copy[safePropertyKey(parsed.attributePath)];
    }
    rawPayload[parsed.schemaUrn] = copy;
  }
  return rawPayload;
}

/**
 * F7: applies a valuePath PATCH operation (add/replace) scoped to an extension
 * namespace. Returns `{matched, payload}` so the engine can emit RFC 7644
 * §3.5.2.2 `noTarget` on zero-match filters, exactly the same contract as
 * core `applyValuePathUpdate`.
 *
 * @example
 *   applyExtensionValuePathUpdate(payload,
 *     { schemaUrn: '...Mailbox', valuePath: parseValuePath('aliases[type eq "smtp"].value')! },
 *     'updated@x.com'
 *   )
 *   // -> rawPayload['...Mailbox'].aliases[<matchingIdx>].value = 'updated@x.com'
 */
export function applyExtensionValuePathUpdate(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionValuePathExpression,
  value: unknown,
  caseExact = false,
): ValuePathOpResult {
  const ext = rawPayload[parsed.schemaUrn];
  if (typeof ext !== 'object' || ext === null || Array.isArray(ext)) {
    return { matched: false, payload: rawPayload };
  }
  const extObj = { ...(ext as Record<string, unknown>) };
  const inner = applyValuePathUpdate(extObj, parsed.valuePath, value, caseExact);
  if (!inner.matched) {
    return { matched: false, payload: rawPayload };
  }
  rawPayload[parsed.schemaUrn] = inner.payload;
  return { matched: true, payload: rawPayload };
}

/**
 * F7: removes a matched element from a multi-valued attribute inside an
 * extension namespace, scoped by a valuePath filter. Returns `{matched, payload}`
 * so the engine can emit RFC 7644 §3.5.2.2 `noTarget` on zero-match.
 */
export function removeExtensionValuePathEntry(
  rawPayload: Record<string, unknown>,
  parsed: ExtensionValuePathExpression,
  caseExact = false,
): ValuePathOpResult {
  const ext = rawPayload[parsed.schemaUrn];
  if (typeof ext !== 'object' || ext === null || Array.isArray(ext)) {
    return { matched: false, payload: rawPayload };
  }
  const extObj = { ...(ext as Record<string, unknown>) };
  const inner = removeValuePathEntry(extObj, parsed.valuePath, caseExact);
  if (!inner.matched) {
    return { matched: false, payload: rawPayload };
  }
  rawPayload[parsed.schemaUrn] = inner.payload;
  return { matched: true, payload: rawPayload };
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
  updateObj: Record<string, unknown>,
  extensionUrns?: readonly string[],
): Record<string, unknown> {
  // Entry-validate every key in the input object so the throw fires before
  // any property reads. Object.entries() skips literal `__proto__` setters,
  // so the realistic attack vector here is a JSON-parsed payload like
  // `JSON.parse('{"__proto__":{...}}')` where __proto__ IS an own-property.
  for (const k of Object.keys(updateObj)) safePropertyKey(k);
  for (const [key, value] of Object.entries(updateObj)) {
    if (isExtensionPath(key, extensionUrns)) {
      // Extension URN key: urn:...:User:employeeNumber -> update extension namespace
      const parsed = parseExtensionPath(key, extensionUrns);
      if (parsed) {
        if (isExtensionValuePath(parsed)) {
          // F7: a path-less PATCH value should not normally carry a valuePath
          // key (Entra sends URN-prefixed valuePath only with explicit `path`),
          // but if it does, route via the noTarget-aware helper. We discard the
          // matched signal here because path-less PATCH cannot raise noTarget
          // at the resolver level (the engine has no error vocabulary in this
          // branch). Engines that need the noTarget signal use path-mode.
          const inner = applyExtensionValuePathUpdate(rawPayload, parsed, value);
          rawPayload = inner.payload;
        } else {
          rawPayload = applyExtensionUpdate(rawPayload, parsed, value);
        }
      } else {
        rawPayload[key] = value;
      }
    } else if (key.startsWith('urn:')) {
      // URN key (e.g. "urn:example:custom:2.0:User") - store as-is.
      // URNs may contain dots (version segments like "2.0") which are NOT
      // JSON path separators. RFC 2141 URN syntax must be preserved atomically.
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // F1: per-sub-key merge with null-as-unset semantics, mirroring core
        // complex-attribute merge. Without this an incoming
        //   { 'urn:...:User': { department: null } }
        // would write a literal null into the extension namespace instead of
        // deleting the attribute, breaking Entra deprovision flows.
        const existing = rawPayload[key];
        const merged: Record<string, unknown> =
          typeof existing === 'object' && existing !== null && !Array.isArray(existing)
            ? { ...(existing as Record<string, unknown>) }
            : {};
        for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
          if (subVal === null) {
            delete merged[safePropertyKey(subKey)];
          } else if (
            subVal !== null &&
            typeof subVal === 'object' &&
            !Array.isArray(subVal)
          ) {
            // Nested complex (e.g. enterprise:manager) - merge per F1
            merged[safePropertyKey(subKey)] = mergeComplexAttribute(merged[subKey], subVal);
          } else {
            merged[safePropertyKey(subKey)] = subVal;
          }
        }
        rawPayload[safePropertyKey(key)] = merged;
      } else {
        rawPayload[safePropertyKey(key)] = value;
      }
    } else if (key.includes('.')) {
      // Dot-notation: name.givenName -> update nested object
      const dotIndex = key.indexOf('.');
      const parentAttr = key.substring(0, dotIndex);
      const childAttr = key.substring(dotIndex + 1);
      const existing = rawPayload[parentAttr];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        rawPayload[safePropertyKey(parentAttr)] = { ...(existing as Record<string, unknown>), [safePropertyKey(childAttr)]: value };
      } else {
        rawPayload[safePropertyKey(parentAttr)] = { [safePropertyKey(childAttr)]: value };
      }
    } else {
      // F1: plain key. If both existing and incoming are non-array objects,
      // perform a merge with null-as-unset semantics so a path-less PATCH like
      //   { op: 'Replace', value: { name: { familyName: null } } }
      // clears only `familyName` and preserves `givenName` / `formatted`.
      // Matches the Entra/Okta de-facto interpretation of RFC 7644 §3.5.2.3.
      // Arrays (multi-valued) still whole-replace.
      rawPayload[safePropertyKey(key)] = mergeComplexAttribute(rawPayload[key], value);
    }
  }
  return rawPayload;
}

/**
 * F1 helper: Merge an incoming PATCH value into an existing attribute value
 * using SCIM complex-merge semantics (RFC 7644 §3.5.2.3, Entra/Okta
 * interpretation).
 *
 *   - If `existing` and `incoming` are both non-null, non-array objects, the
 *     result is a shallow merge of `existing` overlaid with `incoming`. Any
 *     sub-attribute in `incoming` whose value is `null` is removed from the
 *     merged result (explicit "unset" intent). Sub-attributes not mentioned
 *     in `incoming` are preserved from `existing`.
 *   - Otherwise (`incoming` is a primitive, null, array, or `existing` is
 *     not a plain object), the function performs a whole-attribute
 *     replacement and simply returns `incoming`. This preserves correct
 *     multi-valued-attribute behavior (arrays always whole-replace) and
 *     primitive replacement.
 *
 * RFC 7643 §2.3.8 forbids complex-within-complex, so single-level merge is
 * the maximum recursion depth SCIM ever needs.
 */
export function mergeComplexAttribute(existing: unknown, incoming: unknown): unknown {
  const incomingIsObject =
    typeof incoming === 'object' && incoming !== null && !Array.isArray(incoming);
  const existingIsObject =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing);

  if (!incomingIsObject || !existingIsObject) {
    return incoming;
  }

  const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) };
  for (const [subKey, subVal] of Object.entries(incoming as Record<string, unknown>)) {
    // Comparison order: null-check FIRST then typeof. CodeQL's narrowing
    // analysis flags `typeof x === 'object'` followed by `x !== null` as
    // a comparison-between-incompatible-types because the narrowed type
    // after `typeof` includes null. Doing null-check first sidesteps that.
    if (subVal === null) {
      delete merged[safePropertyKey(subKey)];
    } else {
      merged[safePropertyKey(subKey)] = subVal;
    }
  }
  return merged;
}

/**
 * F5 helper: After PATCH application, prune any extension URN keys whose value
 * is an empty object. RFC 7643 §3.3 considers an extension "in use" only when
 * at least one of its attributes is assigned, so an extension namespace with
 * no remaining sub-attributes SHOULD be removed from the resource (and
 * consequently from `schemas[]` once the resource is projected for the
 * response).
 *
 * Only extension URNs supplied via `extensionUrns` are considered; unknown
 * keys are left alone so this is safe to call on arbitrary payloads.
 *
 * @returns The same payload reference, mutated for caller convenience.
 */
export function pruneEmptyExtensions(
  payload: Record<string, unknown>,
  extensionUrns: readonly string[],
): Record<string, unknown> {
  for (const urn of extensionUrns) {
    const ext = payload[urn];
    if (
      ext !== undefined &&
      typeof ext === 'object' &&
      ext !== null &&
      !Array.isArray(ext) &&
      Object.keys(ext).length === 0
    ) {
      delete payload[urn];
    }
  }
  return payload;
}

/**
 * F4 helper: Validate that every element of a multi-valued PATCH array is a
 * non-null, non-undefined value. A `null` element cannot satisfy any
 * multi-valued sub-schema (each entry must at minimum carry the attribute's
 * required sub-attributes per RFC 7643 §2.4), so we reject the operation
 * eagerly at the engine level.
 *
 * Strings inside a multi-valued string-list extension (e.g. opentext
 * `proxyAddresses`) are still allowed: the helper only rejects literal
 * `null` / `undefined` elements. Whole-attribute replace with `value: null`
 * is handled separately by the engines (it means "unassign the array").
 *
 * @returns `{ index, reason }` describing the offending element, or `null`
 *   when every element is valid (or when `value` is not an array). Engines
 *   wrap a non-null return in a `PatchError(400, ..., 'invalidValue')`.
 */
export function findInvalidMultiValuedElement(
  value: unknown,
): { index: number; reason: string } | null {
  if (!Array.isArray(value)) return null;
  for (let i = 0; i < value.length; i++) {
    const el = value[i];
    if (el === null || el === undefined) {
      return { index: i, reason: 'element is null' };
    }
  }
  return null;
}
