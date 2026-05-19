/**
 * MSW handlers for the SCIMServer admin BFF + SCIM discovery surface.
 *
 * Phase H1: replaces the ad-hoc `vi.fn().mockReturnValue(...)` patterns
 * sprinkled across page-level vitest specs with a network-level mock so
 * the React Query stack (queryFn, error mapping, retry, cache) gets
 * exercised end-to-end. Tests still get fast, deterministic responses
 * but now route through the real `fetchWithAuth` -> useQuery code path.
 *
 * Coverage target: the 12 admin endpoints the redesigned UI hits, plus
 * the SCIM `/Schemas` endpoint that SchemasTab consumes.
 *
 * Design choices:
 *   - One handler per shape, returning a fixture from `./fixtures`. No
 *     dynamic data generation - tests that need a different shape can
 *     `server.use(http.get(..., () => HttpResponse.json(custom)))` to
 *     override per-test (this is the standard MSW pattern).
 *   - Wildcards on the URL prefix (any-host + path) so the same
 *     handlers work whether the test sets `VITE_API_BASE` or not.
 *   - Error variants live in a sibling file (`./error-handlers`) and
 *     are pulled in only by the tests that exercise them; the default
 *     export here is the happy-path set.
 *
 * @see web/src/test/msw/server.ts (Node test runner setup)
 * @see web/src/test/msw/error-handlers.ts (401/403/404/409/500 variants)
 * @see docs/PHASE_H1_MSW_HANDLERS.md
 */
import { http, HttpResponse } from 'msw';
import {
  FIXTURE_ACTIVITY,
  FIXTURE_DASHBOARD,
  FIXTURE_ENDPOINT,
  FIXTURE_ENDPOINT_ID,
  FIXTURE_ENDPOINT_LIST,
  FIXTURE_ENDPOINT_OVERVIEW,
  FIXTURE_ENDPOINT_STATS,
  FIXTURE_HEALTH,
  FIXTURE_LOGS,
  FIXTURE_LOG_DETAIL,
  FIXTURE_SCHEMAS,
  FIXTURE_VERSION,
} from './fixtures';

/**
 * Default-export array of MSW request handlers.
 *
 * Wildcard prefix `*` so handlers match whether the request URL is
 * absolute (e.g. `https://example.com/scim/admin/dashboard` when a
 * test sets `VITE_API_BASE`) or relative (`/scim/admin/dashboard`
 * which jsdom resolves against `http://localhost`).
 */
export const handlers = [
  // Dashboard BFF (Phase B + Phase D4 charts).
  http.get('*/scim/admin/dashboard', () => HttpResponse.json(FIXTURE_DASHBOARD)),

  // Endpoint list (admin grid).
  http.get('*/scim/admin/endpoints', () => HttpResponse.json(FIXTURE_ENDPOINT_LIST)),

  // Endpoint overview BFF (Phase B1).
  http.get('*/scim/admin/endpoints/:id/overview', ({ params }) => {
    if (params.id !== FIXTURE_ENDPOINT_ID) {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json(FIXTURE_ENDPOINT_OVERVIEW);
  }),

  // Endpoint stats.
  http.get('*/scim/admin/endpoints/:id/stats', ({ params }) => {
    if (params.id !== FIXTURE_ENDPOINT_ID) {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json(FIXTURE_ENDPOINT_STATS);
  }),

  // Endpoint detail (full view) - must be after the more-specific
  // /overview and /stats routes so MSW's match order favors them. MSW
  // is order-sensitive for overlapping path patterns.
  http.get('*/scim/admin/endpoints/:id', ({ params }) => {
    if (params.id !== FIXTURE_ENDPOINT_ID) {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json(FIXTURE_ENDPOINT);
  }),

  // PATCH endpoint config (Phase E2 toggles).
  http.patch('*/scim/admin/endpoints/:id', async ({ params, request }) => {
    if (params.id !== FIXTURE_ENDPOINT_ID) {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    // Echo back the merged endpoint - tests that need a specific shape
    // can override per-test with `server.use(...)`.
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...FIXTURE_ENDPOINT, ...body });
  }),

  // Per-endpoint credentials (Phase G11 + Phase E1).
  http.post('*/scim/admin/endpoints/:id/credentials', async ({ params, request }) => {
    if (params.id !== FIXTURE_ENDPOINT_ID) {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    const body = (await request.json()) as { label?: string };
    return HttpResponse.json(
      {
        id: 'cred-new',
        label: body.label ?? 'New credential',
        credentialType: 'bearer',
        active: true,
        createdAt: new Date().toISOString(),
        // Plaintext token returned ONCE per Phase G11 contract.
        token: 'msw-test-plaintext-token-do-not-use',
      },
      { status: 201 },
    );
  }),

  http.delete('*/scim/admin/endpoints/:id/credentials/:credentialId', () =>
    new HttpResponse(null, { status: 204 }),
  ),

  // Global / per-endpoint logs (Phase D5 + Phase 4 logs page).
  http.get('*/scim/admin/logs', () => HttpResponse.json(FIXTURE_LOGS)),
  http.get('*/scim/admin/logs/:id', ({ params }) => {
    if (params.id !== 'log-1') {
      return HttpResponse.json({ detail: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json(FIXTURE_LOG_DETAIL);
  }),

  // Activity feed (Phase D2).
  http.get('*/scim/admin/activity', () => HttpResponse.json(FIXTURE_ACTIVITY)),

  // Version + health (Settings page + boot probe).
  http.get('*/scim/admin/version', () => HttpResponse.json(FIXTURE_VERSION)),
  http.get('*/scim/health', () => HttpResponse.json(FIXTURE_HEALTH)),

  // SCIM /Schemas (per-endpoint schema discovery used by SchemasTab).
  // Two URL shapes hit this:
  //   - `/scim/v2/<scimBasePath>/Schemas` (what real Entra/Okta hit)
  //   - `/scim/admin/endpoints/:id/Schemas` (what SchemasTab uses)
  http.get('*/scim/v2/*/Schemas', () => HttpResponse.json(FIXTURE_SCHEMAS)),
  http.get('*/scim/admin/endpoints/:id/Schemas', () => HttpResponse.json(FIXTURE_SCHEMAS)),
];
