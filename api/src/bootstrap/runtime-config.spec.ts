import {
  resolveRuntimeConfig,
  RUNTIME_CONFIG_SPECS,
  formatRuntimeConfigLines,
} from './runtime-config';

const emptyGet = (): string | undefined => undefined;
const getFrom = (values: Record<string, string | undefined>) => (k: string) => values[k];

describe('runtime-config', () => {
  describe('defaults', () => {
    it('resolves every numeric setting to its hardcoded default when no env is set', () => {
      const cfg = resolveRuntimeConfig(emptyGet);
      for (const [group, specs] of Object.entries(RUNTIME_CONFIG_SPECS)) {
        for (const [key, spec] of Object.entries(specs)) {
          const setting = cfg.groups[group as keyof typeof cfg.groups][key];
          expect(setting.effective).toBe(spec.default);
          expect(setting.source).toBe('default');
          expect(setting.clamped).toBe(false);
        }
      }
    });

    it('produces no invariant warnings with the shipped defaults', () => {
      expect(resolveRuntimeConfig(emptyGet).warnings).toEqual([]);
    });
  });

  describe('env resolution', () => {
    it('reads a valid env value and records the source', () => {
      const cfg = resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '10' }));
      expect(cfg.groups.database.poolMax.effective).toBe(10);
      expect(cfg.groups.database.poolMax.source).toBe('env');
    });

    it('falls back to the default for a non-numeric env value rather than throwing', () => {
      const cfg = resolveRuntimeConfig(getFrom({ DB_POOL_MAX: 'not-a-number' }));
      expect(cfg.groups.database.poolMax.effective).toBe(RUNTIME_CONFIG_SPECS.database.poolMax.default);
      expect(cfg.groups.database.poolMax.source).toBe('default');
    });

    it('falls back to the default for an empty env value', () => {
      const cfg = resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '   ' }));
      expect(cfg.groups.database.poolMax.source).toBe('default');
    });

    it('truncates a fractional value for an integer setting', () => {
      const cfg = resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '7.9' }));
      expect(cfg.groups.database.poolMax.effective).toBe(7);
    });
  });

  describe('clamping', () => {
    it('clamps a value above max and records what was requested', () => {
      const cfg = resolveRuntimeConfig(getFrom({ HTTP_REQUEST_TIMEOUT_MS: '99999999' }));
      const s = cfg.groups.http.requestTimeoutMs;
      expect(s.effective).toBe(RUNTIME_CONFIG_SPECS.http.requestTimeoutMs.max);
      expect(s.requested).toBe(99999999);
      expect(s.clamped).toBe(true);
    });

    it('clamps a value below min', () => {
      const cfg = resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '0' }));
      const s = cfg.groups.database.poolMax;
      expect(s.effective).toBe(RUNTIME_CONFIG_SPECS.database.poolMax.min);
      expect(s.clamped).toBe(true);
    });

    it('never lets a configuration path disable a bound entirely', () => {
      const cfg = resolveRuntimeConfig(
        getFrom({ HTTP_REQUEST_TIMEOUT_MS: '0', DB_POOL_ACQUIRE_TIMEOUT_MS: '0' }),
      );
      expect(cfg.groups.http.requestTimeoutMs.effective).toBeGreaterThan(0);
      expect(cfg.groups.database.poolAcquireTimeoutMs.effective).toBeGreaterThan(0);
    });
  });

  describe('legacy REQUEST_TIMEOUT_MS alias (X15-F2 backward compatibility)', () => {
    it('uses REQUEST_TIMEOUT_MS for the request timeout when the new key is unset', () => {
      const cfg = resolveRuntimeConfig(getFrom({ REQUEST_TIMEOUT_MS: '45000' }));
      expect(cfg.groups.http.requestTimeoutMs.effective).toBe(45000);
      expect(cfg.groups.http.requestTimeoutMs.source).toBe('legacy-env');
    });

    it('preserves today behaviour by also driving keepAliveTimeout from the legacy key', () => {
      const cfg = resolveRuntimeConfig(getFrom({ REQUEST_TIMEOUT_MS: '45000' }));
      expect(cfg.groups.http.keepAliveTimeoutMs.effective).toBe(45000);
      expect(cfg.groups.http.keepAliveTimeoutMs.source).toBe('legacy-env');
    });

    it('prefers the explicit new key over the legacy alias', () => {
      const cfg = resolveRuntimeConfig(
        getFrom({ REQUEST_TIMEOUT_MS: '45000', HTTP_REQUEST_TIMEOUT_MS: '90000' }),
      );
      expect(cfg.groups.http.requestTimeoutMs.effective).toBe(90000);
      expect(cfg.groups.http.requestTimeoutMs.source).toBe('env');
    });

    it('does NOT apply the legacy alias to headersTimeout - it never bounded that', () => {
      const cfg = resolveRuntimeConfig(getFrom({ REQUEST_TIMEOUT_MS: '45000' }));
      expect(cfg.groups.http.headersTimeoutMs.source).toBe('default');
    });
  });

  describe('cross-key invariants', () => {
    it('warns when the transaction timeout exceeds the request timeout', () => {
      const cfg = resolveRuntimeConfig(
        getFrom({ HTTP_REQUEST_TIMEOUT_MS: '5000', DB_TX_TIMEOUT_MS: '30000' }),
      );
      expect(cfg.warnings.join(' ')).toMatch(/DB_TX_TIMEOUT_MS.*HTTP_REQUEST_TIMEOUT_MS/);
    });

    it('warns when the default page size exceeds the max page size', () => {
      const cfg = resolveRuntimeConfig(getFrom({ SCIM_DEFAULT_COUNT: '500', SCIM_MAX_COUNT: '200' }));
      expect(cfg.warnings.join(' ')).toMatch(/SCIM_DEFAULT_COUNT/);
    });

    it('warns when the keep-alive buffer is not smaller than the keep-alive timeout', () => {
      const cfg = resolveRuntimeConfig(
        getFrom({ HTTP_KEEPALIVE_TIMEOUT_MS: '1000', HTTP_KEEPALIVE_TIMEOUT_BUFFER_MS: '5000' }),
      );
      expect(cfg.warnings.join(' ')).toMatch(/HTTP_KEEPALIVE_TIMEOUT_BUFFER_MS/);
    });

    it('never throws on a violated invariant - a tuning mistake must not stop startup', () => {
      expect(() =>
        resolveRuntimeConfig(getFrom({ HTTP_REQUEST_TIMEOUT_MS: '1000', DB_TX_TIMEOUT_MS: '300000' })),
      ).not.toThrow();
    });
  });

  describe('string settings (body limits)', () => {
    it('defaults the body limits', () => {
      const cfg = resolveRuntimeConfig(emptyGet);
      expect(cfg.groups.http.jsonBodyLimit.effective).toBe('5mb');
      expect(cfg.groups.http.formBodyLimit.effective).toBe('1mb');
    });

    it('reads a body limit from env', () => {
      const cfg = resolveRuntimeConfig(getFrom({ HTTP_JSON_BODY_LIMIT: '10mb' }));
      expect(cfg.groups.http.jsonBodyLimit.effective).toBe('10mb');
      expect(cfg.groups.http.jsonBodyLimit.source).toBe('env');
    });

    it('rejects a malformed body limit and falls back to the default', () => {
      const cfg = resolveRuntimeConfig(getFrom({ HTTP_JSON_BODY_LIMIT: 'enormous' }));
      expect(cfg.groups.http.jsonBodyLimit.effective).toBe('5mb');
      expect(cfg.groups.http.jsonBodyLimit.source).toBe('default');
    });
  });

  describe('observability (X15 section 8.2)', () => {
    it('emits one line per group naming every effective value and its source', () => {
      const lines = formatRuntimeConfigLines(resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '10' })));
      expect(lines).toHaveLength(Object.keys(RUNTIME_CONFIG_SPECS).length);
      const db = lines.find((l) => l.includes('database'));
      expect(db).toContain('poolMax=10(env)');
      expect(db).toContain('(default)');
    });

    it('marks a clamped value in the boot log so the operator can see it was overridden', () => {
      const lines = formatRuntimeConfigLines(resolveRuntimeConfig(getFrom({ DB_POOL_MAX: '9999' })));
      expect(lines.find((l) => l.includes('database'))).toContain('poolMax=100(clamped');
    });
  });
});
