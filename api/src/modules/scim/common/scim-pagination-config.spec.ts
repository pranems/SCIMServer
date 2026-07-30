import { RUNTIME_CONFIG_SPECS } from '../../../bootstrap/runtime-config';

/**
 * W1.7b - the SCIM pagination ceilings are environment-dependent (X15 section 7.5).
 *
 * `DEFAULT_COUNT` / `MAX_COUNT` are the SERVER-level defaults. A per-endpoint
 * override still layers on top of `MAX_COUNT` through the ServiceProviderConfig
 * `filter.maxResults` cascade, which is the RFC 7644 mechanism - this env tier
 * only moves the server floor, it does not replace that.
 *
 * The module reads env once at import, so each case re-imports it in isolation.
 */
function loadConstants(env: Record<string, string | undefined>): { DEFAULT_COUNT: number; MAX_COUNT: number } {
  const original = process.env;
  process.env = { ...original, ...env };
  let mod!: { DEFAULT_COUNT: number; MAX_COUNT: number };
  jest.isolateModules(() => {
    mod = require('./scim-constants') as { DEFAULT_COUNT: number; MAX_COUNT: number };
  });
  process.env = original;
  return mod;
}

describe('SCIM pagination ceilings are configurable (W1.7b)', () => {
  it('uses the documented defaults when no env is set', () => {
    const c = loadConstants({ SCIM_DEFAULT_COUNT: undefined, SCIM_MAX_COUNT: undefined });
    expect(c.DEFAULT_COUNT).toBe(100);
    expect(c.MAX_COUNT).toBe(200);
  });

  it('keeps the historical values so no existing deployment changes behaviour', () => {
    const c = loadConstants({});
    expect(c.DEFAULT_COUNT).toBe(RUNTIME_CONFIG_SPECS.scim.defaultCount.default);
    expect(c.MAX_COUNT).toBe(RUNTIME_CONFIG_SPECS.scim.maxCount.default);
  });

  it('honours the env overrides', () => {
    const c = loadConstants({ SCIM_DEFAULT_COUNT: '25', SCIM_MAX_COUNT: '500' });
    expect(c.DEFAULT_COUNT).toBe(25);
    expect(c.MAX_COUNT).toBe(500);
  });

  it('clamps an absurd page size rather than letting it become a memory problem', () => {
    const c = loadConstants({ SCIM_MAX_COUNT: '100000' });
    expect(c.MAX_COUNT).toBe(RUNTIME_CONFIG_SPECS.scim.maxCount.max);
  });

  it('falls back to the default for a non-numeric value', () => {
    const c = loadConstants({ SCIM_MAX_COUNT: 'lots' });
    expect(c.MAX_COUNT).toBe(200);
  });
});
