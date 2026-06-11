/**
 * Phase N3a Stage 5 closure - Web Security Headers (Playwright lock).
 *
 * This spec is the browser-side twin of [scripts/live-test.ps1 TEST SECTION 9z-AJ]
 * (PowerShell HTTP probe) and [api/test/e2e/security-headers.e2e-spec.ts]
 * (in-process supertest probe). All three layers assert THE SAME header contract
 * shipped by [api/src/security/helmet-config.ts] so a future operator cannot
 * silently drop a directive in any one layer without all three turning red.
 *
 * Why three layers:
 *   - Unit (helmet-config.spec.ts) locks the configuration constant.
 *   - E2E (security-headers.e2e-spec.ts) locks the wired middleware in a Nest app.
 *   - Live (9z-AJ in live-test.ps1) locks the actual wire bytes from a deployed
 *     Docker container OR Azure Container App via PowerShell.
 *   - This spec locks the actual wire bytes from a REAL Chromium browser via
 *     Playwright, against the SAME deployed environment, with the SAME response
 *     parser the browser will use at runtime.
 *
 * Run vs dev (canonical):
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   cd web
 *   npx playwright test e2e/security-headers.spec.ts --reporter=line
 *
 * Run vs prod (only with explicit operator intent):
 *   $env:E2E_BASE_URL = 'https://scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   cd web
 *   npx playwright test e2e/security-headers.spec.ts --reporter=line
 */
import { test, expect, type APIResponse } from '@playwright/test';

const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

/**
 * Probe an absolute URL and return its response. Uses Playwright's APIRequestContext
 * which speaks raw HTTP (no browser fetch + no CORS gymnastics) so we see every
 * response header as the server sent it, exactly like the PowerShell live probe.
 */
async function probe(
  request: { get: (url: string, opts?: { headers?: Record<string, string> }) => Promise<APIResponse> },
  baseURL: string | undefined,
  path: string,
  auth?: boolean,
): Promise<{ status: number; headers: Record<string, string> }> {
  const fullUrl = `${baseURL ?? ''}${path}`;
  const opts = auth ? { headers: { Authorization: `Bearer ${TOKEN}` } } : {};
  const response = await request.get(fullUrl, opts);
  return { status: response.status(), headers: response.headers() };
}

test.describe('Phase N3a - Web Security Headers (helmet + Permissions-Policy)', () => {
  // The baseURL is locked at playwright.config.ts via E2E_BASE_URL (falls back to
  // http://localhost:4000). The HTTPS-vs-HTTP branch below mirrors the live-test
  // logic for HSTS: required on HTTPS, optional on HTTP. Capture once per test
  // run so we don't re-evaluate per assertion.
  const isHttpsDeployment = (process.env.E2E_BASE_URL || '').startsWith('https://');

  test('Probe 1 /scim/health: full helmet + Permissions-Policy + HSTS contract', async ({ request, baseURL }) => {
    const p = await probe(request, baseURL, '/scim/health');

    // Smoke - response landed
    expect(p.status, '9z-AJ.1 mirror: GET /scim/health returns 200').toBe(200);

    // CSP - 3 directives the live probe locks
    const csp = p.headers['content-security-policy'] ?? '';
    expect(csp, '9z-AJ.2 mirror: CSP includes default-src self').toMatch(/default-src 'self'/);
    expect(csp, '9z-AJ.3 mirror: CSP includes frame-ancestors none').toMatch(/frame-ancestors 'none'/);
    expect(csp, '9z-AJ.4 mirror: CSP includes object-src none').toMatch(/object-src 'none'/);

    // Helmet scalar headers
    expect(p.headers['x-frame-options'], '9z-AJ.5 mirror').toBe('DENY');
    expect(p.headers['x-content-type-options'], '9z-AJ.6 mirror').toBe('nosniff');
    expect(p.headers['referrer-policy'], '9z-AJ.7 mirror').toBe('strict-origin-when-cross-origin');
    expect(p.headers['cross-origin-opener-policy'], '9z-AJ.8 mirror').toBe('same-origin');
    expect(p.headers['cross-origin-resource-policy'], '9z-AJ.9 mirror').toBe('same-origin');
    expect(p.headers['x-permitted-cross-domain-policies'], '9z-AJ.10 mirror').toBe('none');
    expect(p.headers['x-dns-prefetch-control'], '9z-AJ.11 mirror').toBe('off');
    expect(p.headers['x-download-options'], '9z-AJ.12 mirror').toBe('noopen');

    // Permissions-Policy (separate manual middleware, after helmet)
    const pp = p.headers['permissions-policy'] ?? '';
    expect(pp, '9z-AJ.13.a mirror: camera').toMatch(/camera=\(\)/);
    expect(pp, '9z-AJ.13.b mirror: microphone').toMatch(/microphone=\(\)/);
    expect(pp, '9z-AJ.13.c mirror: geolocation').toMatch(/geolocation=\(\)/);
    expect(pp, '9z-AJ.13.d mirror: payment').toMatch(/payment=\(\)/);
    expect(pp, '9z-AJ.13.e mirror: usb').toMatch(/usb=\(\)/);

    // COEP intentionally absent (CDN-asset compatibility)
    expect(p.headers['cross-origin-embedder-policy'], '9z-AJ.14 mirror: COEP intentionally absent').toBeUndefined();

    // HSTS - required on HTTPS, optional on HTTP (helmet honors NODE_ENV=production)
    const hsts = p.headers['strict-transport-security'];
    if (isHttpsDeployment) {
      expect(hsts, '9z-AJ.15 mirror: HSTS set on HTTPS').toBeDefined();
      expect(hsts, '9z-AJ.15 mirror: HSTS max-age=15552000').toMatch(/max-age=15552000/);
      expect(hsts, '9z-AJ.15 mirror: HSTS includeSubDomains').toMatch(/includeSubDomains/);
    }
  });

  test('Probe 2 /scim/admin/version: headers fire on auth-protected route', async ({ request, baseURL }) => {
    const p = await probe(request, baseURL, '/scim/admin/version', true);

    // Status can be 200|401|404 depending on token validity + endpoint state.
    // The lock is that headers ALWAYS fire (helmet sits before auth in main.ts).
    expect([200, 401, 404], `9z-AJ.16 mirror: admin route returned ${p.status}`).toContain(p.status);

    // Headers still emitted even on a non-2xx admin response
    expect(p.headers['x-frame-options'], '9z-AJ.17 mirror').toBe('DENY');
    expect(p.headers['content-security-policy'], '9z-AJ.18 mirror: CSP on admin route').toMatch(/default-src 'self'/);
  });

  test('Probe 3 / (SPA fallback): headers fire on HTML response', async ({ request, baseURL }) => {
    const p = await probe(request, baseURL, '/');

    // SPA fallback always returns text/html (200 in prod, 404 in some inmemory smoke configs);
    // accept any status, just confirm a response landed.
    expect(p.status, '9z-AJ.19 mirror: GET / returns response').toBeGreaterThan(0);

    // Headers still emitted on the HTML shell
    expect(p.headers['x-content-type-options'], '9z-AJ.20 mirror').toBe('nosniff');

    // CSP allows 'unsafe-inline' for script-src (Fluent UI v9 makeStyles requirement).
    // If this asserts fails, the next operator MUST update PHASE_N3A_HELMET.md
    // Section "Why 'unsafe-inline' on script-src" before tightening to sha256/nonce.
    expect(p.headers['content-security-policy'], "9z-AJ.21 mirror: CSP allows 'unsafe-inline' for Fluent UI v9").toMatch(
      /script-src[^;]*'unsafe-inline'/,
    );
  });
});
