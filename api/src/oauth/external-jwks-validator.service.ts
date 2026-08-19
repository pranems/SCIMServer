import { Injectable, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
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

/**
 * W1.4 - the JWKS host is not (or is no longer) permitted by the allowlist.
 *
 * Distinct from a network failure ON PURPOSE. Fail-to-stale exists so that a
 * real IdP outage does not become an auth outage, and that reasoning does not
 * transfer to a host the operator has deliberately REVOKED: serving cached keys
 * there would turn a security action into a no-op for the whole cache lifetime.
 * Raising the TTL from 10 minutes to 24 hours widened that window by 144x,
 * which is why this class arrived in the same change (RCA 10.2).
 */
export class JwksHostNotPermittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JwksHostNotPermittedError';
  }
}

/**
 * Cached JWKS entry.
 *
 * `kids` is a kid-addressable index over `keys`, so an unknown-kid check is a
 * set lookup rather than a scan of the key array on every verify. `expiresAt`
 * carries the effective freshness deadline after the IdP's `Cache-Control` has
 * been folded in (W1.4); it is always <= fetchedAt + policy.cacheMaxAgeMs.
 */
interface JwksCacheEntry {
  keys: unknown;
  fetchedAt: number;
  kids: Set<string>;
  expiresAt: number;
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
export class ExternalJwksValidatorService implements OnModuleInit, OnModuleDestroy {
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
  /**
   * W1.4 - when each jwksUri last performed a SYNCHRONOUS refetch because a
   * token carried an unknown `kid`. Rate-limits that path so a caller cannot
   * drive our outbound request rate by presenting unrecognised kids.
   */
  private readonly lastUnknownKidFetchAt = new Map<string, number>();
  /** W1.4 - handle for the background refresh sweep; cleared on destroy. */
  private refreshTimer?: ReturnType<typeof setInterval>;

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
    this.startRefreshTimer();
  }

  /**
   * W1.4 - stop the background sweep. Without this a leaked interval keeps the
   * Jest worker alive ("a worker process has failed to exit gracefully") and,
   * in production, keeps a torn-down module fetching.
   */
  onModuleDestroy(): void {
    this.stopRefreshTimer();
  }

  /** W1.4 - true while the background refresh sweep is scheduled. */
  hasRefreshTimer(): boolean {
    return this.refreshTimer !== undefined;
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer) return;
    // Sweep more often than the refresh interval so an entry is refreshed
    // promptly after it crosses the threshold rather than up to a full
    // interval later. The sweep itself is cheap - it only fetches entries that
    // are actually due.
    const sweepMs = Math.max(60_000, Math.floor(this.serverEgress.refreshIntervalMs / 4));
    this.refreshTimer = setInterval(() => {
      void this.refreshCachedJwksNow();
    }, sweepMs);
    // Never hold the event loop open for this. A refresh sweep is not work
    // worth delaying a shutdown (or a test run) for.
    this.refreshTimer.unref?.();
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * W1.4 - refresh every cached entry that has aged past `refreshIntervalMs`,
   * OFF the hot path. This is what makes the steady state always a cache hit:
   * before W1.4 each TTL expiry put a synchronous outbound fetch on a user's
   * token mint.
   *
   * Deliberately never rejects. A background sweep that threw would surface as
   * an unhandled rejection; a failed refresh simply leaves the existing (still
   * valid) entry in place to be retried on the next sweep.
   */
  async refreshCachedJwksNow(): Promise<void> {
    const now = Date.now();
    const due: string[] = [];
    for (const [uri, entry] of this.cache.entries()) {
      if (now - entry.fetchedAt >= this.serverEgress.refreshIntervalMs) due.push(uri);
    }
    if (due.length === 0) return;

    await Promise.all(
      due.map(async (uri) => {
        try {
          // Goes through fetchJwks so single-flight coalescing still applies and
          // the cache swap stays atomic (cacheKeys replaces the entry wholesale).
          await this.fetchJwks(uri, this.serverEgress);
          this.logger.debug(LogCategory.AUTH, 'JWKS background refresh succeeded', { jwksUri: uri });
        } catch (err) {
          this.logger.warn(LogCategory.AUTH, 'JWKS background refresh failed (cached keys retained)', {
            jwksUri: uri,
            reason: (err as Error)?.message,
          });
        }
      }),
    );
  }

