/**
 * Security headers E2E (Phase N3a closure).
 *
 * Locks in the `helmet` middleware rollout. Per the 2026-05-17 Stage X.2
 * `securityBestPracticesIntake` first-run report, this was the
 * HIGHEST-LEVERAGE NEW GAP - the application shipped to dev/prod without
 * any of the standard browser-enforced defense-in-depth response headers
 * (Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
 * X-Content-Type-Options, Referrer-Policy, Cross-Origin-Opener-Policy,
 * Cross-Origin-Resource-Policy, Origin-Agent-Cluster,
 * X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control,
 * X-Download-Options). See:
 *   - .github/copilot-instructions.md - Standing Backlog row "Web security
 *     headers (CSP/HSTS/etc.)" moved from DEFERRED to ACTIVE.
 *   - docs/strategy/SECURITY_INTAKE_2026-05-17.md - finding 5.4.
 *
 * The contract enforced here:
 *   - SPA shell GET (/) MUST carry every header.
 *   - SCIM API JSON response (/scim/health, /scim/admin/version) MUST
 *     carry every header. (Browser fetch() responses also inherit them.)
 *   - HSTS is ONLY set when NODE_ENV === 'production' so the test
 *     environment + dev/Docker-compose don't pin localhost to HTTPS.
 *   - frame-ancestors 'none' AND X-Frame-Options DENY both ship - the
 *     CSP directive is the modern path, the legacy header is for older
 *     browsers; both must be present for full coverage.
 *   - CSP intentionally permits 'unsafe-inline' for script-src and
 *     style-src in this first commit because (a) index.html embeds a
 *     small inline fallback-remove script and (b) Fluent UI v9 makeStyles
 *     emits atomic style classes via runtime injection. A follow-up
 *     commit (N3b or later) MAY tighten via sha256 hashes; until then,
 *     'unsafe-inline' is the documented decision and this test enforces
 *     it (so a future operator can't silently drop the CSP without
 *     updating the test + the docs in lock-step).
 *
 * @see api/src/main.ts - the `app.use(helmet(...))` call this spec covers.
 * @see api/test/e2e/helpers/app.helper.ts - test bootstrap that mirrors
 *      main.ts. The helmet config MUST be added there too so the test
 *      sees what production sees.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';

/**
 * Every public-facing response, regardless of route, MUST carry these.
 * Listed as `headerName -> matcher` for human-readability.
 *
 * Note: header names from supertest are lower-cased.
 */
const REQUIRED_HEADERS: Record<string, RegExp> = {
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^DENY$/i,
  'x-dns-prefetch-control': /^off$/,
  'x-download-options': /^noopen$/,
  'x-permitted-cross-domain-policies': /^none$/,
  'origin-agent-cluster': /^\?1$/,
  'referrer-policy': /^strict-origin-when-cross-origin$/,
  'cross-origin-opener-policy': /^same-origin$/,
  'cross-origin-resource-policy': /^same-origin$/,
  // CSP - structured assertions in their own block below.
  'content-security-policy': /default-src 'self'/,
};

/**
 * Specific CSP directives MUST be present with these values.
 */
const REQUIRED_CSP_DIRECTIVES: string[] = [
  "default-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // 'unsafe-inline' is intentionally allowed in N3a; see header-spec docstring.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
];

/**
 * Routes that exercise the full middleware stack from different angles.
 * Each MUST carry every required header.
 */
const PROBE_ROUTES: Array<{ path: string; expectStatus: number[] }> = [
  { path: '/', expectStatus: [200] },              // SPA shell via Express middleware
  { path: '/scim/health', expectStatus: [200] },   // public NestJS controller
  { path: '/scim/admin/version', expectStatus: [200, 401] },
  { path: '/endpoints', expectStatus: [200] },     // SPA fallback (deep link)
];

describe('Security headers (E2E) - Phase N3a helmet rollout', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(PROBE_ROUTES)('GET $path', ({ path: probePath, expectStatus }) => {
    it(`returns one of [${expectStatus.join(', ')}] and carries every required security header`, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const res = await request(app.getHttpServer() as any).get(probePath);
      expect(expectStatus).toContain(res.status);

      for (const [headerName, pattern] of Object.entries(REQUIRED_HEADERS)) {
        const actual = res.headers[headerName];
        expect(actual).toBeDefined();
        expect(typeof actual).toBe('string');
        expect(actual).toMatch(pattern);
      }
    });

    it('CSP directive set covers default-src, script-src, style-src, img-src, frame-ancestors, object-src, connect-src', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const res = await request(app.getHttpServer() as any).get(probePath);
      const csp = res.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(typeof csp).toBe('string');
      for (const directive of REQUIRED_CSP_DIRECTIVES) {
        expect(csp).toContain(directive);
      }
    });
  });

  it('does NOT set Strict-Transport-Security in non-production NODE_ENV (test should not pin localhost to HTTPS)', async () => {
    // The test helper sets NODE_ENV='test'. HSTS in this mode would be
    // useless (no TLS on supertest's loopback) AND a foot-gun for any
    // operator running Docker on their workstation - browsers
    // hard-pin localhost for the HSTS max-age once they see it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/scim/health');
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('Cross-Origin-Embedder-Policy is NOT enforced (would break SPA fetch() to /scim/* under some CDN setups)', async () => {
    // helmet's default COEP is 'require-corp' which causes any
    // image/font/style from a third party without CORP headers to be
    // blocked. We don't fetch third-party assets today but if someone
    // adds a CDN link to README screenshots, COEP would break it.
    // Documented as intentionally OFF in the helmet config.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/');
    expect(res.headers['cross-origin-embedder-policy']).toBeUndefined();
  });

  it('Permissions-Policy header is set with the locked-down minimum (camera, microphone, geolocation, payment all disabled)', async () => {
    // Permissions-Policy is NOT set by helmet's default. We add it
    // explicitly because the SPA never needs camera/mic/geo/payment
    // and a future XSS that did would be blocked at the browser layer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/');
    const pp = res.headers['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('camera=()');
    expect(pp).toContain('microphone=()');
    expect(pp).toContain('geolocation=()');
    expect(pp).toContain('payment=()');
  });
});
