/**
 * Unit tests for capability enforcement helpers (Phase 1, Gaps 2-5).
 *
 * These throwing helpers wrap the capability resolver + SCIM error envelope so
 * the three built-in controllers (Users / Groups / Me) share one definition of
 * each rejection (status, scimType, errorCode). Enforcement is fail-open: the
 * resolver default is permissive (true), so only a capability EXPLICITLY set to
 * false (in stored SPC or settings) is enforced.
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.2
 */
import {
  enforcePatchSupported,
  enforceFilterSupported,
  enforceSortSupported,
  enforceChangePasswordSupported,
  hasPasswordWrite,
} from './capability-enforcement';
import type { EndpointProfile, ServiceProviderConfig } from '../endpoint-profile/endpoint-profile.types';

function profile(spc: Partial<ServiceProviderConfig>): EndpointProfile {
  return { schemas: [], resourceTypes: [], serviceProviderConfig: spc as ServiceProviderConfig, settings: {} } as EndpointProfile;
}

function status(fn: () => void): number | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.();
  }
}

describe('enforcePatchSupported (Gap 4)', () => {
  it('throws 501 when patch.supported is explicitly false', () => {
    expect(status(() => enforcePatchSupported(profile({ patch: { supported: false } })))).toBe(501);
  });
  it('does not throw when patch.supported is true', () => {
    expect(status(() => enforcePatchSupported(profile({ patch: { supported: true } })))).toBeUndefined();
  });
  it('fail-open: does not throw when profile/SPC is absent', () => {
    expect(status(() => enforcePatchSupported(undefined))).toBeUndefined();
  });
});

describe('enforceFilterSupported (Gap 2)', () => {
  it('throws 403 when a filter is present and filter.supported is false', () => {
    expect(status(() => enforceFilterSupported(profile({ filter: { supported: false } }), 'userName eq "x"'))).toBe(403);
  });
  it('does not throw when no filter is supplied even if filter.supported is false', () => {
    expect(status(() => enforceFilterSupported(profile({ filter: { supported: false } }), undefined))).toBeUndefined();
  });
  it('does not throw when filter.supported is true', () => {
    expect(status(() => enforceFilterSupported(profile({ filter: { supported: true } }), 'userName eq "x"'))).toBeUndefined();
  });
  it('fail-open: does not throw when profile is absent', () => {
    expect(status(() => enforceFilterSupported(undefined, 'userName eq "x"'))).toBeUndefined();
  });
});

describe('enforceSortSupported (Gap 3)', () => {
  it('throws 403 when sortBy is present and sort.supported is false', () => {
    expect(status(() => enforceSortSupported(profile({ sort: { supported: false } }), 'userName'))).toBe(403);
  });
  it('does not throw when no sortBy is supplied', () => {
    expect(status(() => enforceSortSupported(profile({ sort: { supported: false } }), undefined))).toBeUndefined();
  });
  it('does not throw when sort.supported is true', () => {
    expect(status(() => enforceSortSupported(profile({ sort: { supported: true } }), 'userName'))).toBeUndefined();
  });
});

describe('enforceChangePasswordSupported (Gap 5)', () => {
  it('throws 400 when a password is present and changePassword.supported is false', () => {
    expect(status(() => enforceChangePasswordSupported(profile({ changePassword: { supported: false } }), true))).toBe(400);
  });
  it('does not throw when no password is present', () => {
    expect(status(() => enforceChangePasswordSupported(profile({ changePassword: { supported: false } }), false))).toBeUndefined();
  });
  it('fail-open: does not throw when changePassword is not explicitly set', () => {
    expect(status(() => enforceChangePasswordSupported(profile({}), true))).toBeUndefined();
  });
});

describe('hasPasswordWrite', () => {
  it('detects a top-level password field', () => {
    expect(hasPasswordWrite({ userName: 'a', password: 'secret' })).toBe(true);
  });
  it('ignores an empty password field', () => {
    expect(hasPasswordWrite({ userName: 'a', password: '' })).toBe(false);
  });
  it('returns false when there is no password', () => {
    expect(hasPasswordWrite({ userName: 'a' })).toBe(false);
  });
  it('detects a PATCH operation targeting password by path', () => {
    expect(hasPasswordWrite({ Operations: [{ op: 'replace', path: 'password', value: 'x' }] })).toBe(true);
  });
  it('detects a PATCH operation with a password key in the value object', () => {
    expect(hasPasswordWrite({ Operations: [{ op: 'replace', value: { password: 'x' } }] })).toBe(true);
  });
  it('returns false for a PATCH with no password operation', () => {
    expect(hasPasswordWrite({ Operations: [{ op: 'replace', path: 'displayName', value: 'x' }] })).toBe(false);
  });
  it('returns false for undefined body', () => {
    expect(hasPasswordWrite(undefined)).toBe(false);
  });
});