  /**
   * W1.2 - populate the cache for one `jwksUri` ahead of any request, so the
   * first mint after a deploy is a cache hit rather than a cold outbound fetch.
   *
   * Goes through `fetchJwks`, so it shares single-flight coalescing and the
   * atomic cache swap with every other path - a prewarm racing a real mint
   * cannot produce two fetches or a half-updated entry.
   *
   * Never rejects, for the same reason the background sweep does not: this runs
   * at boot, and an IdP that is unreachable at that moment must not prevent the
   * process from starting. The URI is simply left cold and fetched on first use.
   */
  async prewarm(jwksUri: string): Promise<boolean> {
    try {
      await this.fetchJwks(jwksUri, this.serverEgress);
      this.logger.debug(LogCategory.AUTH, 'JWKS prewarm succeeded', { jwksUri });
      return true;
    } catch (err) {
      this.logger.warn(LogCategory.AUTH, 'JWKS prewarm failed (will fetch on first use)', {
        jwksUri,
        reason: (err as Error)?.message,
      });
      return false;
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

    // W1.4 - the cached set is fresh when it is inside BOTH the configured TTL
    // and whatever shorter lifetime the IdP asked for via Cache-Control.
    let keys = this.getFreshCached(jwksUri);
    let triedRefetch = false;

    if (!keys) {
      // Nothing usable cached - a fetch is unavoidable.
      keys = await this.fetchJwks(jwksUri, policy);
      triedRefetch = true;
    } else if (kid && !this.cacheHasKid(jwksUri, keys, kid)) {
      // W1.4 - the cached set is fresh but does not contain this kid. That is
      // the key-rotation signal, so a refetch is warranted; it is also fully
      // caller-controlled, so it is rate-limited. Inside the window we fall
      // through with the cached keys and let verification fail normally rather
      // than issuing an outbound request per inbound request.
      if (this.mayRefetchForUnknownKid(jwksUri, policy)) {
        keys = await this.fetchJwks(jwksUri, policy);
        triedRefetch = true;
      } else {
        this.logger.debug(LogCategory.AUTH, 'unknown kid refetch suppressed by rate limit', {
          jwksUri,
          kid,
          unknownKidMinIntervalMs: policy.unknownKidMinIntervalMs,
        });
        triedRefetch = true; // do not let the catch below bypass the limit
      }
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
      throw new JwksHostNotPermittedError(
        `JWKS host "${host}" is not permitted by the JWKS_HOST_ALLOWLIST.`,
      );
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
        const fetched = await this.fetchJwksOnce(jwksUri, policy, attemptTimeoutMs);
        this.cacheKeys(jwksUri, fetched.keys, policy, fetched.cacheControlMaxAgeMs);
        return fetched.keys;
      } catch (err) {
        lastErr = err;
        // W1.5 - a cap breach is deterministic; retrying only burns the budget
        // and then reports the generic exhaustion message instead of the cause.
        if (err instanceof JwksPolicyViolationError) throw err;
        // W1.4 - a revoked host is deterministic too, AND must not fall through
        // to fail-to-stale below. Propagate it immediately.
        if (err instanceof JwksHostNotPermittedError) throw err;
        if (Date.now() >= deadlineAt) {
          deadlineExceeded = true;
          break;
        }
      }
    }
    // All attempts failed (or the budget ran out). Fail-to-stale if a cached
    // copy exists AND is inside the hard stale ceiling; else fail closed.
    //
    // W1.4 - the ceiling is the whole point. Before it, this path returned the
    // cached keys with NO age test, so a revoked or rotated-out key stayed
    // acceptable for as long as the IdP was unreachable - unbounded, and made
    // 144x worse by the 10-min -> 24h TTL raise that ships alongside this.
    const cached = this.cache.get(jwksUri);
    if (cached) {
      const age = Date.now() - cached.fetchedAt;
      if (age <= policy.staleIfErrorMs) {
        this.logger.warn(LogCategory.AUTH, 'JWKS fetch failed; using cached keys', {
          jwksUri,
          reason: (lastErr as Error)?.message,
          deadlineExceeded,
          ageMs: age,
          staleIfErrorMs: policy.staleIfErrorMs,
        });
        return cached.keys;
      }
      this.logger.error(
        LogCategory.AUTH,
        'JWKS fetch failed and the cached keys are past the stale ceiling (fail closed)',
        lastErr,
        { jwksUri, ageMs: age, staleIfErrorMs: policy.staleIfErrorMs },
      );
      throw new Error(
        `JWKS unavailable: cached keys are stale (${age} ms old, ceiling ${policy.staleIfErrorMs} ms); failing closed.`,
      );
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
  private cacheKeys(
    jwksUri: string,
    keys: unknown,
    policy: EgressPolicy,
    cacheControlMaxAgeMs?: number,
  ): void {
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
    // W1.4 - the IdP may ask us to cache for LESS than our configured TTL, but
    // never for more: an IdP must not be able to pin keys in our cache beyond
    // the lifetime we chose to trust them for.
    const now = Date.now();
    const effectiveMaxAgeMs =
      typeof cacheControlMaxAgeMs === 'number' && Number.isFinite(cacheControlMaxAgeMs)
        ? Math.min(policy.cacheMaxAgeMs, Math.max(0, cacheControlMaxAgeMs))
        : policy.cacheMaxAgeMs;

    // Atomic swap: the entry is replaced wholesale, so a concurrent reader sees
    // either the whole old set or the whole new one, never a half-updated one.
    this.cache.set(jwksUri, {
      keys,
      fetchedAt: now,
      kids: this.indexKids(keys),
      expiresAt: now + effectiveMaxAgeMs,
    });
  }

  /** W1.4 - kid-addressable index over a key set, built once per fetch. */
  private indexKids(keys: unknown): Set<string> {
    const arr = (keys as { keys?: Array<{ kid?: unknown }> })?.keys;
    const out = new Set<string>();
    if (Array.isArray(arr)) {
      for (const k of arr) {
        if (typeof k?.kid === 'string') out.add(k.kid);
      }
    }
    return out;
  }

  /**
   * W1.4 - RFC 9111 `Cache-Control: max-age=<seconds>`, in ms. `no-store` /
   * `no-cache` collapse to 0 so the entry is immediately re-validated.
   */
  private parseCacheControlMaxAgeMs(header: string | null | undefined): number | undefined {
    if (!header) return undefined;
    const value = header.toLowerCase();
    if (/\bno-store\b/.test(value) || /\bno-cache\b/.test(value)) return 0;
    const m = /\bmax-age\s*=\s*(\d+)/.exec(value);
    if (!m) return undefined;
    const seconds = Number(m[1]);
    return Number.isFinite(seconds) ? seconds * 1000 : undefined;
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
  private async fetchJwksOnce(
    jwksUri: string,
    policy: EgressPolicy,
    attemptTimeoutMs?: number,
  ): Promise<{ keys: unknown; cacheControlMaxAgeMs?: number }> {
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
      const keys = await this.readKeySet(res, policy, jwksUri);
      // W1.4 - honor a SHORTER cache lifetime if the IdP asked for one.
      const cacheControl =
        typeof res.headers?.get === 'function' ? res.headers.get('cache-control') : null;
      return { keys, cacheControlMaxAgeMs: this.parseCacheControlMaxAgeMs(cacheControl) };
    }
    throw new Error('JWKS fetch exceeded the redirect limit.');
  }

  /**
   * W1.4 - a cached entry is fresh until `expiresAt`, which already folds the
   * configured TTL together with any shorter `Cache-Control` the IdP asked for.
   */
  private getFreshCached(jwksUri: string): unknown {
    const cached = this.cache.get(jwksUri);
    if (!cached) return undefined;
    if (Date.now() > cached.expiresAt) return undefined;
    return cached.keys;
  }

  /**
   * W1.4 - may this URI issue a synchronous refetch for an unknown kid right
   * now? Records the decision so the window starts at the allowed fetch.
   */
  private mayRefetchForUnknownKid(jwksUri: string, policy: EgressPolicy): boolean {
    const now = Date.now();
    const last = this.lastUnknownKidFetchAt.get(jwksUri);
    if (last !== undefined && now - last < policy.unknownKidMinIntervalMs) return false;
    this.lastUnknownKidFetchAt.set(jwksUri, now);
    return true;
  }

  private cacheHasKid(jwksUri: string, keys: unknown, kid: string): boolean {
    const entry = this.cache.get(jwksUri);
    // Prefer the prebuilt index; fall back to a scan when the key set did not
    // come from the cache (e.g. straight off a fetch).
    if (entry && entry.keys === keys) return entry.kids.has(kid);
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
