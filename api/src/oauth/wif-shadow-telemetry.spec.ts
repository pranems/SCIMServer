import { computeShadowDecision } from './wif-shadow-telemetry';

/**
 * A4 - WIF shadow authorization telemetry unit tests.
 *
 * The core A4 contract: the shadow gate is COMPUTED but NEVER enforced
 * (`enforced` is always false). These tests prove the would-have-rejected
 * decision is calculated correctly without changing issuance.
 */
describe('computeShadowDecision (A4)', () => {
  it('is always inert: enforced is false on every path', () => {
    const allow = computeShadowDecision({ roles: ['Scim.Provision'], configuredScope: 'scim.read' });
    const reject = computeShadowDecision({
      roles: [],
      roleScopeMap: { 'Scim.Provision': ['scim.read'] },
      configuredScope: 'scim.read',
    });
    expect(allow.enforced).toBe(false);
    expect(reject.enforced).toBe(false);
  });

  it('does not reject or narrow when no roleScopeMap is configured', () => {
    const d = computeShadowDecision({
      roles: ['Anything'],
      configuredScope: 'scim.read scim.write',
    });
    expect(d.wouldReject).toBe(false);
    expect(d.narrows).toBe(false);
    expect(d.wouldGrantScopes).toEqual(['scim.read', 'scim.write']);
    expect(d.reason).toBeNull();
  });

  it('computes the would-grant scopes from the roleScopeMap (no enforcement)', () => {
    const d = computeShadowDecision({
      roles: ['Scim.Provision'],
      roleScopeMap: { 'Scim.Provision': ['scim.read', 'scim.write'], 'Scim.Read': ['scim.read'] },
      configuredScope: 'scim.read scim.write scim.manage',
    });
    expect(d.wouldGrantScopes.sort()).toEqual(['scim.read', 'scim.write']);
    expect(d.wouldReject).toBe(false);
  });

  it('flags wouldReject when no present role maps to a grantable scope', () => {
    const d = computeShadowDecision({
      roles: ['Unmapped.Role'],
      roleScopeMap: { 'Scim.Provision': ['scim.read'] },
      configuredScope: 'scim.read',
    });
    expect(d.wouldReject).toBe(true);
    expect(d.reason).toMatch(/no present role/i);
    expect(d.wouldGrantScopes).toEqual([]);
  });

  it('flags wouldReject when the roles claim is empty', () => {
    const d = computeShadowDecision({
      roles: [],
      roleScopeMap: { 'Scim.Provision': ['scim.read'] },
      configuredScope: 'scim.read',
    });
    expect(d.wouldReject).toBe(true);
  });

  it('intersects would-grant scopes with the grantedScopes catalog', () => {
    const d = computeShadowDecision({
      roles: ['Scim.Provision'],
      roleScopeMap: { 'Scim.Provision': ['scim.read', 'scim.write', 'scim.manage'] },
      grantedScopes: ['scim.read', 'scim.write'],
      configuredScope: 'scim.read scim.write',
    });
    // scim.manage is mapped by the role but NOT in the catalog -> dropped.
    expect(d.wouldGrantScopes.sort()).toEqual(['scim.read', 'scim.write']);
    expect(d.wouldReject).toBe(false);
  });

  it('flags narrows when the future grant is a strict subset of today scope', () => {
    const d = computeShadowDecision({
      roles: ['Scim.Read'],
      roleScopeMap: { 'Scim.Read': ['scim.read'] },
      configuredScope: 'scim.read scim.write scim.manage',
    });
    // Today mints 3 scopes; the future gate would grant only scim.read.
    expect(d.narrows).toBe(true);
    expect(d.wouldReject).toBe(false);
    expect(d.wouldGrantScopes).toEqual(['scim.read']);
  });

  it('does not flag narrows when the future grant equals today scope', () => {
    const d = computeShadowDecision({
      roles: ['Scim.Provision'],
      roleScopeMap: { 'Scim.Provision': ['scim.read', 'scim.write'] },
      configuredScope: 'scim.read scim.write',
    });
    expect(d.narrows).toBe(false);
  });

  it('defaults identityModel to per-app and echoes a configured value', () => {
    expect(computeShadowDecision({ roles: [] }).identityModel).toBe('per-app');
    expect(
      computeShadowDecision({ roles: [], identityModel: 'first-party' }).identityModel,
    ).toBe('first-party');
  });
});
