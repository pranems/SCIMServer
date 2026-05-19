/**
 * Per-status-code MSW error handlers (overrides for the happy-path
 * default exported by `./handlers`).
 *
 * Phase H1: tests that need to drive the UI through an error branch
 * (TokenGate 401, RBAC 403, missing endpoint 404, uniqueness conflict
 * 409, server crash 500) call:
 *
 *   import { errorHandlers } from '@/test/msw/error-handlers';
 *   server.use(errorHandlers.dashboard500());
 *
 * Each factory returns one MSW handler so the caller can compose
 * exactly the failure modes their assertion needs without importing
 * the entire error catalog.
 */
import { http, HttpResponse } from 'msw';

/** Builder for an error JSON body matching the SCIMServer error envelope. */
function errorBody(status: number, detail: string, extras: Record<string, unknown> = {}) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
    ...extras,
  };
}

export const errorHandlers = {
  // Auth (401): TokenGate triggers a forced re-prompt + clears the
  // stored bearer; queries.ts also notifies via notifyTokenInvalid().
  dashboard401: () =>
    http.get('*/scim/admin/dashboard', () =>
      HttpResponse.json(errorBody(401, 'Authentication required'), { status: 401 }),
    ),

  endpoints401: () =>
    http.get('*/scim/admin/endpoints', () =>
      HttpResponse.json(errorBody(401, 'Authentication required'), { status: 401 }),
    ),

  // RBAC (403): admin endpoints exist but the bearer lacks the role.
  // Used by tests that assert the page renders an "access denied"
  // banner instead of crashing.
  endpointDetail403: () =>
    http.get('*/scim/admin/endpoints/:id', () =>
      HttpResponse.json(errorBody(403, 'Forbidden'), { status: 403 }),
    ),

  // Unknown resource (404): used by EndpointDetailPage to assert the
  // "Failed to load endpoint" branch.
  endpointDetail404: () =>
    http.get('*/scim/admin/endpoints/:id', () =>
      HttpResponse.json(errorBody(404, 'Endpoint not found'), { status: 404 }),
    ),

  endpointOverview404: () =>
    http.get('*/scim/admin/endpoints/:id/overview', () =>
      HttpResponse.json(errorBody(404, 'Endpoint not found'), { status: 404 }),
    ),

  // Uniqueness conflict (409): credential or endpoint create body
  // duplicates an existing label/name.
  credentialCreate409: () =>
    http.post('*/scim/admin/endpoints/:id/credentials', () =>
      HttpResponse.json(
        errorBody(409, 'Credential label already exists', { scimType: 'uniqueness' }),
        { status: 409 },
      ),
    ),

  // Server error (500): crashed BFF; tests assert the ErrorBoundary
  // / "Failed to load" branch.
  dashboard500: () =>
    http.get('*/scim/admin/dashboard', () =>
      HttpResponse.json(errorBody(500, 'Internal Server Error'), { status: 500 }),
    ),

  endpoints500: () =>
    http.get('*/scim/admin/endpoints', () =>
      HttpResponse.json(errorBody(500, 'Internal Server Error'), { status: 500 }),
    ),

  logs500: () =>
    http.get('*/scim/admin/logs', () =>
      HttpResponse.json(errorBody(500, 'Internal Server Error'), { status: 500 }),
    ),
};
