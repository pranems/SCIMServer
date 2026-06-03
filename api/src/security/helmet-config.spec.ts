/**
 * Unit tests for the helmet-config module.
 *
 * The full HTTP-level contract is enforced by
 * api/test/e2e/security-headers.e2e-spec.ts; these unit tests pin the
 * factory's internal shape so a future refactor cannot silently drop
 * a header by reordering options.
 */
import { buildHelmetMiddleware, PERMISSIONS_POLICY_HEADER_VALUE } from './helmet-config';

describe('buildHelmetMiddleware', () => {
  it('returns a function (Express middleware) regardless of NODE_ENV', () => {
    expect(typeof buildHelmetMiddleware('production')).toBe('function');
    expect(typeof buildHelmetMiddleware('development')).toBe('function');
    expect(typeof buildHelmetMiddleware('test')).toBe('function');
    expect(typeof buildHelmetMiddleware(undefined)).toBe('function');
  });

  it('middleware emits CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy in non-production', () => {
    const mw = buildHelmetMiddleware('test');
    const headers: Record<string, string> = {};
    const req = { method: 'GET' } as never;
    const res = {
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers[name.toLowerCase()] = String(value);
      },
      getHeader: () => undefined,
      removeHeader: () => undefined,
    } as never;
    mw(req, res, () => {
      /* helmet completes synchronously */
    });

    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
    expect(headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect(headers['content-security-policy']).toContain("img-src 'self' data:");
    expect(headers['content-security-policy']).toContain("connect-src 'self'");

    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(headers['origin-agent-cluster']).toBe('?1');
    expect(headers['x-dns-prefetch-control']).toBe('off');
    expect(headers['x-download-options']).toBe('noopen');
    expect(headers['x-permitted-cross-domain-policies']).toBe('none');
  });

  it('does NOT emit Strict-Transport-Security when NODE_ENV is not "production"', () => {
    const mw = buildHelmetMiddleware('test');
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers[name.toLowerCase()] = String(value);
      },
      getHeader: () => undefined,
      removeHeader: () => undefined,
    } as never;
    mw({ method: 'GET' } as never, res, () => {
      /* sync */
    });

    expect(headers['strict-transport-security']).toBeUndefined();
  });

  it('emits Strict-Transport-Security with includeSubDomains when NODE_ENV === "production"', () => {
    const mw = buildHelmetMiddleware('production');
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers[name.toLowerCase()] = String(value);
      },
      getHeader: () => undefined,
      removeHeader: () => undefined,
    } as never;
    mw({ method: 'GET' } as never, res, () => {
      /* sync */
    });

    expect(headers['strict-transport-security']).toBeDefined();
    expect(headers['strict-transport-security']).toContain('max-age=15552000');
    expect(headers['strict-transport-security']).toContain('includeSubDomains');
    // preload intentionally omitted; requires hstspreload.org submission
    expect(headers['strict-transport-security']).not.toContain('preload');
  });

  it('does NOT emit Cross-Origin-Embedder-Policy (intentionally disabled)', () => {
    const mw = buildHelmetMiddleware('production');
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers[name.toLowerCase()] = String(value);
      },
      getHeader: () => undefined,
      removeHeader: () => undefined,
    } as never;
    mw({ method: 'GET' } as never, res, () => {
      /* sync */
    });

    expect(headers['cross-origin-embedder-policy']).toBeUndefined();
  });
});

describe('PERMISSIONS_POLICY_HEADER_VALUE', () => {
  it('denies camera, microphone, geolocation, payment, usb, magnetometer, accelerometer, gyroscope', () => {
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('camera=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('microphone=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('geolocation=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('payment=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('usb=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('magnetometer=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('accelerometer=()');
    expect(PERMISSIONS_POLICY_HEADER_VALUE).toContain('gyroscope=()');
  });

  it('is a comma-delimited single-line value (Permissions-Policy spec format)', () => {
    expect(PERMISSIONS_POLICY_HEADER_VALUE).not.toContain('\n');
    expect(PERMISSIONS_POLICY_HEADER_VALUE.split(',').length).toBeGreaterThanOrEqual(8);
  });
});
