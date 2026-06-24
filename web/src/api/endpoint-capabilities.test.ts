/**
 * endpoint-capabilities.test.ts - locks the client mirror of the
 * server's profile resource-type resolution.
 *
 * The fail-open rule + match-by-name/id/endpoint behavior MUST stay in
 * lockstep with api/src/modules/scim/common/resource-type-resolver.ts.
 * The regression these guard against: v0.53.3 profile enforcement made
 * /Groups 404 on a user-only endpoint, and the UI surfaced it as a
 * fatal page instead of hiding the unsupported tab.
 */
import { describe, it, expect } from 'vitest';
import {
  endpointSupportsResourceType,
  isResourceTypeUnsupportedError,
} from './endpoint-capabilities';
import { ScimApiError } from './scim-error';

const userOnlyProfile = {
  resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users' }],
};
const userAndGroupProfile = {
  resourceTypes: [
    { id: 'User', name: 'User', endpoint: '/Users' },
    { id: 'Group', name: 'Group', endpoint: '/Groups' },
  ],
};

describe('endpointSupportsResourceType', () => {
  it('fails open when profile is undefined', () => {
    expect(endpointSupportsResourceType(undefined, { name: 'Group' })).toBe(true);
  });

  it('fails open when resourceTypes is absent', () => {
    expect(endpointSupportsResourceType({ settings: {} }, { name: 'Group' })).toBe(true);
  });

  it('fails open when resourceTypes is an empty array', () => {
    expect(endpointSupportsResourceType({ resourceTypes: [] }, { name: 'Group' })).toBe(true);
  });

  it('returns false for Group on a user-only profile (the regression case)', () => {
    expect(endpointSupportsResourceType(userOnlyProfile, { name: 'Group' })).toBe(false);
  });

  it('returns true for User on a user-only profile', () => {
    expect(endpointSupportsResourceType(userOnlyProfile, { name: 'User' })).toBe(true);
  });

  it('returns true for both User and Group on a full profile', () => {
    expect(endpointSupportsResourceType(userAndGroupProfile, { name: 'User' })).toBe(true);
    expect(endpointSupportsResourceType(userAndGroupProfile, { name: 'Group' })).toBe(true);
  });

  it('matches by endpoint path as well as name', () => {
    expect(
      endpointSupportsResourceType(userOnlyProfile, { endpointPath: '/Users' }),
    ).toBe(true);
    expect(
      endpointSupportsResourceType(userOnlyProfile, { endpointPath: '/Groups' }),
    ).toBe(false);
  });

  it('matches when either name or endpoint path matches', () => {
    expect(
      endpointSupportsResourceType(userOnlyProfile, { name: 'Group', endpointPath: '/Users' }),
    ).toBe(true);
  });

  it('ignores malformed resourceTypes entries without throwing', () => {
    const profile = { resourceTypes: [null, 'x', { name: 'User' }] };
    expect(endpointSupportsResourceType(profile, { name: 'User' })).toBe(true);
    expect(endpointSupportsResourceType(profile, { name: 'Group' })).toBe(false);
  });
});

describe('isResourceTypeUnsupportedError', () => {
  it('detects the diagnostics errorCode RESOURCE_TYPE_NOT_SUPPORTED', () => {
    const err = new ScimApiError({
      status: 404,
      scimType: 'noTarget',
      detail: 'Resource type "Group" is not supported by endpoint "x".',
      rawBody: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        scimType: 'noTarget',
        'urn:ietf:params:scim:api:messages:2.0:Diagnostics': {
          errorCode: 'RESOURCE_TYPE_NOT_SUPPORTED',
        },
      },
    });
    expect(isResourceTypeUnsupportedError(err)).toBe(true);
  });

  it('falls back to noTarget + detail phrase when diagnostics are absent', () => {
    const err = new ScimApiError({
      status: 404,
      scimType: 'noTarget',
      detail: 'Resource type "Group" is not supported by endpoint "x".',
    });
    expect(isResourceTypeUnsupportedError(err)).toBe(true);
  });

  it('returns false for an unrelated 404 (genuine not-found)', () => {
    const err = new ScimApiError({
      status: 404,
      scimType: 'noTarget',
      detail: 'User not found',
    });
    expect(isResourceTypeUnsupportedError(err)).toBe(false);
  });

  it('returns false for a non-404 error', () => {
    const err = new ScimApiError({ status: 403, detail: 'forbidden' });
    expect(isResourceTypeUnsupportedError(err)).toBe(false);
  });

  it('returns false for a plain Error / non-ScimApiError', () => {
    expect(isResourceTypeUnsupportedError(new Error('boom'))).toBe(false);
    expect(isResourceTypeUnsupportedError('nope')).toBe(false);
    expect(isResourceTypeUnsupportedError(null)).toBe(false);
  });
});
