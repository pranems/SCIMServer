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
      expect(p).toEqual({ timeoutMs: 3000, retries: 4, retryBackoffMs: 150, cacheMaxAgeMs: 120000 });
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
    const server: EgressPolicy = { timeoutMs: 5000, retries: 2, retryBackoffMs: 200, cacheMaxAgeMs: 600000 };

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
});
