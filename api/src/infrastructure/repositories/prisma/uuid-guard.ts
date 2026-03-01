/**
 * UUID format guard for PostgreSQL repositories.
 *
 * PostgreSQL UUID columns reject non-UUID strings with error P2007
 * ("invalid input syntax for type uuid"). In SQLite, any string was
 * accepted as an ID, so look-ups like `findByScimId('nonexistent')`
 * simply returned null. This guard restores that behaviour: if the
 * value is not a valid UUID we short-circuit and return null in the
 * caller, avoiding a database round-trip that would throw.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns `true` when `value` is a well-formed UUID v1-v7 string. */
export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}
