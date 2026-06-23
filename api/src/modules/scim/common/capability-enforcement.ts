/**
 * Capability enforcement helpers (Phase 1, Gaps 2-5).
 *
 * Throwing wrappers around the capability resolver that produce the SCIM error
 * envelope for each rejection, shared by the Users / Groups / Me controllers so
 * the status / scimType / errorCode are defined once.
 *
 * Fail-open: the resolver default is permissive (`true`), so a capability is
 * enforced only when EXPLICITLY set to `false` in the stored SPC or settings.
 * This bounds the prod blast radius to endpoints that deliberately narrow
 * themselves (the design's principle 3).
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.2
 * @see RFC 7644 §3.4.2.2 (filter), §3.4.2.3 (sort), §3.5.2 (patch), §3.5.2.2 (changePassword)
 */
import type { EndpointProfile } from '../endpoint-profile/endpoint-profile.types';
import { resolveBooleanCapability } from './capability-resolver';
import { createScimError } from './scim-errors';

/** Gap 4: reject PATCH with 501 when patch.supported is explicitly false. */
export function enforcePatchSupported(profile: EndpointProfile | undefined): void {
  const supported = resolveBooleanCapability(profile, (s) => s.patch?.supported, undefined, true);
  if (!supported) {
    throw createScimError({
      status: 501,
      scimType: 'notImplemented',
      detail: 'PATCH is not supported by this endpoint (serviceProviderConfig.patch.supported = false).',
      diagnostics: { errorCode: 'CAPABILITY_NOT_SUPPORTED', triggeredBy: 'patch.supported' },
    });
  }
}

/** Gap 2: reject a filtered request with 403 when filter.supported is explicitly false. */
export function enforceFilterSupported(profile: EndpointProfile | undefined, filter: string | undefined): void {
  if (!filter) return; // no filter supplied -> nothing to enforce
  const supported = resolveBooleanCapability(profile, (s) => s.filter?.supported, undefined, true);
  if (!supported) {
    throw createScimError({
      status: 403,
      detail: 'Filtering is not supported by this endpoint (serviceProviderConfig.filter.supported = false).',
      diagnostics: { errorCode: 'CAPABILITY_NOT_SUPPORTED', triggeredBy: 'filter.supported', filterExpression: filter },
    });
  }
}

/** Gap 3: reject a sorted request with 403 when sort.supported is explicitly false. */
export function enforceSortSupported(profile: EndpointProfile | undefined, sortBy: string | undefined): void {
  if (!sortBy) return; // no sortBy supplied -> nothing to enforce
  const supported = resolveBooleanCapability(profile, (s) => s.sort?.supported, undefined, true);
  if (!supported) {
    throw createScimError({
      status: 403,
      detail: 'Sorting is not supported by this endpoint (serviceProviderConfig.sort.supported = false).',
      diagnostics: { errorCode: 'CAPABILITY_NOT_SUPPORTED', triggeredBy: 'sort.supported' },
    });
  }
}

/** Gap 5: reject a password write with 400 when changePassword.supported is explicitly false. */
export function enforceChangePasswordSupported(profile: EndpointProfile | undefined, hasPassword: boolean): void {
  if (!hasPassword) return; // no password in payload -> nothing to enforce
  const supported = resolveBooleanCapability(profile, (s) => s.changePassword?.supported, undefined, true);
  if (!supported) {
    throw createScimError({
      status: 400,
      scimType: 'mutability',
      detail: 'Password changes are not supported by this endpoint (serviceProviderConfig.changePassword.supported = false).',
      diagnostics: { errorCode: 'CAPABILITY_NOT_SUPPORTED', triggeredBy: 'changePassword.supported', attributePath: 'password' },
    });
  }
}

/**
 * Whether a write payload contains a password: a non-empty top-level `password`
 * field (POST/PUT) or a PATCH operation targeting password (path contains
 * "password" or a value object with a `password` key). Shared by the Users and
 * Me controllers so Gap 5 detection is defined once.
 */
export function hasPasswordWrite(body: Record<string, unknown> | undefined): boolean {
  if (!body) return false;
  if (typeof body.password === 'string' && body.password.length > 0) return true;
  const ops = body.Operations;
  if (Array.isArray(ops)) {
    return ops.some((op) => {
      const o = op as { path?: string; value?: unknown };
      if (typeof o.path === 'string' && o.path.toLowerCase().includes('password')) return true;
      if (o.value && typeof o.value === 'object' && 'password' in (o.value as Record<string, unknown>)) return true;
      return false;
    });
  }
  return false;
}
