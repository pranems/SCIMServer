/**
 * SCIM Filter Application Utility
 *
 * Bridges the AST-based filter parser with the Prisma data layer.
 * For simple `eq` filters on indexed DB columns, produces a Prisma `where` clause.
 * For all other filters, falls back to in-memory evaluation using evaluateFilter().
 *
 * Phase 3: Column maps now reference actual column names (userName, displayName)
 * because PostgreSQL CITEXT handles case-insensitive comparison natively.
 *
 * @see scim-filter-parser.ts for the AST types and evaluator
 */

import {
  parseScimFilter,
  evaluateFilter,
  type FilterNode,
  type CompareNode,
} from './scim-filter-parser';

// ─── Users ───────────────────────────────────────────────────────────────────

/** DB-pushable column map for Users (attribute name → Prisma column) */
const USER_DB_COLUMNS: Record<string, string> = {
  username: 'userName',       // Phase 3: CITEXT handles case-insensitive eq natively
  externalid: 'externalId',
  id: 'scimId',
};

export interface UserFilterResult {
  /** DB-level filter clause (simple key-value object). */
  dbWhere: Record<string, unknown>;
  /** If set, the in-memory filter fn to apply after DB fetch */
  inMemoryFilter?: (resource: Record<string, unknown>) => boolean;
  /** When true, the DB fetch should return all records for the endpoint (filter is in-memory only) */
  fetchAll: boolean;
}

/**
 * Parse a SCIM filter string and determine how to apply it for Users.
 *
 * Optimisation: simple `attr eq "value"` on indexed columns → pushed to DB.
 * Anything else → parsed into AST → in-memory evaluation.
 */
export function buildUserFilter(filter?: string): UserFilterResult {
  if (!filter) {
    return { dbWhere: {}, fetchAll: false };
  }

  let ast: FilterNode;
  try {
    ast = parseScimFilter(filter);
  } catch {
    // Re-wrap as SCIM error (done by caller), just re-throw
    throw new Error(`Invalid filter: ${filter}`);
  }

  // Optimisation: simple eq on DB columns → push down
  const dbClause = tryPushToDb(ast, USER_DB_COLUMNS);
  if (dbClause) {
    return { dbWhere: dbClause, fetchAll: false };
  }

  // Complex filter → in-memory evaluation
  return {
    dbWhere: {},
    fetchAll: true,
    inMemoryFilter: (resource) => evaluateFilter(ast, resource),
  };
}

// ─── Groups ──────────────────────────────────────────────────────────────────

/**
 * DB-pushable column map for Groups.
 *
 * Phase 3: displayName maps directly to the CITEXT column now — no need for
 * displayNameLower helper column. CITEXT handles case-insensitive eq natively.
 */
const GROUP_DB_COLUMNS: Record<string, string> = {
  externalid: 'externalId',
  id: 'scimId',
  displayname: 'displayName',
};

export interface GroupFilterResult {
  dbWhere: Record<string, unknown>;
  inMemoryFilter?: (resource: Record<string, unknown>) => boolean;
  fetchAll: boolean;
}

export function buildGroupFilter(filter?: string): GroupFilterResult {
  if (!filter) {
    return { dbWhere: {}, fetchAll: false };
  }

  let ast: FilterNode;
  try {
    ast = parseScimFilter(filter);
  } catch {
    throw new Error(`Invalid filter: ${filter}`);
  }

  const dbClause = tryPushToDb(ast, GROUP_DB_COLUMNS);
  if (dbClause) {
    return { dbWhere: dbClause, fetchAll: false };
  }

  return {
    dbWhere: {},
    fetchAll: true,
    inMemoryFilter: (resource) => evaluateFilter(ast, resource),
  };
}

// ─── Shared ──────────────────────────────────────────────────────────────────

/**
 * Attempt to convert a simple `attrPath eq "value"` AST into a Prisma where clause.
 * Returns null if the AST is too complex for DB push-down.
 *
 * Phase 3: CITEXT columns (userName, displayName) handle case-insensitive
 * comparison natively in PostgreSQL — no toLowerCase needed. The InMemory
 * repository also handles case-insensitive comparison at query time.
 */
function tryPushToDb(
  ast: FilterNode,
  columnMap: Record<string, string>,
): Record<string, unknown> | null {
  if (ast.type !== 'compare') return null;

  const node = ast as CompareNode;
  if (node.op !== 'eq') return null;
  if (typeof node.value !== 'string' && typeof node.value !== 'number' && typeof node.value !== 'boolean') return null;

  const attrLower = node.attrPath.toLowerCase();
  const column = columnMap[attrLower];
  if (!column) return null;

  // Phase 3: Pass value as-is — CITEXT handles case-insensitive matching
  return { [column]: node.value };
}
