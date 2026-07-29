/**
 * UUID validation. Deliberately a LEAF module: no Nest imports, no app imports,
 * nothing that can participate in a dependency cycle.
 *
 * The first cut of this guard exported `isUuid` from `correlation-middleware.ts`
 * and imported it into `logging.service.ts`. That created the cycle
 * `logging.service -> correlation-middleware -> scim-logger -> logging`, which
 * did not fail the TypeScript build - it failed at RUNTIME as
 * "Nest can't resolve dependencies of the RequestLoggingInterceptor (?, ScimLogger)
 *  ... the dependency at index [0] appears to be undefined at runtime",
 * taking out all 65 tests in three E2E suites at once.
 *
 * Keep pure, widely-shared predicates like this in a leaf module.
 */

/** RFC 4122 canonical form - the shape Postgres accepts for a `uuid` column. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` is a canonical UUID and therefore safe for a `@db.Uuid` column. */
export function isUuid(value: unknown): boolean {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
