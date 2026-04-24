/**
 * SCIM Sort Utility - RFC 7644 §3.4.2.3
 *
 * Maps SCIM attribute names (e.g. "userName", "meta.created") to
 * database field names and resolves sort direction.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.3
 */

/**
 * Maps SCIM attribute paths to database column names for Users.
 * SCIM attribute names are case-insensitive per RFC 7643 §2.1.
 */
const USER_SORT_ATTRIBUTE_MAP: Record<string, string> = {
  id: 'scimId',
  externalid: 'externalId',
  username: 'userName',
  displayname: 'displayName',
  active: 'active',
  'meta.created': 'createdAt',
  'meta.lastmodified': 'updatedAt',
};

/**
 * Maps SCIM attribute paths to database column names for Groups.
 */
const GROUP_SORT_ATTRIBUTE_MAP: Record<string, string> = {
  id: 'scimId',
  externalid: 'externalId',
  displayname: 'displayName',
  'meta.created': 'createdAt',
  'meta.lastmodified': 'updatedAt',
};

/** Default sort order per RFC 7644 §3.4.2.3: ascending */
const DEFAULT_SORT_DIRECTION: 'asc' | 'desc' = 'asc';

/** Default sort field when no sortBy is specified */
const DEFAULT_SORT_FIELD = 'createdAt';

export interface SortParams {
  field: string;
  direction: 'asc' | 'desc';
  /** Whether the sort attribute is caseExact per schema. When false, sort uses case-insensitive comparison. */
  caseExact: boolean;
}

/**
 * Resolve a SCIM sortBy + sortOrder into a database-level sort specification for Users.
 *
 * @param sortBy          SCIM attribute path (e.g. "userName", "meta.created"). Case-insensitive.
 * @param sortOrder       "ascending" | "descending" - defaults to "ascending" per RFC 7644.
 * @param caseExactPaths  Optional set of caseExact attribute paths from schema cache.
 * @returns               Database-level sort params with caseExact flag.
 */
export function resolveUserSortParams(
  sortBy?: string,
  sortOrder?: 'ascending' | 'descending',
  caseExactPaths?: Set<string>,
): SortParams {
  const direction: 'asc' | 'desc' =
    sortOrder === 'descending' ? 'desc' : DEFAULT_SORT_DIRECTION;

  if (!sortBy) {
    return { field: DEFAULT_SORT_FIELD, direction, caseExact: true };
  }

  const sortByLower = sortBy.toLowerCase();
  const dbField = USER_SORT_ATTRIBUTE_MAP[sortByLower];
  if (!dbField) {
    return { field: DEFAULT_SORT_FIELD, direction, caseExact: true };
  }

  const caseExact = caseExactPaths ? caseExactPaths.has(sortByLower) : false;
  return { field: dbField, direction, caseExact };
}

/**
 * Resolve a SCIM sortBy + sortOrder into a database-level sort specification for Groups.
 *
 * @param sortBy          SCIM attribute path (e.g. "displayName", "meta.created"). Case-insensitive.
 * @param sortOrder       "ascending" | "descending" - defaults to "ascending" per RFC 7644.
 * @param caseExactPaths  Optional set of caseExact attribute paths from schema cache.
 * @returns               Database-level sort params with caseExact flag.
 */
export function resolveGroupSortParams(
  sortBy?: string,
  sortOrder?: 'ascending' | 'descending',
  caseExactPaths?: Set<string>,
): SortParams {
  const direction: 'asc' | 'desc' =
    sortOrder === 'descending' ? 'desc' : DEFAULT_SORT_DIRECTION;

  if (!sortBy) {
    return { field: DEFAULT_SORT_FIELD, direction, caseExact: true };
  }

  const sortByLower = sortBy.toLowerCase();
  const dbField = GROUP_SORT_ATTRIBUTE_MAP[sortByLower];
  if (!dbField) {
    return { field: DEFAULT_SORT_FIELD, direction, caseExact: true };
  }

  const caseExact = caseExactPaths ? caseExactPaths.has(sortByLower) : false;
  return { field: dbField, direction, caseExact };
}
