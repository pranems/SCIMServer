/**
 * endpoint-capabilities.ts - client mirror of the server's profile
 * resource-type resolution.
 *
 * Phase 1 of the Endpoint Profile Enforcement work (v0.53.3) made the
 * SCIM CRUD layer reject a resource type the endpoint profile does not
 * declare: e.g. `GET /scim/endpoints/:id/Groups` now returns
 * `404 noTarget` with diagnostics `errorCode: RESOURCE_TYPE_NOT_SUPPORTED`
 * for a user-only endpoint. The admin UI must not surface that as a
 * fatal "Something went wrong" page - it has to:
 *
 *   1. hide the tab for a resource type the endpoint does not serve, and
 *   2. render a contained "not supported" empty state if a stale
 *      deep-link / refresh lands on such a tab.
 *
 * `endpointSupportsResourceType` mirrors the server's
 * `resolveResourceType` (api/src/modules/scim/common/resource-type-resolver.ts)
 * EXACTLY, including the fail-open rule: when the profile or its
 * `resourceTypes` is absent or empty, every resource type is considered
 * supported (legacy endpoints, partial payloads). Keeping the two in
 * lockstep is what prevents the discovery/CRUD/UI drift that caused the
 * original bug.
 *
 * @see api/src/modules/scim/common/resource-type-resolver.ts
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.1
 */
import { ScimApiError } from './scim-error';

/** Match criteria - by resource type name/id and/or its endpoint path. */
export interface ResourceTypeMatch {
  /** Resource type id or name (e.g. "Group"). */
  name?: string;
  /** Resource type endpoint path (e.g. "/Groups"). */
  endpointPath?: string;
}

/**
 * Does this endpoint profile serve the given resource type?
 *
 * Fail-open: returns `true` when `profile` or `profile.resourceTypes`
 * is absent or empty, matching the server resolver so the UI never
 * hides a tab the server would actually serve.
 */
export function endpointSupportsResourceType(
  profile: Record<string, unknown> | undefined,
  match: ResourceTypeMatch,
): boolean {
  const resourceTypes = profile?.['resourceTypes'];
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
    return true; // fail-open: nothing declared, nothing to enforce
  }
  return resourceTypes.some((rt) => {
    if (!rt || typeof rt !== 'object') return false;
    const r = rt as { id?: unknown; name?: unknown; endpoint?: unknown };
    return (
      (match.name !== undefined && (r.id === match.name || r.name === match.name)) ||
      (match.endpointPath !== undefined && r.endpoint === match.endpointPath)
    );
  });
}

/**
 * Is this error the server's "resource type not supported" 404?
 *
 * Prefers the machine-readable diagnostics `errorCode`
 * (`RESOURCE_TYPE_NOT_SUPPORTED`) emitted in the SCIM error envelope's
 * Diagnostics extension; falls back to the `noTarget` scimType plus the
 * detail phrase so a trimmed error body still classifies correctly.
 */
export function isResourceTypeUnsupportedError(err: unknown): boolean {
  if (!(err instanceof ScimApiError)) return false;
  if (err.status !== 404) return false;

  const body = err.rawBody;
  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (
        key.toLowerCase().includes('diagnostics') &&
        value &&
        typeof value === 'object' &&
        (value as { errorCode?: unknown }).errorCode === 'RESOURCE_TYPE_NOT_SUPPORTED'
      ) {
        return true;
      }
    }
  }

  return (
    err.scimType === 'noTarget' &&
    typeof err.detail === 'string' &&
    /is not supported by endpoint/i.test(err.detail)
  );
}
