/**
 * SCIM Filter Application Utility
 *
 * Bridges the AST-based filter parser with the Prisma data layer.
 * Produces Prisma `where` clauses for all pushable filter expressions:
 *   - eq, ne, co, sw, ew, gt, ge, lt, le, pr on indexed DB columns
 *   - AND / OR compound expressions (recursive push-down)
 * Falls back to in-memory evaluation (evaluateFilter) only when the AST
 * contains nodes that cannot be pushed (e.g., valuePath, not, un-mapped attributes).
 *
 * Phase 3: Column maps reference actual column names (userName, displayName)
 *   because PostgreSQL CITEXT handles case-insensitive comparison natively.
 * Phase 4: Full operator push-down — co/sw/ew via Prisma string filters
 *   (leveraging pg_trgm GIN indexes), gt/ge/lt/le for ordering comparisons,
 *   pr for presence, ne for negation. AND/OR compound push-down added.
 *
 * @see scim-filter-parser.ts for the AST types and evaluator
 */

import {
  parseScimFilter,
  evaluateFilter,
  type FilterNode,
  type CompareNode,
  type LogicalNode,
} from './scim-filter-parser';

// ─── Column Map Types ────────────────────────────────────────────────────────

/** Column type determines which Prisma operators are valid for push-down */
type ColumnType = 'citext' | 'text' | 'varchar' | 'boolean' | 'uuid';

interface ColumnMapping {
  /** Prisma model field name (e.g. 'userName', 'displayName') */
  column: string;
  /** PostgreSQL column type — drives operator translation */
  type: ColumnType;
}

/** Lowercase SCIM attribute name → Prisma column + type */
type ColumnMap = Record<string, ColumnMapping>;

// ─── Users ───────────────────────────────────────────────────────────────────

/**
 * DB-pushable column map for Users.
 *
 * Phase 4: Expanded with displayName (citext) and active (boolean) so that
 * filters on these common attributes are pushed to PostgreSQL instead of
 * falling back to full-table scan + in-memory evaluation.
 */
const USER_DB_COLUMNS: ColumnMap = {
  username:    { column: 'userName',    type: 'citext' },
  displayname: { column: 'displayName', type: 'citext' },
  externalid:  { column: 'externalId',  type: 'text' },    // caseExact=true per RFC 7643
  id:          { column: 'scimId',      type: 'uuid' },
  active:      { column: 'active',      type: 'boolean' },
};

export interface UserFilterResult {
  /** DB-level Prisma where clause. May contain nested Prisma operators. */
  dbWhere: Record<string, unknown>;
  /** If set, the in-memory filter fn to apply after DB fetch */
  inMemoryFilter?: (resource: Record<string, unknown>) => boolean;
  /** When true, the DB fetch should return all records for the endpoint (filter is in-memory only) */
  fetchAll: boolean;
}

/**
 * Parse a SCIM filter string and determine how to apply it for Users.
 *
 * Phase 4: Pushes all operators (eq/ne/co/sw/ew/gt/ge/lt/le/pr) on mapped
 * columns and compound AND/OR expressions to the database. Only falls back
 * to in-memory for valuePath, not(), or un-mapped attribute paths.
 */
export function buildUserFilter(filter?: string): UserFilterResult {
  if (!filter) {
    return { dbWhere: {}, fetchAll: false };
  }

  let ast: FilterNode;
  try {
    ast = parseScimFilter(filter);
  } catch {
    throw new Error(`Invalid filter: ${filter}`);
  }

  return buildFilterResult(ast, USER_DB_COLUMNS);
}

// ─── Groups ──────────────────────────────────────────────────────────────────

/**
 * DB-pushable column map for Groups.
 *
 * Phase 3: displayName maps directly to the CITEXT column.
 * Phase 4: Expanded with active (boolean).
 */
const GROUP_DB_COLUMNS: ColumnMap = {
  displayname: { column: 'displayName', type: 'citext' },
  externalid:  { column: 'externalId',  type: 'text' },    // caseExact=true per RFC 7643
  id:          { column: 'scimId',      type: 'uuid' },
  active:      { column: 'active',      type: 'boolean' },
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

  return buildFilterResult(ast, GROUP_DB_COLUMNS);
}

// ─── Shared ──────────────────────────────────────────────────────────────────

/**
 * Build a filter result from an AST and column map.
 * Attempts full DB push-down first; falls back to in-memory if needed.
 */
function buildFilterResult(
  ast: FilterNode,
  columnMap: ColumnMap,
): { dbWhere: Record<string, unknown>; inMemoryFilter?: (r: Record<string, unknown>) => boolean; fetchAll: boolean } {
  const dbClause = tryPushToDb(ast, columnMap);
  if (dbClause) {
    return { dbWhere: dbClause, fetchAll: false };
  }

  // Cannot fully push → in-memory evaluation
  return {
    dbWhere: {},
    fetchAll: true,
    inMemoryFilter: (resource) => evaluateFilter(ast, resource),
  };
}

