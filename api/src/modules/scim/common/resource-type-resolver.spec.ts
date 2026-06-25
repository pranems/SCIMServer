/**
 * Unit tests for the resource-type resolver (Phase 1, Gaps 1 + 9).
 *
 * The resolver answers one question: does this endpoint's profile serve a given
 * resource type? It is the single, tested unit that both discovery and the
 * built-in CRUD controllers consult, so "advertised == enforced" is structural.
 *
 * Fail-open contract: when the profile or its resourceTypes is absent/empty
 * (legacy endpoints, partial unit mocks), the resolver reports `supported: true`
 * so behavior is unchanged. Only when resourceTypes is present and the type is
 * absent does it report `supported: false` (the reported user-only-endpoint bug).
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.1
 * @see RFC 7643 §6
 */
import { resolveResourceType } from './resource-type-resolver';
import type { EndpointProfile } from '../endpoint-profile/endpoint-profile.types';
import type { ScimResourceType } from '../discovery/scim-schema-registry';
import { SCIM_CORE_USER_SCHEMA, SCIM_CORE_GROUP_SCHEMA } from './scim-constants';

function rt(name: string, endpoint: string, schema: string): ScimResourceType {
  return { id: name, name, endpoint, description: name, schema, schemaExtensions: [] };
}

function profileWith(resourceTypes: ScimResourceType[]): EndpointProfile {
  return {
    schemas: [],
    resourceTypes,
    serviceProviderConfig: {
      patch: { supported: true },
      bulk: { supported: false },
      filter: { supported: true },
      changePassword: { supported: false },
      sort: { supported: true },
      etag: { supported: true },
    },
    settings: {},
  } as EndpointProfile;
}

const USER_RT = rt('User', '/Users', SCIM_CORE_USER_SCHEMA);
const GROUP_RT = rt('Group', '/Groups', SCIM_CORE_GROUP_SCHEMA);

describe('resolveResourceType', () => {
  describe('fail-open (no constraint declared)', () => {
    it('returns supported=true when profile is undefined', () => {
      expect(resolveResourceType(undefined, { name: 'Group' }).supported).toBe(true);
    });

    it('returns supported=true when resourceTypes is empty', () => {
      expect(resolveResourceType(profileWith([]), { name: 'Group' }).supported).toBe(true);
    });

    it('returns supported=true when resourceTypes is missing on the profile', () => {
      const profile = { schemas: [], settings: {} } as unknown as EndpointProfile;
      expect(resolveResourceType(profile, { name: 'Group' }).supported).toBe(true);
    });
  });

  describe('match by name (or id)', () => {
    it('returns supported=true and the matched type when name is present', () => {
      const result = resolveResourceType(profileWith([USER_RT, GROUP_RT]), { name: 'Group' });
      expect(result.supported).toBe(true);
      expect(result.resourceType?.name).toBe('Group');
    });

    it('matches on the resource type id as well as name', () => {
      const custom = rt('Device', '/Devices', 'urn:example:Device');
      const result = resolveResourceType(profileWith([custom]), { name: 'Device' });
      expect(result.supported).toBe(true);
      expect(result.resourceType?.id).toBe('Device');
    });
  });

  describe('the reported bug: user-only endpoint rejects Group', () => {
    it('returns supported=false for Group when only User is declared', () => {
      const result = resolveResourceType(profileWith([USER_RT]), { name: 'Group', endpointPath: '/Groups' });
      expect(result.supported).toBe(false);
      expect(result.resourceType).toBeUndefined();
    });

    it('still returns supported=true for User on a user-only endpoint', () => {
      const result = resolveResourceType(profileWith([USER_RT]), { name: 'User', endpointPath: '/Users' });
      expect(result.supported).toBe(true);
    });
  });

  describe('match by endpoint path', () => {
    it('returns supported=true when the endpoint path matches', () => {
      const result = resolveResourceType(profileWith([USER_RT]), { endpointPath: '/Users' });
      expect(result.supported).toBe(true);
    });

    it('returns supported=false when neither name nor endpoint path matches', () => {
      const result = resolveResourceType(profileWith([USER_RT]), { name: 'Group', endpointPath: '/Groups' });
      expect(result.supported).toBe(false);
    });

    it('matches when either the name OR the endpoint path matches (OR semantics)', () => {
      // name mismatched but endpoint path matches -> supported
      const result = resolveResourceType(profileWith([GROUP_RT]), { name: 'Nope', endpointPath: '/Groups' });
      expect(result.supported).toBe(true);
    });
  });
});
