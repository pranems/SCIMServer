/**
 * SCIM Filter Application Utility
 *
 * Bridges the AST-based filter parser with the Prisma data layer.
 * For simple `eq` filters on indexed DB columns, produces a Prisma `where` clause.
 * For all other filters, falls back to in-memory evaluation using evaluateFilter().
 *
 * @see scim-filter-parser.ts for the AST types and evaluator
 */

import type { Prisma } from '@prisma/client';
import {
  parseScimFilter,
  evaluateFilter,
  type FilterNode,
  type CompareNode,
} from './scim-filter-parser';

// ─── Users ───────────────────────────────────────────────────────────────────

/** DB-pushable column map for ScimUser (attribute name → Prisma column) */
const USER_DB_COLUMNS: Record<string, string> = {
  username: 'userNameLower',   // case-insensitive via lowercase column
  externalid: 'externalId',
  id: 'scimId',
};

export interface UserFilterResult {
  /** Prisma where clause for DB-level filtering */
  dbWhere: Prisma.ScimUserWhereInput;
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
 * DB-pushable column map for ScimGroup.
 *
 * NOTE: displayName is intentionally excluded — SQLite performs
 * case-sensitive comparisons by default and there is no lowercase
 * column for displayName.  Pushing it to the DB would fail the
 * RFC 7643 §2.1 requirement that attribute comparisons are
 * case-insensitive.  The in-memory evaluator handles it correctly.
 */
const GROUP_DB_COLUMNS: Record<string, string> = {
  externalid: 'externalId',
  id: 'scimId',
};

export interface GroupFilterResult {
  dbWhere: Prisma.ScimGroupWhereInput;
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
 * For userName, comparison is always case-insensitive (RFC 7643 §2.1: caseExact=false),
 * so we query via the lowercase column.
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

  // For userName we stored the lowercase column; compare against lowercase value
  if (attrLower === 'username' && typeof node.value === 'string') {
    return { [column]: node.value.toLowerCase() };
  }

  return { [column]: node.value };
}
