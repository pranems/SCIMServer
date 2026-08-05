import { Injectable, Inject, Optional, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { JwksHostAllowlistService } from './jwks-host-allowlist.service';
import {
  resolveServerEgressDefaults,
  mergeEgressPolicy,
  type EgressPolicy,
  type EgressPolicyOverrides,
} from './egress-policy';

export const JWKS_FETCH = Symbol('JWKS_FETCH');

/** Hard cap on redirect hops the JWKS fetch will follow (each re-validated). */
const MAX_JWKS_REDIRECTS = 3;

export interface ExternalJwksVerifyResult {
  payload: Record<string, unknown>;
  protectedHeader: Record<string, unknown>;
}

/** Allowed signature algorithms - asymmetric only (no HMAC, no `none`). */
const ALLOWED_ALGS = ['RS256', 'ES256'];

/**
 * W1.5 - a response that breached a configured cap (byte size, key count).
 *
 * Deterministic: the same IdP returning the same oversized body will breach the
 * cap on every attempt, so retrying wastes the total deadline and then reports
 * the generic exhaustion message, hiding the real cause. These fail fast and
 * propagate their own message.
 */
export class JwksPolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwksPolicyViolationError';
  }
}

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
export class ExternalJwksValidatorService implements OnModuleInit {
  private readonly hostAllowlist: Set<string>;
  /** SERVER-level egress defaults (env-driven); endpoint overrides layer on top. */
  private readonly serverEgress: EgressPolicy;
  private readonly cache = new Map<string, JwksCacheEntry>();
  /** G3 single-flight: coalesce concurrent fetches for the same jwksUri. */
  private readonly inflight = new Map<string, Promise<unknown>>();
  /**
   * W1.1 - memoized `jose` module. The import is kicked off at boot by
   * `onModuleInit` so the FIRST token mint after a restart does not pay the
   * ESM module load on the hot path (measured as part of the ~2.1s cold mint
   * in the X11 latency analysis).
   */
  private josePromise?: Promise<typeof import('jose')>;
  /**
   * W1.3 - the canonical URL a configured `jwksUri` redirected to, remembered
   * after the first successful fetch. A trust that stores the legacy
   * `login.windows.net` host pays a redirect hop on EVERY cold fetch
   * (measured ~130-160ms); remembering the target removes it from all
   * subsequent fetches. The remembered target is re-validated against the
   * SSRF allowlist on every use, so this is a latency shortcut ONLY - it can
   * never widen what the fetcher is allowed to reach.
   */
  private readonly resolvedUri = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: ScimLogger,
    @Optional() @Inject(JWKS_FETCH) private readonly fetchFn?: typeof fetch,
    @Optional() private readonly allowlistService?: JwksHostAllowlistService,
  ) {
    const raw = this.config.get<string>('JWKS_HOST_ALLOWLIST') ?? '';
    this.hostAllowlist = new Set(
      raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    );
    this.serverEgress = resolveServerEgressDefaults((k) => this.config.get<string>(k));
  }

  /**
   * W1.1 - warm the ESM `jose` import at boot. Deliberately non-fatal: if the
   * pre-load fails the service still works (the next `verify` retries the
   * import), so a transient module-resolution problem can never break startup.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.loadJose();
    } catch (err) {
      this.logger.warn(LogCategory.AUTH, 'jose pre-load failed (non-fatal; will load on first use)', {
        reason: (err as Error)?.message,
      });
    }
  }

  /** True once the `jose` module has been successfully pre-loaded. */
  isJoseLoaded(): boolean {
    return this.josePromise !== undefined;
  }

  /** Memoized `jose` import - one module load per process, not per mint. */
  private loadJose(): Promise<typeof import('jose')> {
    if (!this.josePromise) {
      this.josePromise = import('jose');
    }
    return this.josePromise;
  }

  /**
   * Verify a JWT against the JWKS at `jwksUri`. Resolves to the decoded payload
   * + protected header on success; rejects on any failure (signature, alg,
   * SSRF, fetch outage, unknown kid).
   *
   * `egressOverrides` are the ENDPOINT-level robustness knobs (timeout, retries,
   * backoff, cache max-age); when a field is set it OVERRIDES the server-level
   * default, otherwise the server default applies.
   */
  async verify(
    token: string,
    jwksUri: string,
    egressOverrides?: EgressPolicyOverrides,
  ): Promise<ExternalJwksVerifyResult> {
    this.assertJwksUriAllowed(jwksUri);
    const policy = mergeEgressPolicy(this.serverEgress, egressOverrides);

    const jose = await this.loadJose();
    const kid = this.peekKid(token);

    // Try the cached key set first; refetch on a cache miss / unknown kid.
    let keys = this.getFreshCached(jwksUri, policy.cacheMaxAgeMs);
    let triedRefetch = false;

    if (!keys || (kid && !this.cacheHasKid(keys, kid))) {
      keys = await this.fetchJwks(jwksUri, policy);
      triedRefetch = true;
    }

    try {
      return await this.verifyWithKeys(jose, token, keys);
    } catch (err) {
      // A verification failure may be a rotated key the cache missed; refetch
      // once and retry (still fail closed if the refetch does not help).
      if (!triedRefetch) {
        keys = await this.fetchJwks(jwksUri, policy);
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
    // WI-15: consult the shared effective allowlist (seed + env + persisted
    // admin-editable union) when it is wired; otherwise fall back to the
    // env-only Set this service parsed at construction (unchanged behavior for
    // unit tests that construct the validator standalone).
    const allowed = this.allowlistService
      ? this.allowlistService.isAllowed(host)
      : this.hostAllowlist.has(host);
    if (!allowed) {
      this.logger.warn(LogCategory.AUTH, 'JWKS host not permitted by allowlist (SSRF guard)', {
        host,
      });
      throw new Error(`JWKS host "${host}" is not permitted by the JWKS_HOST_ALLOWLIST.`);
    }
  }

  /**
   * Fetch + cache the JWKS. Hardened runtime egress:
   *  - G3 single-flight: concurrent fetches for the same URI are coalesced.
   *  - G1 timeout + G5 bounded retry with exponential backoff + jitter.
   *  - G2 redirect re-validation: redirects are followed manually and each hop
   *    is re-checked against the SSRF allowlist.
   * Fails closed (rejects) on exhaustion unless a still-usable cached copy
   * exists (fail-to-stale) - it NEVER skips the signature check.
   */
  private async fetchJwks(jwksUri: string, policy: EgressPolicy): Promise<unknown> {
    const existing = this.inflight.get(jwksUri);
    if (existing) return existing;
    const p = this.fetchJwksWithRetry(jwksUri, policy).finally(() => this.inflight.delete(jwksUri));
    this.inflight.set(jwksUri, p);
    return p;
  }

  private async fetchJwksWithRetry(jwksUri: string, policy: EgressPolicy): Promise<unknown> {
    let lastErr: unknown;
    // W1.5 - one budget for the WHOLE operation. `policy.timeoutMs` bounds a
    // single attempt, which is not a bound on the work: retries + exponential
    // backoff can run for tens of seconds on the token-mint hot path.
    const deadlineAt = Date.now() + policy.totalDeadlineMs;
    let deadlineExceeded = false;
    // total tries = retries + 1
    for (let attempt = 0; attempt <= policy.retries; attempt++) {
      if (attempt > 0 && policy.retryBackoffMs > 0) {
        const backoff = policy.retryBackoffMs * Math.pow(2, attempt - 1);
        const jitter = Math.floor(Math.random() * policy.retryBackoffMs);
        // Never sleep past the deadline - an unbounded sleep is the single
        // biggest contributor to the worst-case cold path.
        const sleepFor = Math.min(backoff + jitter, Math.max(0, deadlineAt - Date.now()));
        if (sleepFor > 0) await new Promise((r) => setTimeout(r, sleepFor));
      }
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        deadlineExceeded = true;
        break;
      }
      try {
        // The attempt may not outlive the total budget either.
        const attemptTimeoutMs = Math.min(policy.timeoutMs, remaining);
        const keys = await this.fetchJwksOnce(jwksUri, policy, attemptTimeoutMs);
        this.cacheKeys(jwksUri, keys, policy);
        return keys;
      } catch (err) {
        lastErr = err;
        // W1.5 - a cap breach is deterministic; retrying only burns the budget
        // and then reports the generic exhaustion message instead of the cause.
        if (err instanceof JwksPolicyViolationError) throw err;
        if (Date.now() >= deadlineAt) {
          deadlineExceeded = true;
          break;
        }
      }
    }
    // All attempts failed (or the budget ran out). Fail-to-stale if a cached
    // copy exists; else fail closed.
    const cached = this.cache.get(jwksUri);
    if (cached) {
      this.logger.warn(LogCategory.AUTH, 'JWKS fetch failed; using cached keys', {
        jwksUri,
        reason: (lastErr as Error)?.message,
        deadlineExceeded,
      });
      return cached.keys;
    }
    if (deadlineExceeded) {
      this.logger.error(LogCategory.AUTH, 'JWKS fetch exceeded its total deadline (fail closed)', lastErr, {
        jwksUri,
        totalDeadlineMs: policy.totalDeadlineMs,
      });
      throw new Error(
        `JWKS unavailable: exceeded the ${policy.totalDeadlineMs} ms total deadline; failing closed.`,
      );
    }
    this.logger.error(LogCategory.AUTH, 'JWKS fetch failed and no cached keys (fail closed)', lastErr, {
      jwksUri,
    });
    throw new Error('JWKS unavailable; failing closed.');
  }

  /**
   * W1.5 - cache write with a cardinality cap. Without it the cache is an
   * unbounded map keyed by a caller-influenced URI, so a large trust set (or a
   * hostile one) grows process memory without limit. Evicts the oldest entry.
   */
  private cacheKeys(jwksUri: string, keys: unknown, policy: EgressPolicy): void {
    if (!this.cache.has(jwksUri) && this.cache.size >= policy.maxCacheEntries) {
      let oldestUri: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [uri, entry] of this.cache.entries()) {
        if (entry.fetchedAt < oldestAt) {
          oldestAt = entry.fetchedAt;
          oldestUri = uri;
        }
      }
      if (oldestUri !== undefined) {
        this.cache.delete(oldestUri);
        this.logger.debug(LogCategory.AUTH, 'JWKS cache at capacity; evicted oldest entry', {
          evicted: oldestUri,
          maxCacheEntries: policy.maxCacheEntries,
        });
      }
    }
    this.cache.set(jwksUri, { keys, fetchedAt: Date.now() });
  }

  /**
   * W1.5 - read the response body under a byte cap, then bound the key count.
   *
   * Falls back to `res.json()` when the response object has no `text()` (some
   * unit-test doubles), so the cap applies wherever the body can be measured
   * without breaking those callers.
   */
  private async readKeySet(
    res: { text?: () => Promise<string>; json: () => Promise<unknown> },
    policy: EgressPolicy,
    jwksUri: string,
  ): Promise<unknown> {
    let parsed: unknown;
    if (typeof res?.text === 'function') {
      const body: string = await res.text();
      const bytes = Buffer.byteLength(body, 'utf-8');
      if (bytes > policy.maxResponseBytes) {
        this.logger.warn(LogCategory.AUTH, 'JWKS response exceeded the byte cap', {
          jwksUri,
          bytes,
          maxResponseBytes: policy.maxResponseBytes,
        });
        throw new JwksPolicyViolationError(
          `JWKS response too large: ${bytes} bytes exceeds the ${policy.maxResponseBytes}-byte cap.`,
        );
      }
      parsed = JSON.parse(body);
    } else {
      parsed = await res.json();
    }

    const keyArray = (parsed as { keys?: unknown[] })?.keys;
    if (Array.isArray(keyArray) && keyArray.length > policy.maxKeys) {
      this.logger.warn(LogCategory.AUTH, 'JWKS key set exceeded the key-count cap', {
        jwksUri,
        keyCount: keyArray.length,
        maxKeys: policy.maxKeys,
      });
      throw new JwksPolicyViolationError(
        `JWKS contains too many keys: ${keyArray.length} exceeds the maxKeys cap of ${policy.maxKeys}.`,
      );
    }
    return parsed;
  }

  /** A single fetch attempt: timeout-bounded, redirects followed + re-validated. */
  private async fetchJwksOnce(jwksUri: string, policy: EgressPolicy, attemptTimeoutMs?: number): Promise<unknown> {
    const timeoutMs = attemptTimeoutMs ?? policy.timeoutMs;
    const doFetch = this.fetchFn ?? globalThis.fetch;
    // W1.3 - start from the canonical target this URI previously resolved to,
    // so a legacy host's redirect hop is paid once per process instead of on
    // every cold fetch. Re-validated below on every hop, including this one.
    const remembered = this.resolvedUri.get(jwksUri);
    let current = remembered ?? jwksUri;
    if (remembered) {
      this.assertJwksUriAllowed(current);
    }
    for (let hop = 0; hop <= MAX_JWKS_REDIRECTS; hop++) {
      const res = await doFetch(current, {
        // G1 - abort a hung IdP rather than blocking the token mint. W1.5 caps
        // this at whatever remains of the TOTAL deadline.
        signal: AbortSignal.timeout(timeoutMs),
        // G2 - do not blindly follow redirects; each hop is re-validated below.
        redirect: 'manual',
      });
      const status = typeof res.status === 'number' ? res.status : undefined;
      if (status !== undefined && status >= 300 && status < 400) {
        if (hop >= MAX_JWKS_REDIRECTS) {
          throw new Error('JWKS fetch exceeded the redirect limit.');
        }
        const location = typeof res.headers?.get === 'function' ? res.headers.get('location') : null;
        if (!location) {
          throw new Error(`JWKS fetch returned HTTP ${status} with no Location header.`);
        }
        const next = new URL(location, current);
        // Re-validate the redirect target against the SSRF allowlist (a trusted
        // host must not be able to redirect the fetch to an internal address).
        this.assertJwksUriAllowed(next.toString());
        current = next.toString();
        continue;
      }
      if (!res.ok) {
        throw new Error(`JWKS fetch returned HTTP ${status ?? 'error'}.`);
      }
      // W1.3 - remember where this URI actually resolved to (only when it moved).
      if (current !== jwksUri) {
        this.resolvedUri.set(jwksUri, current);
      }
      // W1.5 - byte cap + key-count cap before the body is trusted.
      return await this.readKeySet(res, policy, jwksUri);
    }
    throw new Error('JWKS fetch exceeded the redirect limit.');
  }

  private getFreshCached(jwksUri: string, maxAgeMs: number): unknown {
    const cached = this.cache.get(jwksUri);
    if (!cached) return undefined;
    if (Date.now() - cached.fetchedAt > maxAgeMs) return undefined;
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
