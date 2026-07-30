/**
 * Guard against prototype-pollution when writing user-controlled keys into a
 * plain object literal (CWE-1321 / CodeQL js/remote-property-injection).
 *
 * A user-supplied key equal to `__proto__`, `constructor`, or `prototype` can
 * mutate `Object.prototype` (or a constructor) when assigned via `obj[key] =`.
 * Any code path that writes a key derived from request data MUST reject these
 * keys first (or write into an `Object.create(null)` / Map instead).
 */
const UNSAFE_OBJECT_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** True when `key` could pollute a prototype if used as a dynamic property name. */
export function isUnsafeObjectKey(key: string): boolean {
  return UNSAFE_OBJECT_KEYS.has(key);
}

export { UNSAFE_OBJECT_KEYS };
