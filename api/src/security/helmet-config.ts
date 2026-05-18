/**
 * helmet middleware configuration for the SCIM API.
 *
 * Centralised in this module (rather than inlined in main.ts) so that:
 *   1. The exact same helmet options are reused by the E2E test bootstrap
 *      (api/test/e2e/helpers/app.helper.ts). If main.ts and the test helper
 *      drift, the test would silently pass without protecting production.
 *   2. The CSP / Permissions-Policy / HSTS choices can be unit-tested in
 *      isolation (api/src/security/helmet-config.spec.ts).
 *
 * Phase N3a rationale (2026-05-18 commit):
 *   The 2026-05-17 Stage X.2 first-run report identified missing browser
 *   security headers as the HIGHEST-LEVERAGE NEW GAP - the API shipped to
 *   dev/prod without any of CSP / HSTS / X-Frame-Options /
 *   X-Content-Type-Options / Referrer-Policy / COOP / CORP /
 *   Origin-Agent-Cluster / X-Permitted-Cross-Domain-Policies. helmet is
 *   the standard NestJS/Express remedy.
 *
 *   See docs/strategy/SECURITY_INTAKE_2026-05-17.md finding 5.4.
 *
 * CSP design choices for this first rollout:
 *   - 'unsafe-inline' is permitted for script-src AND style-src because
 *     (a) web/index.html embeds a small inline fallback-remove script and
 *     (b) Fluent UI v9 makeStyles emits atomic style classes via runtime
 *     injection (mergeClasses). Tightening to sha256 hashes requires a
 *     coordinated index.html refactor + Fluent UI nonce wiring; deferred
 *     to a follow-up commit.
 *   - frame-ancestors 'none' is the modern clickjacking defense; the
 *     legacy X-Frame-Options: DENY header is ALSO set via the frameguard
 *     option below for older browsers.
 *   - connect-src 'self' assumes the SPA only talks to its own origin.
 *     If a future change introduces a CDN or third-party telemetry sink,
 *     this directive must be widened in lock-step.
 *
 * HSTS design choice:
 *   - HSTS is ONLY emitted when NODE_ENV === 'production'. Test and
 *     development environments serve over HTTP loopback; emitting HSTS
 *     would hard-pin localhost to HTTPS in every operator's browser for
 *     the max-age duration (6 months by default), which is a guaranteed
 *     foot-gun. Production fronts the container behind Azure's HTTPS
 *     ingress so the header makes sense there.
 *
 * COEP design choice:
 *   - helmet's default Cross-Origin-Embedder-Policy ('require-corp') is
 *     intentionally DISABLED. It would block any cross-origin asset
 *     that doesn't carry CORP headers - any future CDN-hosted screenshot,
 *     icon, or font (e.g. README references). The trade-off is that the
 *     app gives up SharedArrayBuffer + ms-precision timers, neither of
 *     which the SCIM UI uses.
 *
 * Permissions-Policy:
 *   - helmet does NOT set Permissions-Policy by default. We add it
 *     explicitly with a maximally restrictive value: camera, microphone,
 *     geolocation, payment all denied. A future XSS that tried to call
 *     these APIs would be blocked at the browser layer even if it
 *     bypassed CSP.
 */
import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * Build the helmet RequestHandler that should be wired into both
 * main.ts (production bootstrap) and app.helper.ts (E2E test bootstrap).
 *
 * @param nodeEnv - The NODE_ENV string. When equal to 'production' the
 *                  Strict-Transport-Security header is emitted; otherwise
 *                  it is suppressed.
 * @returns A configured helmet middleware ready to pass to `app.use()`.
 */
export function buildHelmetMiddleware(nodeEnv: string | undefined): RequestHandler {
  const isProduction = nodeEnv === 'production';

  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // See module docstring for 'unsafe-inline' rationale.
        'script-src': ["'self'", "'unsafe-inline'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
      },
    },
    // HSTS: production only - see module docstring.
    strictTransportSecurity: isProduction
      ? {
          maxAge: 15_552_000, // 180 days, the minimum Chrome will preload-list at
          includeSubDomains: true,
          preload: false, // preload requires an active hstspreload.org submission
        }
      : false,
    // Legacy clickjacking defense; redundant with CSP frame-ancestors 'none'
    // but kept for browsers that predate CSP 2 directive support.
    frameguard: { action: 'deny' },
    // See module docstring for COEP rationale.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // helmet already sets the rest by default:
    //   X-Content-Type-Options: nosniff
    //   X-DNS-Prefetch-Control: off
    //   X-Download-Options: noopen
    //   X-Permitted-Cross-Domain-Policies: none
    //   Origin-Agent-Cluster: ?1
  });
}

/**
 * Permissions-Policy value emitted alongside helmet by an Express
 * middleware in main.ts + app.helper.ts. helmet does NOT set this header
 * out of the box, so it is computed once here and exported for reuse.
 *
 * Format per the Permissions Policy spec
 * (https://www.w3.org/TR/permissions-policy/): `<feature>=(<allowlist>)`.
 * An empty allowlist `()` denies the feature in all contexts.
 */
export const PERMISSIONS_POLICY_HEADER_VALUE =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()';
