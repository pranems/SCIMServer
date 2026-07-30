import { RuntimeConfigController } from './runtime-config.controller';
import { RUNTIME_CONFIG_SPECS } from '../../../bootstrap/runtime-config';

/**
 * W1.7c - the admin surface that answers "what configuration actually took
 * effect?" with a fact instead of "what do you have set?".
 *
 * The security contract is the load-bearing part: this response is assembled
 * from a fixed spec table of NUMERIC/SIZE tuning values, so no secret can reach
 * it by construction. The key-allowlist assertions below lock that in - per the
 * standing response-contract rule, asserting a field EXISTS is not asserting the
 * response is correct, so we assert the FULL key set both at the envelope and at
 * the per-setting level.
 */
describe('W1.7c RuntimeConfigController', () => {
  const controller = new RuntimeConfigController();

  const ENVELOPE_KEYS = ['schemas', 'groups', 'invariantWarnings'];
  const SETTING_KEYS = ['effective', 'source', 'default', 'min', 'max', 'clamped', 'requested'];

  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns only the documented envelope keys', () => {
    const body = controller.get();
    expect(Object.keys(body).sort()).toEqual([...ENVELOPE_KEYS].sort());
  });

  it('carries the runtime-config schema URN', () => {
    expect(controller.get().schemas).toEqual(['urn:scimserver:params:scim:schemas:admin:2.0:RuntimeConfig']);
  });

  it('exposes every configured group', () => {
    expect(Object.keys(controller.get().groups).sort()).toEqual(Object.keys(RUNTIME_CONFIG_SPECS).sort());
  });

  it('reports every setting with its provenance and bounds', () => {
    const http = controller.get().groups.http;
    expect(Object.keys(http).sort()).toEqual(Object.keys(RUNTIME_CONFIG_SPECS.http).sort());
    const setting = http.requestTimeoutMs;
    expect(setting.effective).toBe(RUNTIME_CONFIG_SPECS.http.requestTimeoutMs.default);
    expect(setting.source).toBe('default');
    expect(setting.clamped).toBe(false);
  });

  it('emits ONLY allowlisted keys on every setting - no internal fields leak', () => {
    const body = controller.get();
    for (const group of Object.values(body.groups)) {
      for (const setting of Object.values(group)) {
        for (const key of Object.keys(setting)) {
          expect(SETTING_KEYS).toContain(key);
        }
      }
    }
  });

  it('contains NO secret-bearing value anywhere in the payload', () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://user:sup3rs3cret@db:5432/scimdb',
      OAUTH_CLIENT_SECRET: 'oauth-secret-value',
      SCIM_SHARED_SECRET: 'scim-secret-value',
      JWKS_HOST_ALLOWLIST: 'login.microsoftonline.com',
    };
    const serialized = JSON.stringify(new RuntimeConfigController().get());
    for (const secret of ['sup3rs3cret', 'oauth-secret-value', 'scim-secret-value', 'login.microsoftonline.com']) {
      expect(serialized).not.toContain(secret);
    }
    // Nor the NAMES of the secret-bearing env vars.
    for (const key of ['DATABASE_URL', 'OAUTH_CLIENT_SECRET', 'SCIM_SHARED_SECRET', 'JWKS_HOST_ALLOWLIST']) {
      expect(serialized).not.toContain(key);
    }
  });

  it('surfaces a clamped value with what was requested - the case an operator most needs', () => {
    process.env = { ...originalEnv, DB_POOL_MAX: '9999' };
    const s = new RuntimeConfigController().get().groups.database.poolMax;
    expect(s.clamped).toBe(true);
    expect(s.requested).toBe(9999);
    expect(s.effective).toBe(RUNTIME_CONFIG_SPECS.database.poolMax.max);
  });

  it('surfaces cross-key invariant warnings so a misconfiguration is visible', () => {
    process.env = { ...originalEnv, HTTP_REQUEST_TIMEOUT_MS: '2000', DB_TX_TIMEOUT_MS: '60000' };
    const warnings = new RuntimeConfigController().get().invariantWarnings;
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toContain('DB_TX_TIMEOUT_MS');
  });

  it('reports an empty warning list when the configuration is coherent', () => {
    expect(controller.get().invariantWarnings).toEqual([]);
  });
});
