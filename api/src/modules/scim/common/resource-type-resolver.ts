/**
 * Resource-type resolver (Phase 1, Gaps 1 + 9).
 *
 * Single source of truth for "does this endpoint serve resource type X?". Both
 * the discovery layer and the built-in CRUD controllers (Users / Groups / Me)
 * and the bulk dispatcher consult this one pure function, so what `/ResourceTypes`
 * advertises and what CRUD enforces cannot drift.
 *
 * Fail-open: when the profile or its `resourceTypes` is absent/empty (legacy
 * endpoints, partial unit mocks), the resolver reports `supported: true` so
 * behavior is unchanged. Only when `resourceTypes` is present and the requested
 * type is absent does it report `supported: false`.
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.1
 * @see RFC 7643 §6 - ResourceType definitions
 */
import type { EndpointProfile } from '../endpoint-profile/endpoint-profile.types';
import type { ScimResourceType } from '../discovery/scim-schema-registry';

export interface ResourceTypeMatch {
  /** Resource type id or name (e.g. "Group"). */
  name?: string;
  /** Resource type endpoint path (e.g. "/Groups"). */
  endpointPath?: string;
}

export interface ResourceTypeResolution {
  supported: boolean;
  resourceType?: ScimResourceType;
}

/**
 * Resolve a resource type from the endpoint profile by name/id OR endpoint path.
 * Returns `{ supported: true }` (fail-open) when no constraint is declared.
 */
export function resolveResourceType(
  profile: EndpointProfile | undefined,
  match: ResourceTypeMatch,
): ResourceTypeResolution {
  const resourceTypes = profile?.resourceTypes;
  if (!resourceTypes || resourceTypes.length === 0) {
    return { supported: true }; // fail-open: nothing declared, nothing to enforce
  }

  const resourceType = resourceTypes.find(
    (r) =>
      (match.name !== undefined && (r.id === match.name || r.name === match.name)) ||
      (match.endpointPath !== undefined && r.endpoint === match.endpointPath),
  );

  return { supported: !!resourceType, resourceType };
}
