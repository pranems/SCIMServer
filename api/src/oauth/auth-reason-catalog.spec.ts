import {
  AUTH_REASON_CATALOG,
  getAuthReason,
  wireDescriptionFor,
  isKnownAuthReason,
} from './auth-reason-catalog';
import { AuthErrorsCatalogController } from './auth-errors-catalog.controller';

describe('WI-D2 auth-reason catalog', () => {
  it('has unique reason codes (never repurposed)', () => {
    const codes = AUTH_REASON_CATALOG.map((e) => e.reasonCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('maps every reason to a valid RFC-6749/6750 wire error', () => {
    const valid = new Set([
      'invalid_client',
      'invalid_request',
      'unsupported_grant_type',
      'invalid_token',
    ]);
    for (const e of AUTH_REASON_CATALOG) {
      expect(valid.has(e.wireError)).toBe(true);
    }
  });

  it('assigns every reason a visibility tier and a plane', () => {
    for (const e of AUTH_REASON_CATALOG) {
      expect(['T1', 'T2', 'T3', 'T4']).toContain(e.tier);
      expect(['wif', 'oauth_client', 'bearer']).toContain(e.plane);
      expect(typeof e.actorDescription).toBe('string');
      expect(e.actorDescription.length).toBeGreaterThan(0);
      expect(typeof e.remediation).toBe('string');
      expect(e.remediation.length).toBeGreaterThan(0);
    }
  });

  it('looks up a known reason by code', () => {
    const e = getAuthReason('wif_audience_mismatch');
    expect(e?.wireError).toBe('invalid_client');
    expect(e?.plane).toBe('wif');
  });

  it('returns undefined for an unknown code', () => {
    expect(getAuthReason('not_a_real_code')).toBeUndefined();
    expect(getAuthReason(undefined)).toBeUndefined();
    expect(getAuthReason(null)).toBeUndefined();
  });

  it('isKnownAuthReason discriminates known vs unknown', () => {
    expect(isKnownAuthReason('assertion_expired')).toBe(true);
    expect(isKnownAuthReason('nope')).toBe(false);
  });

  it('T3 (secret-opaque) reason gets a merged wire description, not the distinguishing one', () => {
    const merged = wireDescriptionFor('oauth_client_auth_failed');
    expect(merged).toBe('Client authentication failed.');
    expect(merged).not.toMatch(/not[- ]found|mismatch/i);
  });

  it('T1/T2 reasons expose the specific actor description on the wire', () => {
    expect(wireDescriptionFor('wif_audience_mismatch')).toMatch(/audience/i);
    expect(wireDescriptionFor('grant_type_unsupported')).toMatch(/client_credentials/i);
  });

  it('jwks_host_not_allowlisted remediation references the R1 full-CRUD verbs (delta D1)', () => {
    const e = getAuthReason('jwks_host_not_allowlisted');
    expect(e?.remediation).toMatch(/PUT/);
    expect(e?.remediation).toMatch(/PATCH/);
    expect(e?.remediation).toMatch(/Settings > JWKS host allowlist/);
  });
});

describe('WI-D2 AuthErrorsCatalogController', () => {
  let controller: AuthErrorsCatalogController;

  beforeEach(() => {
    controller = new AuthErrorsCatalogController();
  });

  it('returns the full catalog with count + reasons + docsUrl', () => {
    const res = controller.getCatalog();
    expect(res.count).toBe(AUTH_REASON_CATALOG.length);
    expect(Array.isArray(res.reasons)).toBe(true);
    expect((res.reasons as unknown[]).length).toBe(AUTH_REASON_CATALOG.length);
    expect(typeof res.docsUrl).toBe('string');
  });

  it('filters by a valid plane query', () => {
    const res = controller.getCatalog('wif');
    const reasons = res.reasons as Array<{ plane: string }>;
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.plane === 'wif')).toBe(true);
  });

  it('ignores an invalid plane query and returns everything', () => {
    const res = controller.getCatalog('bogus');
    expect(res.count).toBe(AUTH_REASON_CATALOG.length);
  });

  it('does not leak the internal tier-only merge in the description fields (each reason has actorDescription + remediation)', () => {
    const res = controller.getCatalog();
    const reasons = res.reasons as Array<{ actorDescription: string; remediation: string }>;
    for (const r of reasons) {
      expect(r.actorDescription.length).toBeGreaterThan(0);
      expect(r.remediation.length).toBeGreaterThan(0);
    }
  });
});
