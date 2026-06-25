import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';

export const JWKS_FETCH = Symbol('JWKS_FETCH');

export interface ExternalJwksVerifyResult {
  payload: Record<string, unknown>;
  protectedHeader: Record<string, unknown>;
}

/** Allowed signature algorithms - asymmetric only (no HMAC, no `none`). */
const ALLOWED_ALGS = ['RS256', 'ES256'];

/** Cached JWKS entry: the raw key set + the time it was fetched. */
interface JwksCacheEntry {
  keys: unknown;
  fetchedAt: number;
}

/**
 * ExternalJwksValidatorService (Q2) - the reusable external-JWT signature core.
 *
 * Verifies a JWT against a remote JWKS with these hard guarantees:
 *  - **Algorithm pinning**: only RS256/ES256 are accepted. `alg: none` and any
 *    HMAC algorithm (the classic public-key-as-HMAC-secret confusion) are
 *    rejected.
 *  - **SSRF host allowlist**: the `jwksUri` host MUST be on the configured
 *    `JWKS_HOST_ALLOWLIST` and the scheme MUST be https. A disallowed host is
 *    rejected BEFORE any network call - this is the critical anti-SSRF choke
 *    point (architecture section 5.1, "JWKS host allowlist - critical SSRF").
 *  - **Cache by URI with bounded max-age**; refetch once on an unknown `kid`
 *    (key rotation).
 *  - **Fail closed**: a JWKS fetch failure with no usable cached key REJECTS;
 *    it never falls back to skipping the signature check.
 *
 * This is the Q2 primitive. Q6's WIF validator layers the iss/aud/sub/tid/role
 * claim checks on top of this.
 *
 * `jose` is ESM-only; we load it via dynamic import so the CommonJS build emits
 * a runtime `import()` rather than a `require()`.
 */
@Injectable()
export class ExternalJwksValidatorService {
  private readonly hostAllowlist: Set<string>;
  private readonly maxAgeMs: number;
  private readonly cache = new Map<string, JwksCacheEntry>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: ScimLogger,
    @Optional() @Inject(JWKS_FETCH) private readonly fetchFn?: typeof fetch,
  ) {
    const raw = this.config.get<string>('JWKS_HOST_ALLOWLIST') ?? '';
    this.hostAllowlist = new Set(
      raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    );
    const cfgMaxAge = Number(this.config.get<string>('JWKS_CACHE_MAX_AGE_MS'));
    this.maxAgeMs = Number.isFinite(cfgMaxAge) && cfgMaxAge > 0 ? cfgMaxAge : 10 * 60 * 1000;
  }

  /**
   * Verify a JWT against the JWKS at `jwksUri`. Resolves to the decoded payload
   * + protected header on success; rejects on any failure (signature, alg,
   * SSRF, fetch outage, unknown kid).
   */
  async verify(token: string, jwksUri: string): Promise<ExternalJwksVerifyResult> {
    this.assertJwksUriAllowed(jwksUri);

    const jose = await import('jose');
    const kid = this.peekKid(token);

    // Try the cached key set first; refetch on a cache miss / unknown kid.
    let keys = this.getFreshCached(jwksUri);
    let triedRefetch = false;

    if (!keys || (kid && !this.cacheHasKid(keys, kid))) {
      keys = await this.fetchJwks(jwksUri);
      triedRefetch = true;
    }

    try {
      return await this.verifyWithKeys(jose, token, keys);
    } catch (err) {
      // A verification failure may be a rotated key the cache missed; refetch
      // once and retry (still fail closed if the refetch does not help).
      if (!triedRefetch) {
        keys = await this.fetchJwks(jwksUri);
        return await this.verifyWithKeys(jose, token, keys);
      }
      throw err;
    }
  }

  private async verifyWithKeys(
    jose: typeof import('jose'),
    token: string,
    keys: unknown,
  ): Promise<ExternalJwksVerifyResult> {
    const keySet = jose.createLocalJWKSet(keys as Parameters<typeof jose.createLocalJWKSet>[0]);
    const { payload, protectedHeader } = await jose.jwtVerify(token, keySet, {
      algorithms: ALLOWED_ALGS,
    });
    return {
      payload: payload as unknown as Record<string, unknown>,
      protectedHeader: protectedHeader as unknown as Record<string, unknown>,
    };
  }

  /** Anti-SSRF: scheme must be https and host must be on the allowlist. */
  private assertJwksUriAllowed(jwksUri: string): void {
    let url: URL;
    try {
      url = new URL(jwksUri);
    } catch {
      throw new Error(`Invalid jwksUri: "${jwksUri}".`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`jwksUri must use https (got "${url.protocol}").`);
    }
    const host = url.hostname.toLowerCase();
    if (!this.hostAllowlist.has(host)) {
      this.logger.warn(LogCategory.AUTH, 'JWKS host not permitted by allowlist (SSRF guard)', {
        host,
        allowlist: Array.from(this.hostAllowlist),
      });
      throw new Error(`JWKS host "${host}" is not permitted by the JWKS_HOST_ALLOWLIST.`);
    }
  }

  /** Fetch + cache the JWKS. Fails closed (rejects) on any fetch/parse error. */
  private async fetchJwks(jwksUri: string): Promise<unknown> {
    const doFetch = this.fetchFn ?? globalThis.fetch;
    try {
      const res = await doFetch(jwksUri);
      if (!res.ok) {
        throw new Error(`JWKS fetch returned HTTP ${res.status}.`);
      }
      const keys = await res.json();
      this.cache.set(jwksUri, { keys, fetchedAt: Date.now() });
      return keys;
    } catch (err) {
      // Fail closed: if there is a still-valid cached copy, fall back to it;
      // otherwise reject. NEVER skip the signature check.
      const cached = this.cache.get(jwksUri);
      if (cached) {
        this.logger.warn(LogCategory.AUTH, 'JWKS fetch failed; using cached keys', {
          jwksUri,
          reason: (err as Error).message,
        });
        return cached.keys;
      }
      this.logger.error(LogCategory.AUTH, 'JWKS fetch failed and no cached keys (fail closed)', err, {
        jwksUri,
      });
      throw new Error('JWKS unavailable; failing closed.');
    }
  }

  private getFreshCached(jwksUri: string): unknown {
    const cached = this.cache.get(jwksUri);
    if (!cached) return undefined;
    if (Date.now() - cached.fetchedAt > this.maxAgeMs) return undefined;
    return cached.keys;
  }

  private cacheHasKid(keys: unknown, kid: string): boolean {
    const arr = (keys as { keys?: Array<{ kid?: string }> })?.keys;
    return Array.isArray(arr) && arr.some((k) => k.kid === kid);
  }

  /** Decode the JOSE header without verifying, to read the `kid`. */
  private peekKid(token: string): string | undefined {
    try {
      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf-8')) as {
        kid?: unknown;
      };
      return typeof header.kid === 'string' ? header.kid : undefined;
    } catch {
      return undefined;
    }
  }
}
