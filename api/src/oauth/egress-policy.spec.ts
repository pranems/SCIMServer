import {
  resolveServerEgressDefaults,
  mergeEgressPolicy,
  EGRESS_POLICY_DEFAULTS,
  EGRESS_POLICY_BOUNDS,
  type EgressPolicy,
} from './egress-policy';

const emptyGet = (): string | undefined => undefined;
const getFrom = (values: Record<string, string | undefined>) => (k: string) => values[k];

describe('egress-policy', () => {
  describe('resolveServerEgressDefaults', () => {
    it('uses the hardcoded floor defaults when no env is set', () => {
      expect(resolveServerEgressDefaults(emptyGet)).toEqual(EGRESS_POLICY_DEFAULTS);
    });

    it('reads each env var', () => {
      const p = resolveServerEgressDefaults(
        getFrom({
          JWKS_FETCH_TIMEOUT_MS: '3000',
          JWKS_FETCH_RETRIES: '4',
          JWKS_FETCH_RETRY_BACKOFF_MS: '150',
          JWKS_CACHE_MAX_AGE_MS: '120000',
        }),
      );
      expect(p).toEqual({
        timeoutMs: 3000,
        retries: 4,
        retryBackoffMs: 150,
        cacheMaxAgeMs: 120000,
        // W1.5 caps are unset here, so they keep their floor defaults.
        totalDeadlineMs: EGRESS_POLICY_DEFAULTS.totalDeadlineMs,
        maxResponseBytes: EGRESS_POLICY_DEFAULTS.maxResponseBytes,
        maxKeys: EGRESS_POLICY_DEFAULTS.maxKeys,
        maxCacheEntries: EGRESS_POLICY_DEFAULTS.maxCacheEntries,
      });
    });

    it('clamps out-of-bounds env values to the allowed range', () => {
      const p = resolveServerEgressDefaults(
        getFrom({ JWKS_FETCH_TIMEOUT_MS: '999999', JWKS_FETCH_RETRIES: '999' }),
      );
      expect(p.timeoutMs).toBe(EGRESS_POLICY_BOUNDS.timeoutMs.max);
      expect(p.retries).toBe(EGRESS_POLICY_BOUNDS.retries.max);
    });

    it('falls back to the default for a non-numeric env value', () => {
      const p = resolveServerEgressDefaults(getFrom({ JWKS_FETCH_TIMEOUT_MS: 'abc' }));
      expect(p.timeoutMs).toBe(EGRESS_POLICY_DEFAULTS.timeoutMs);
    });

    it('truncates a fractional retry count', () => {
      const p = resolveServerEgressDefaults(getFrom({ JWKS_FETCH_RETRIES: '3.9' }));
      expect(p.retries).toBe(3);
    });
  });

  describe('mergeEgressPolicy (endpoint overrides server)', () => {
    const server: EgressPolicy = {
      timeoutMs: 5000,
      retries: 2,
      retryBackoffMs: 200,
      cacheMaxAgeMs: 600000,
      totalDeadlineMs: 10_000,
      maxResponseBytes: 1_048_576,
      maxKeys: 100,
      maxCacheEntries: 50,
    };

    it('returns the server policy when there are no overrides', () => {
      expect(mergeEgressPolicy(server)).toEqual(server);
      expect(mergeEgressPolicy(server, {})).toEqual(server);
    });

    it('endpoint value OVERRIDES the server value per field', () => {
      const merged = mergeEgressPolicy(server, { timeoutMs: 1500, retries: 5 });
      expect(merged.timeoutMs).toBe(1500); // endpoint wins
      expect(merged.retries).toBe(5); // endpoint wins
      expect(merged.retryBackoffMs).toBe(200); // unset -> server
      expect(merged.cacheMaxAgeMs).toBe(600000); // unset -> server
    });

    it('an override of 0 is honored (e.g. retries=0 disables retry)', () => {
      expect(mergeEgressPolicy(server, { retries: 0 }).retries).toBe(0);
    });

    it('clamps an out-of-bounds override', () => {
      expect(mergeEgressPolicy(server, { timeoutMs: 10 }).timeoutMs).toBe(EGRESS_POLICY_BOUNDS.timeoutMs.min);
      expect(mergeEgressPolicy(server, { retries: 99 }).retries).toBe(EGRESS_POLICY_BOUNDS.retries.max);
    });

    it('ignores a non-finite override field (falls back to server)', () => {
      const merged = mergeEgressPolicy(server, { timeoutMs: Number.NaN, retries: Infinity });
      expect(merged.timeoutMs).toBe(server.timeoutMs);
      expect(merged.retries).toBe(server.retries);
    });
  });

  /**
   * W1.5 - the safety envelope. A per-attempt timeout is NOT a bound on the
   * whole operation: with retries and exponential backoff the worst case is
   * tens of seconds. These caps ship configurable from birth rather than as
   * hardcoded literals to be retrofitted later.
   */
  describe('W1.5 - total deadline + response caps', () => {
    const server: EgressPolicy = {
      timeoutMs: 5000,
      retries: 2,
      retryBackoffMs: 200,
      cacheMaxAgeMs: 600000,
      totalDeadlineMs: 10_000,
      maxResponseBytes: 1_048_576,
      maxKeys: 100,
      maxCacheEntries: 50,
    };

    it('has floor defaults for every new cap', () => {
      expect(EGRESS_POLICY_DEFAULTS.totalDeadlineMs).toBe(10_000);
      expect(EGRESS_POLICY_DEFAULTS.maxResponseBytes).toBe(1_048_576);
      expect(EGRESS_POLICY_DEFAULTS.maxCacheEntries).toBe(50);
    });

    it('defaults maxKeys generously - Microsoft states a key cache holds 10-1000 keys across issuers', () => {
      // A tight cap (e.g. 10) would reject a legitimate multi-issuer key set,
      // so this default is deliberately 100, not 10.
      expect(EGRESS_POLICY_DEFAULTS.maxKeys).toBe(100);
      expect(EGRESS_POLICY_DEFAULTS.maxKeys).toBeGreaterThanOrEqual(100);
    });

    it('reads each new env var', () => {
      const p = resolveServerEgressDefaults(
        getFrom({
          JWKS_TOTAL_DEADLINE_MS: '4000',
          JWKS_MAX_RESPONSE_BYTES: '2048',
          JWKS_MAX_KEYS: '25',
          JWKS_MAX_CACHE_ENTRIES: '7',
        }),
      );
      expect(p.totalDeadlineMs).toBe(4000);
      expect(p.maxResponseBytes).toBe(2048);
      expect(p.maxKeys).toBe(25);
      expect(p.maxCacheEntries).toBe(7);
    });

    it('clamps out-of-bounds cap values', () => {
      const low = resolveServerEgressDefaults(
        getFrom({ JWKS_TOTAL_DEADLINE_MS: '1', JWKS_MAX_KEYS: '0', JWKS_MAX_CACHE_ENTRIES: '0' }),
      );
      expect(low.totalDeadlineMs).toBe(EGRESS_POLICY_BOUNDS.totalDeadlineMs.min);
      expect(low.maxKeys).toBe(EGRESS_POLICY_BOUNDS.maxKeys.min);
      expect(low.maxCacheEntries).toBe(EGRESS_POLICY_BOUNDS.maxCacheEntries.min);

      const high = resolveServerEgressDefaults(
        getFrom({ JWKS_TOTAL_DEADLINE_MS: '999999999', JWKS_MAX_RESPONSE_BYTES: '999999999' }),
      );
      expect(high.totalDeadlineMs).toBe(EGRESS_POLICY_BOUNDS.totalDeadlineMs.max);
      expect(high.maxResponseBytes).toBe(EGRESS_POLICY_BOUNDS.maxResponseBytes.max);
    });

    it('falls back to the default for a non-numeric cap', () => {
      const p = resolveServerEgressDefaults(getFrom({ JWKS_MAX_KEYS: 'lots' }));
      expect(p.maxKeys).toBe(EGRESS_POLICY_DEFAULTS.maxKeys);
    });

    it('truncates fractional integer caps', () => {
      const p = resolveServerEgressDefaults(getFrom({ JWKS_MAX_KEYS: '12.9', JWKS_MAX_CACHE_ENTRIES: '3.7' }));
      expect(p.maxKeys).toBe(12);
      expect(p.maxCacheEntries).toBe(3);
    });

    it('endpoint overrides win for the caps too', () => {
      const merged = mergeEgressPolicy(server, { totalDeadlineMs: 2500, maxKeys: 40 });
      expect(merged.totalDeadlineMs).toBe(2500);
      expect(merged.maxKeys).toBe(40);
      expect(merged.maxResponseBytes).toBe(server.maxResponseBytes);
      expect(merged.maxCacheEntries).toBe(server.maxCacheEntries);
    });
  });
});
