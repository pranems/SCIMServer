/**
 * Unit tests for the capability resolver (Phase 1, Gaps 2-7, 10).
 *
 * Resolves a per-endpoint capability/limit with precedence
 * **SPC -> settings -> registry default**, and a parent-dependency short-circuit
 * (a dependent setting is inert when its parent capability is off). Never throws;
 * a bad value falls back to the default (OpenFeature typed-evaluation rule).
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.2, §8.5
 */
import {
  resolveBooleanCapability,
  resolveNumericLimit,
  resolveDependentBoolean,
} from './capability-resolver';
import type { EndpointProfile, ServiceProviderConfig } from '../endpoint-profile/endpoint-profile.types';

function profile(
  spc: Partial<ServiceProviderConfig> | undefined,
  settings: Record<string, unknown> = {},
): EndpointProfile {
  return {
    schemas: [],
    resourceTypes: [],
    serviceProviderConfig: spc as ServiceProviderConfig,
    settings,
  } as EndpointProfile;
}

describe('resolveBooleanCapability', () => {
  it('uses the stored SPC value when present (precedence 1)', () => {
    const p = profile({ filter: { supported: false } }, { FilterSupported: true });
    expect(resolveBooleanCapability(p, (s) => s.filter?.supported, 'FilterSupported', true)).toBe(false);
  });

  it('falls back to the settings flag when SPC has no value (precedence 2)', () => {
    const p = profile({}, { FilterSupported: false });
    expect(resolveBooleanCapability(p, (s) => s.filter?.supported, 'FilterSupported', true)).toBe(false);
  });

  it('coerces string boolean settings ("False")', () => {
    const p = profile({}, { FilterSupported: 'False' });
    expect(resolveBooleanCapability(p, (s) => s.filter?.supported, 'FilterSupported', true)).toBe(false);
  });

  it('falls back to the registry default when neither SPC nor settings is set (precedence 3)', () => {
    const p = profile({}, {});
    expect(resolveBooleanCapability(p, (s) => s.filter?.supported, 'FilterSupported', true)).toBe(true);
  });

  it('returns the default when the profile is undefined (never throws)', () => {
    expect(resolveBooleanCapability(undefined, (s) => s.filter?.supported, undefined, true)).toBe(true);
  });

  it('ignores the settings flag when settingKey is undefined', () => {
    const p = profile({}, { FilterSupported: false });
    expect(resolveBooleanCapability(p, (s) => s.filter?.supported, undefined, true)).toBe(true);
  });
});

describe('resolveNumericLimit', () => {
  it('uses the per-endpoint SPC value when valid', () => {
    const p = profile({ filter: { supported: true, maxResults: 50 } });
    expect(resolveNumericLimit(p, (s) => s.filter?.maxResults, 200)).toBe(50);
  });

  it('falls back to the default when the SPC value is missing', () => {
    const p = profile({ filter: { supported: true } });
    expect(resolveNumericLimit(p, (s) => s.filter?.maxResults, 200)).toBe(200);
  });

  it('falls back to the default when the SPC value is not a positive number', () => {
    const p = profile({ filter: { supported: true, maxResults: 0 } });
    expect(resolveNumericLimit(p, (s) => s.filter?.maxResults, 200)).toBe(200);
  });

  it('returns the default when the profile is undefined', () => {
    expect(resolveNumericLimit(undefined, (s) => s.filter?.maxResults, 200)).toBe(200);
  });
});

describe('resolveDependentBoolean (parent short-circuit)', () => {
  it('returns the inert value when the parent capability is off', () => {
    // etag.supported = false -> RequireIfMatch is inert (false) regardless of its own value
    const p = profile({ etag: { supported: false } }, { RequireIfMatch: true });
    const result = resolveDependentBoolean(
      p,
      (s) => s.etag?.supported,
      'EtagSupported',
      true,
      () => resolveBooleanCapability(p, () => undefined, 'RequireIfMatch', false),
      false,
    );
    expect(result).toBe(false);
  });

  it('resolves the child normally when the parent capability is on', () => {
    const p = profile({ etag: { supported: true } }, { RequireIfMatch: true });
    const result = resolveDependentBoolean(
      p,
      (s) => s.etag?.supported,
      'EtagSupported',
      true,
      () => resolveBooleanCapability(p, () => undefined, 'RequireIfMatch', false),
      false,
    );
    expect(result).toBe(true);
  });
});
