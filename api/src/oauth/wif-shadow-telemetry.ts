/**
 * WIF shadow authorization telemetry (A4).
 *
 * The architecture (section 11, "Would-have-rejected shadow counter") calls for
 * computing the future role -> scope authorization gate WITHOUT enforcing it
 * while `roleEnforcement` is `off`. This lets an operator see - in telemetry,
 * before flipping enforcement on - whether turning it on would have rejected or
 * narrowed a live customer's token.
 *
 * This module is INERT by construction: `computeShadowDecision` is a pure
 * function that NEVER changes what the token endpoint mints. Its result is
 * emitted as a log/metric only. `enforced` is hard-coded `false` so a reader can
 * never mistake the shadow result for an applied decision.
 */

/** Whether the relationship is a per-app trust or a first-party (1P) trust. */
export type IdentityModel = 'per-app' | 'first-party';

/** Role-enforcement posture. A4 ships `off` only; `shadow`/`enforce` are seams. */
export type RoleEnforcementMode = 'off' | 'shadow' | 'enforce';

/** Inputs to the shadow gate - the validated assertion roles + the trust seams. */
export interface ShadowAuthzInput {
  /** Roles present on the validated assertion (`roles` claim). */
  roles: string[];
  /** Per-endpoint role -> scopes map (seam; not enforced in A4). */
  roleScopeMap?: Record<string, string[]>;
  /** Catalog subset this endpoint may grant (seam; not enforced in A4). */
  grantedScopes?: string[];
  /** The scope actually minted today (the admin-configured trust scope). */
  configuredScope?: string;
  /** The identity model of the trust (recorded for telemetry attribution). */
  identityModel?: IdentityModel;
}

/**
 * The shadow decision. `enforced` is ALWAYS `false` in A4 - this is what the
 * future gate WOULD do, never what was applied.
 */
export interface ShadowDecision {
  /** Whether the future role -> scope gate WOULD have rejected the request. */
  wouldReject: boolean;
  /** Human-readable reason when `wouldReject` is true; otherwise `null`. */
  reason: string | null;
  /** The scopes the future gate WOULD grant (from roleScopeMap ∩ grantedScopes). */
  wouldGrantScopes: string[];
  /** The scopes minted today (from the configured trust scope). */
  configuredScopes: string[];
  /** Whether the future gate would grant FEWER scopes than today (a narrowing). */
  narrows: boolean;
  /** The identity model recorded for telemetry attribution. */
  identityModel: IdentityModel;
  /** ALWAYS false in A4 - the shadow gate is computed, never enforced. */
  enforced: false;
}

function uniqueScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.filter((s) => s.length > 0)));
}

/**
 * Compute the shadow (would-have-rejected) decision for a WIF assertion.
 *
 * Pure + inert: this NEVER mutates input and NEVER affects issuance. The caller
 * mints with the configured scope regardless of this result; the result is
 * telemetry only.
 */
export function computeShadowDecision(input: ShadowAuthzInput): ShadowDecision {
  const identityModel: IdentityModel = input.identityModel ?? 'per-app';
  const configuredScopes = uniqueScopes((input.configuredScope ?? '').split(' '));

  // With no roleScopeMap configured the future gate has nothing to narrow on -
  // it would grant exactly what is configured today (no reject, no narrowing).
  if (!input.roleScopeMap || Object.keys(input.roleScopeMap).length === 0) {
    return {
      wouldReject: false,
      reason: null,
      wouldGrantScopes: configuredScopes,
      configuredScopes,
      narrows: false,
      identityModel,
      enforced: false,
    };
  }

  // Union the scopes each present role would grant.
  const mapped: string[] = [];
  for (const role of input.roles) {
    const scopes = input.roleScopeMap[role];
    if (Array.isArray(scopes)) mapped.push(...scopes);
  }

  // Intersect with the per-endpoint granted-scope catalog when present.
  let wouldGrantScopes = uniqueScopes(mapped);
  if (input.grantedScopes && input.grantedScopes.length > 0) {
    const catalog = new Set(input.grantedScopes);
    wouldGrantScopes = wouldGrantScopes.filter((s) => catalog.has(s));
  }

  // The future gate would reject when no present role maps to any grantable scope.
  const wouldReject = wouldGrantScopes.length === 0;
  const reason = wouldReject
    ? 'no present role maps to a grantable scope'
    : null;

  // It narrows when the future grant is a strict subset of today's blanket scope.
  const configuredSet = new Set(configuredScopes);
  const narrows =
    !wouldReject &&
    wouldGrantScopes.length < configuredScopes.length &&
    wouldGrantScopes.every((s) => configuredSet.has(s));

  return {
    wouldReject,
    reason,
    wouldGrantScopes,
    configuredScopes,
    narrows,
    identityModel,
    enforced: false,
  };
}
