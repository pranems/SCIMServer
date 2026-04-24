/**
 * Prisma Filter Evaluator - In-Memory Implementation
 *
 * Evaluates Prisma-style WHERE clause objects against in-memory records.
 * Used by InMemory repositories to support the same filter shapes that
 * `apply-scim-filter.ts` produces for Prisma push-down.
 *
 * Phase 4: Created to support full operator push-down (co/sw/ew/ne/gt/ge/lt/le/pr)
 * and compound AND/OR filters in InMemory mode.
 *
 * Supported Prisma filter shapes:
 *   - Simple equality:      { column: value }
 *   - Not equal:            { column: { not: value } }
 *   - Contains:             { column: { contains: string, mode: 'insensitive' } }
 *   - Starts with:          { column: { startsWith: string, mode: 'insensitive' } }
 *   - Ends with:            { column: { endsWith: string, mode: 'insensitive' } }
 *   - Greater than:         { column: { gt: value } }
 *   - Greater or equal:     { column: { gte: value } }
 *   - Less than:            { column: { lt: value } }
 *   - Less or equal:        { column: { lte: value } }
 *   - Presence (not null):  { column: { not: null } }
 *   - AND:                  { AND: [...] }
 *   - OR:                   { OR: [...] }
 */

/**
 * Evaluate a Prisma-style WHERE clause against an in-memory record.
 *
 * @param record - The in-memory record to test (e.g. UserRecord, GroupRecord)
 * @param filter - The Prisma-style where clause object
 * @returns true if the record matches ALL conditions in the filter
 */
export function matchesPrismaFilter(
  record: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    // Compound: AND - all sub-filters must match
    if (key === 'AND') {
      const clauses = condition as Record<string, unknown>[];
      if (!clauses.every((clause) => matchesPrismaFilter(record, clause))) {
        return false;
      }
      continue;
    }

    // Compound: OR - at least one sub-filter must match
    if (key === 'OR') {
      const clauses = condition as Record<string, unknown>[];
      if (!clauses.some((clause) => matchesPrismaFilter(record, clause))) {
        return false;
      }
      continue;
    }

    const stored = record[key];

    // Simple equality: { column: value }
    if (condition === null || typeof condition !== 'object') {
      if (!matchEquality(stored, condition)) {
        return false;
      }
      continue;
    }

    // Nested operator object: { column: { contains: ..., mode: ... } }
    const opObj = condition as Record<string, unknown>;
    if (!matchOperator(stored, opObj)) {
      return false;
    }
  }

  return true;
}

/**
 * Case-sensitive equality comparison.
 *
 * Simple equality `{ column: value }` is case-sensitive, matching PostgreSQL
 * TEXT column behavior. For CITEXT columns, the filter builder emits
 * `{ column: { equals: value, mode: 'insensitive' } }` which is handled by
 * matchOperator instead.
 */
function matchEquality(stored: unknown, expected: unknown): boolean {
  return stored === expected;
}

/**
 * Evaluate a Prisma operator object against a stored value.
 *
 * Handles: not, contains, startsWith, endsWith, gt, gte, lt, lte
 * The `mode: 'insensitive'` flag triggers case-insensitive string matching.
 */
function matchOperator(stored: unknown, opObj: Record<string, unknown>): boolean {
  const caseInsensitive = opObj.mode === 'insensitive';

  // equals: { equals: value, mode?: 'insensitive' }
  // Emitted by the filter builder for eq on CITEXT columns.
  if ('equals' in opObj) {
    if (caseInsensitive && typeof stored === 'string' && typeof opObj.equals === 'string') {
      return stored.toLowerCase() === opObj.equals.toLowerCase();
    }
    return stored === opObj.equals;
  }

  // not: { not: value, mode?: 'insensitive' } or { not: null }
  if ('not' in opObj && !('contains' in opObj || 'startsWith' in opObj || 'endsWith' in opObj || 'gt' in opObj)) {
    const notValue = opObj.not;
    if (notValue === null) {
      // { not: null } → presence check (value is not null/undefined)
      return stored !== null && stored !== undefined;
    }
    if (caseInsensitive && typeof stored === 'string' && typeof notValue === 'string') {
      return stored.toLowerCase() !== notValue.toLowerCase();
    }
    return stored !== notValue;
  }

  // contains: { contains: string, mode?: 'insensitive' }
  if ('contains' in opObj) {
    if (typeof stored !== 'string') return false;
    const search = String(opObj.contains);
    if (caseInsensitive) {
      return stored.toLowerCase().includes(search.toLowerCase());
    }
    return stored.includes(search);
  }

  // startsWith: { startsWith: string, mode?: 'insensitive' }
  if ('startsWith' in opObj) {
    if (typeof stored !== 'string') return false;
    const search = String(opObj.startsWith);
    if (caseInsensitive) {
      return stored.toLowerCase().startsWith(search.toLowerCase());
    }
    return stored.startsWith(search);
  }

  // endsWith: { endsWith: string, mode?: 'insensitive' }
  if ('endsWith' in opObj) {
    if (typeof stored !== 'string') return false;
    const search = String(opObj.endsWith);
    if (caseInsensitive) {
      return stored.toLowerCase().endsWith(search.toLowerCase());
    }
    return stored.endsWith(search);
  }

  // gt / gte / lt / lte
  if ('gt' in opObj) {
    return compareOrdered(stored, opObj.gt, 'gt');
  }
  if ('gte' in opObj) {
    return compareOrdered(stored, opObj.gte, 'gte');
  }
  if ('lt' in opObj) {
    return compareOrdered(stored, opObj.lt, 'lt');
  }
  if ('lte' in opObj) {
    return compareOrdered(stored, opObj.lte, 'lte');
  }

  // Unknown operator shape - don't match (safe default)
  return false;
}

/**
 * Ordered comparison for gt/gte/lt/lte.
 * Works for numbers and strings (lexicographic, case-insensitive for strings).
 */
function compareOrdered(stored: unknown, expected: unknown, op: 'gt' | 'gte' | 'lt' | 'lte'): boolean {
  if (typeof stored === 'number' && typeof expected === 'number') {
    switch (op) {
      case 'gt': return stored > expected;
      case 'gte': return stored >= expected;
      case 'lt': return stored < expected;
      case 'lte': return stored <= expected;
    }
  }
  if (typeof stored === 'string' && typeof expected === 'string') {
    const s = stored.toLowerCase();
    const e = expected.toLowerCase();
    switch (op) {
      case 'gt': return s > e;
      case 'gte': return s >= e;
      case 'lt': return s < e;
      case 'lte': return s <= e;
    }
  }
  return false;
}
