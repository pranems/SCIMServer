/**
 * Shared API Response Contract Assertion Helpers
 *
 * Provides reusable assertion functions for verifying API response shapes
 * across all test levels (unit, E2E, live). Ensures:
 *  - Key allowlists: only documented fields appear in responses
 *  - Key denylists: internal fields never leak into responses
 *  - Deep recursive scanning for nested object leaks
 *  - SCIM-compliant response shapes (ListResponse, Error, Meta)
 *
 * @see .github/prompts/apiContractVerification.prompt.md
 */

// ─── Global Denylist ────────────────────────────────────────────────────────
// Fields that must NEVER appear in any API response at any level.
export const INTERNAL_DENYLIST = [
  '_schemaCaches',
  '_rawPayload',
  '_prismaMetadata',
  '_version',
  'endpointId',
  'scimId',
  'rawPayload',
  'stackTrace',
  'stack',
] as const;

// ─── SCIM Schema URNs ──────────────────────────────────────────────────────
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_LIST_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_DIAGNOSTICS_URN = 'urn:scimserver:api:messages:2.0:Diagnostics';

// ─── Key Allowlists ─────────────────────────────────────────────────────────

export const META_ALLOWED_KEYS = ['resourceType', 'created', 'lastModified', 'location', 'version'];

export const LIST_RESPONSE_ALLOWED_KEYS = ['schemas', 'totalResults', 'startIndex', 'itemsPerPage', 'Resources'];

export const ERROR_RESPONSE_ALLOWED_KEYS = ['schemas', 'status', 'scimType', 'detail', SCIM_DIAGNOSTICS_URN];

export const ADMIN_ENDPOINT_FULL_KEYS = [
  'id', 'name', 'displayName', 'description', 'profile',
  'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
];

export const ADMIN_ENDPOINT_SUMMARY_KEYS = [
  'id', 'name', 'displayName', 'description', 'profileSummary',
  'active', 'scimBasePath', 'createdAt', 'updatedAt', '_links',
];

export const PROFILE_ALLOWED_KEYS = ['schemas', 'settings', 'resourceTypes', 'serviceProviderConfig'];

export const BULK_RESPONSE_ALLOWED_KEYS = ['schemas', 'Operations'];

// ─── Assertion Functions ────────────────────────────────────────────────────

/**
 * Assert that every key in the response body is in the allowed set.
 * Fails with a descriptive message showing the extra key and context.
 */
export function assertAllowedKeys(
  body: Record<string, unknown>,
  allowed: string[],
  context: string,
): void {
  const actualKeys = Object.keys(body);
  for (const key of actualKeys) {
    expect(allowed).toContain(key);
  }
}

/**
 * Assert that required keys are all present.
 */
export function assertRequiredKeys(
  body: Record<string, unknown>,
  requiredKeys: string[],
  context: string,
): void {
  for (const key of requiredKeys) {
    expect(body).toHaveProperty(key);
  }
}

/**
 * Assert that a response body contains no internal/leaked fields.
 * Checks the global denylist and verifies no _-prefixed keys (except _links).
 */
export function assertNoDeniedFields(
  body: Record<string, unknown>,
  context: string,
): void {
  for (const field of INTERNAL_DENYLIST) {
    expect(body).not.toHaveProperty(field);
  }
  const underscoreKeys = Object.keys(body).filter(
    (k) => k.startsWith('_') && k !== '_links',
  );
  if (underscoreKeys.length > 0) {
    fail(`${context}: unexpected _-prefixed keys: ${underscoreKeys.join(', ')}`);
  }
}

/**
 * Deep recursive scan: check all nested objects for denied keys.
 * Catches leaked fields at any nesting depth.
 */
export function assertNoDeniedFieldsDeep(
  obj: unknown,
  path = '',
  label = '',
): void {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoDeniedFieldsDeep(item, `${path}[${i}]`, label));
    return;
  }
  assertNoDeniedFields(obj as Record<string, unknown>, `${label}@${path}`);
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    assertNoDeniedFieldsDeep(value, path ? `${path}.${key}` : key, label);
  }
}

/**
 * Assert SCIM ListResponse envelope shape.
 */
export function assertListResponseShape(body: Record<string, unknown>): void {
  expect(body.schemas).toContain(SCIM_LIST_RESPONSE_SCHEMA);
  expect(typeof body.totalResults).toBe('number');
  expect(typeof body.startIndex).toBe('number');
  expect(typeof body.itemsPerPage).toBe('number');
  expect(Array.isArray(body.Resources)).toBe(true);
  assertAllowedKeys(body, LIST_RESPONSE_ALLOWED_KEYS, 'ListResponse');
}

/**
 * Assert SCIM Error response shape.
 */
export function assertErrorResponseShape(body: Record<string, unknown>): void {
  expect(body.schemas).toContain(SCIM_ERROR_SCHEMA);
  expect(typeof body.status).toBe('string');
  expect(typeof body.detail).toBe('string');
  assertAllowedKeys(body, ERROR_RESPONSE_ALLOWED_KEYS, 'ScimError');
}

/**
 * Assert SCIM resource meta sub-object shape.
 */
export function assertMetaShape(meta: Record<string, unknown>): void {
  assertAllowedKeys(meta, META_ALLOWED_KEYS, 'meta');
  expect(meta.resourceType).toBeDefined();
  expect(meta.location).toBeDefined();
}

/**
 * Assert admin endpoint full view response shape.
 */
export function assertAdminEndpointFullShape(body: Record<string, unknown>): void {
  assertAllowedKeys(body, ADMIN_ENDPOINT_FULL_KEYS, 'AdminEndpointFull');
  assertNoDeniedFields(body, 'AdminEndpointFull');
  if (body.profile && typeof body.profile === 'object') {
    assertAllowedKeys(body.profile as Record<string, unknown>, PROFILE_ALLOWED_KEYS, 'Profile');
  }
}

/**
 * Assert SCIM Bulk response shape.
 */
export function assertBulkResponseShape(body: Record<string, unknown>): void {
  expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:BulkResponse');
  assertAllowedKeys(body, BULK_RESPONSE_ALLOWED_KEYS, 'BulkResponse');
  expect(Array.isArray(body.Operations)).toBe(true);
}
