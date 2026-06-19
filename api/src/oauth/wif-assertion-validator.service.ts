import { Injectable } from '@nestjs/common';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import type { IdentityModel, RoleEnforcementMode } from './wif-shadow-telemetry';

/**
 * The non-secret WIF trust record the validator checks an assertion against.
 * These are ALL public values (mirrors the `wif` EndpointCredential.metadata
 * persisted by the admin credential API - no secret material).
 */
export interface WifTrust {
  expectedIssuer: string;
  expectedSubject: string;
  expectedAudience: string;
  jwksUri: string;
  allowedTenantId: string;
  requiredRoles?: string[];
  expectedResource?: string | null;
  scope?: string;
  issuedTokenTtlSec?: number;
  // ── A4 seams (inert in A4: stored + computed in shadow, never enforced) ──
  /** per-app vs first-party identity model (telemetry attribution). */
  identityModel?: IdentityModel;
  /** Per-endpoint role -> scopes map (future authZ; not enforced in A4). */
  roleScopeMap?: Record<string, string[]>;
  /** Catalog subset this endpoint may grant (future authZ; not enforced in A4). */
  grantedScopes?: string[];
  /** Role-enforcement posture. A4 ships `off`; `shadow`/`enforce` are seams. */
  roleEnforcement?: RoleEnforcementMode;
}

/** The validated assertion claims returned on success. */
export interface WifValidatedClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  tid?: string;
  roles?: string[];
  [claim: string]: unknown;
}

/** Raised when a WIF assertion fails validation (mine-but-invalid-stop). */
export class WifAssertionInvalidError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'WifAssertionInvalidError';
  }
}

/**
 * WifAssertionValidatorService (Q6.3) - the WIF security core.
 *
 * Layers the WIF claim checks on top of the Q2 `ExternalJwksValidatorService`
 * signature/alg/JWKS-cache/fail-closed primitive. The full lifecycle:
 *
 *  1. Signature + algorithm-pin (RS256/ES256) + JWKS cache/refetch/fail-closed
 *     - delegated to `ExternalJwksValidatorService.verify` (which also enforces
 *     the `exp`/`nbf` time window via `jose`).
 *  2. `iss` / `aud` / `sub` / `tid` must match the configured trust.
 *  3. `requiredRoles` must be a subset of the assertion's `roles` claim.
 *
 * Any failure throws `WifAssertionInvalidError` (the caller maps that to the
 * RFC 6749 `invalid_client` token-endpoint error). It NEVER returns partial or
 * unchecked claims.
 */
@Injectable()
export class WifAssertionValidatorService {
  constructor(
    private readonly jwks: ExternalJwksValidatorService,
    private readonly logger: ScimLogger,
  ) {}

  async validate(assertion: string, trust: WifTrust): Promise<WifValidatedClaims> {
    // Step 1 - signature + alg-pin + time window + JWKS fail-closed (Q2). A
    // bad signature, an `alg: none`/HMAC token, an expired/not-yet-valid token,
    // or a JWKS outage all throw here (propagated as mine-but-invalid-stop).
    const { payload } = await this.jwks.verify(assertion, trust.jwksUri);
    const claims = payload as unknown as WifValidatedClaims;

    // Step 2 - issuer / subject / audience / tenant must match the trust.
    if (claims.iss !== trust.expectedIssuer) {
      this.fail('issuer mismatch', trust);
    }
    if (claims.sub !== trust.expectedSubject) {
      this.fail('subject mismatch', trust);
    }
    if (!this.audienceMatches(claims.aud, trust.expectedAudience)) {
      this.fail('audience mismatch', trust);
    }
    // Cross-tenant isolation: when a tenant id is configured, the assertion's
    // `tid` MUST match it exactly.
    if (claims.tid !== trust.allowedTenantId) {
      this.fail('tenant mismatch', trust);
    }

    // Step 3 - required roles must be a subset of the assertion's `roles`.
    const required = trust.requiredRoles ?? [];
    if (required.length > 0) {
      const present = Array.isArray(claims.roles) ? claims.roles : [];
      const missing = required.filter((r) => !present.includes(r));
      if (missing.length > 0) {
        this.fail(`missing required role(s): ${missing.join(', ')}`, trust);
      }
    }

    return claims;
  }

  /** Accept a string `aud` equal to the expected value, or an array containing it. */
  private audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
    if (Array.isArray(aud)) return aud.includes(expected);
    return aud === expected;
  }

  private fail(reason: string, trust: WifTrust): never {
    this.logger.warn(LogCategory.AUTH, 'WIF assertion rejected', {
      reason,
      issuer: trust.expectedIssuer,
    });
    throw new WifAssertionInvalidError(reason);
  }
}