/**
 * Attempt to convert a filter AST node into a Prisma where clause.
 * Returns null if the node (or any descendant) cannot be pushed to the DB.
 *
 * Phase 4: Handles all SCIM comparison operators + AND/OR logical nodes.
 *
 * Supported push-down:
 *   - CompareNode on mapped columns → Prisma scalar/string filter
 *   - LogicalNode (and/or) → Prisma AND/OR arrays (recursive)
 *
 * NOT pushed (returns null):
 *   - Attributes not in the column map (e.g. emails.value, name.givenName)
 *   - NotNode (not (...)) — Prisma NOT is possible but deferred for simplicity
 *   - ValuePathNode (attrPath[valFilter]) — requires JSONB query
 */
function tryPushToDb(
  ast: FilterNode,
  columnMap: ColumnMap,
): Record<string, unknown> | null {
  switch (ast.type) {
    case 'compare':
      return pushCompareToDb(ast as CompareNode, columnMap);

    case 'logical':
      return pushLogicalToDb(ast as LogicalNode, columnMap);

    // not() and valuePath[] — cannot push (yet)
    default:
      return null;
  }
}

/**
 * Push a single comparison node to DB.
 * Maps the SCIM attribute to a Prisma column and translates the operator.
 */
function pushCompareToDb(
  node: CompareNode,
  columnMap: ColumnMap,
): Record<string, unknown> | null {
  const attrLower = node.attrPath.toLowerCase();
  const mapped = columnMap[attrLower];
  if (!mapped) return null; // un-mapped attribute → cannot push

  return buildColumnFilter(mapped.column, mapped.type, node.op, node.value);
}

/**
 * Translate a SCIM operator + value into a Prisma field-level filter.
 *
 * Case sensitivity follows RFC 7643 §2.2 "caseExact" semantics:
 *   - citext/varchar columns (caseExact=false): co/sw/ew use mode:'insensitive'
 *   - text columns (caseExact=true, e.g. externalId): co/sw/ew are case-sensitive
 *
 * For boolean columns, only eq/ne/pr make semantic sense.
 */
function buildColumnFilter(
  column: string,
  type: ColumnType,
  op: string,
  value: unknown,
): Record<string, unknown> | null {
  // String types that support co/sw/ew
  const isStringType = type === 'citext' || type === 'varchar' || type === 'text';
  // Case-insensitive types (caseExact=false per RFC)
  const isCaseInsensitive = type === 'citext' || type === 'varchar';

  switch (op) {
    case 'eq':
      return { [column]: value };

    case 'ne':
      return { [column]: { not: value } };

    case 'co':
      if (!isStringType) return null;
      return isCaseInsensitive
        ? { [column]: { contains: String(value), mode: 'insensitive' } }
        : { [column]: { contains: String(value) } };

    case 'sw':
      if (!isStringType) return null;
      return isCaseInsensitive
        ? { [column]: { startsWith: String(value), mode: 'insensitive' } }
        : { [column]: { startsWith: String(value) } };

    case 'ew':
      if (!isStringType) return null;
      return isCaseInsensitive
        ? { [column]: { endsWith: String(value), mode: 'insensitive' } }
        : { [column]: { endsWith: String(value) } };

    case 'gt':
      return { [column]: { gt: value } };

    case 'ge':
      return { [column]: { gte: value } };

    case 'lt':
      return { [column]: { lt: value } };

    case 'le':
      return { [column]: { lte: value } };

    case 'pr':
      return { [column]: { not: null } };

    default:
      return null;
  }
}

/**
 * Push a logical (AND / OR) node to DB.
 *
 * AND: Both sides must be pushable for a full push. If only one side pushes,
 *   we still can't use partial push because the un-pushable side would be lost.
 *   Instead, we fall back to full in-memory evaluation for safety.
 *
 * OR: Both sides must be pushable — if either side can't push, we must fetchAll
 *   because we can't guarantee completeness.
 */
function pushLogicalToDb(
  node: LogicalNode,
  columnMap: ColumnMap,
): Record<string, unknown> | null {
  const left = tryPushToDb(node.left, columnMap);
  const right = tryPushToDb(node.right, columnMap);

  if (node.op === 'and') {
    if (left && right) return { AND: [left, right] };
    // Partial push is unsafe — the un-pushed side filters would be lost
    return null;
  }

  if (node.op === 'or') {
    if (left && right) return { OR: [left, right] };
    return null;
  }

  return null;
}
