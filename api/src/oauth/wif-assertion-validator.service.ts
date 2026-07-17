import { Injectable } from '@nestjs/common';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import type { IdentityModel, RoleEnforcementMode } from './wif-shadow-telemetry';
import {
  AuthDecisionTraceBuilder,
  mapJwksErrorToReason,
  type AuthDecisionTrace,
} from './auth-decision-trace';

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
  constructor(
    public readonly reason: string,
    /** WI-D3 - the catalog reason code + decision trace for this rejection. */
    public readonly reasonCode?: string,
    public readonly trace?: AuthDecisionTrace,
  ) {
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
    const { claims } = await this.runChecks(assertion, trust);
    return claims;
  }

  /**
   * Phase 1 (auth observability) - run the full validation and return BOTH the
   * verified claims AND the complete accept `AuthDecisionTrace` (every check
   * with expected + received populated). The token provider records THIS trace
   * instead of synthesizing a lossy 2-check summary, so the diagnostics table
   * shows the real per-claim expected-vs-received on the accept path too.
   */
  async validateWithTrace(
    assertion: string,
    trust: WifTrust,
  ): Promise<{ claims: WifValidatedClaims; trace: AuthDecisionTrace }> {
    return this.runChecks(assertion, trust);
  }

  /**
   * The single validation core. Builds an ordered decision trace as it runs the
   * checks, so the reject reason_code, the log, and the UI diff all derive from
   * one object. Throws `WifAssertionInvalidError` (carrying the reject trace) on
   * any failed check; returns the verified claims + the accept trace on success.
   */
  private async runChecks(
    assertion: string,
    trust: WifTrust,
  ): Promise<{ claims: WifValidatedClaims; trace: AuthDecisionTrace }> {
    // WI-D3 - build an ordered decision trace as we run the checks, so the
    // reject reason_code, the log, and the UI diff all derive from one object.
    const trace = new AuthDecisionTraceBuilder('token-mint', 'wif', {
      endpointId: undefined,
    });

    // Step 1 - signature + alg-pin + time window + JWKS fail-closed (Q2). A
    // bad signature, an `alg: none`/HMAC token, an expired/not-yet-valid token,
    // or a JWKS outage all throw here (propagated as mine-but-invalid-stop).
    let payload: Record<string, unknown>;
    try {
      const verified = await this.jwks.verify(assertion, trust.jwksUri);
      payload = verified.payload;
      trace.setJoseHeader(verified.protectedHeader);
      trace.pass('jwks_signature', {
        expected: trust.jwksUri,
        received: 'signature verified',
        detail: 'signature + alg + time window verified',
      });
    } catch (err) {
      const reasonCode = mapJwksErrorToReason(err);
      trace.fail('jwks_signature', {
        expected: trust.jwksUri,
        received: 'verification failed',
        detail: (err as Error).message,
      });
      this.failTraced(reasonCode, (err as Error).message, trust, trace);
    }
    const claims = payload! as unknown as WifValidatedClaims;
    trace.setDecodedClaims(payload!);

    // Step 2 - issuer / subject / audience / tenant must match the trust. On a
    // PASS, received == the matched value (not omitted) so the diagnostics
    // table shows "expected: X · received: X" instead of "expected: X · -".
    if (claims.iss !== trust.expectedIssuer) {
      trace.fail('issuer_match', { expected: trust.expectedIssuer, received: String(claims.iss ?? '') });
      this.failTraced('wif_issuer_mismatch', 'issuer mismatch', trust, trace);
    }
    trace.pass('issuer_match', { expected: trust.expectedIssuer, received: String(claims.iss ?? '') });
    if (claims.sub !== trust.expectedSubject) {
      trace.fail('subject_match', { expected: trust.expectedSubject, received: String(claims.sub ?? '') });
      this.failTraced('wif_subject_mismatch', 'subject mismatch', trust, trace);
    }
    trace.pass('subject_match', { expected: trust.expectedSubject, received: String(claims.sub ?? '') });
    if (!this.audienceMatches(claims.aud, trust.expectedAudience)) {
      trace.fail('audience_match', {
        expected: trust.expectedAudience,
        received: Array.isArray(claims.aud) ? claims.aud.join(',') : String(claims.aud ?? ''),
      });
      this.failTraced('wif_audience_mismatch', 'audience mismatch', trust, trace);
    }
    trace.pass('audience_match', {
      expected: trust.expectedAudience,
      received: Array.isArray(claims.aud) ? claims.aud.join(',') : String(claims.aud ?? ''),
    });
    // Cross-tenant isolation: when a tenant id is configured, the assertion's
    // `tid` MUST match it exactly.
    if (claims.tid !== trust.allowedTenantId) {
      trace.fail('tenant_match', { expected: trust.allowedTenantId, received: String(claims.tid ?? '') });
      this.failTraced('wif_tenant_mismatch', 'tenant mismatch', trust, trace);
    }
    trace.pass('tenant_match', { expected: trust.allowedTenantId, received: String(claims.tid ?? '') });

    // Step 3 - roles are ADVISORY by default. A missing required role is
    // logged but does NOT block token issuance, so a provisioning flow always
    // continues to the next step even if the identity provider has not yet
    // assigned the app role (a common first-run ordering problem). Only a
    // trust that explicitly opts into `roleEnforcement: 'enforce'` rejects on
    // a missing role. `off` (default) and `shadow` allow + log.
    const required = trust.requiredRoles ?? [];
    if (required.length > 0) {
      const present = Array.isArray(claims.roles) ? claims.roles : [];
      const missing = required.filter((r) => !present.includes(r));
      if (missing.length > 0) {
        if (trust.roleEnforcement === 'enforce') {
          trace.fail('required_roles', { expected: required.join(','), received: present.join(',') });
          this.failTraced('wif_missing_role', `missing required role(s): ${missing.join(', ')}`, trust, trace);
        } else {
          trace.skip('required_roles', {
            expected: required.join(','),
            received: present.join(','),
            detail: 'advisory (roleEnforcement not enforce)',
          });
          this.logger.warn(
            LogCategory.AUTH,
            'WIF assertion missing required role(s) - advisory, allowed (set roleEnforcement:enforce to reject)',
            {
              missing,
              issuer: trust.expectedIssuer,
              roleEnforcement: trust.roleEnforcement ?? 'off',
            },
          );
        }
      } else {
        trace.pass('required_roles', { expected: required.join(','), received: present.join(',') });
      }
    }

    return { claims, trace: trace.accept().build() };
  }

  /** Accept a string `aud` equal to the expected value, or an array containing it. */
  private audienceMatches(aud: string | string[] | undefined, expected: string): boolean {
    if (Array.isArray(aud)) return aud.includes(expected);
    return aud === expected;
  }

  /**
   * WI-D7 - server-evaluated dry-run for the assertion debugger. Runs the SAME
   * real checks as `validate()` (real JWKS fetch + signature + claim matching)
   * but NEVER mints a token and NEVER throws: it always returns the decision
   * outcome + the `AuthDecisionTrace` (the per-check expected-vs-received
   * table), so the operator can paste an assertion and see exactly which check
   * fails before wiring up the IdP. This is the "will this exact assertion
   * work, and if not which claim is wrong" answer the design (Part 11.2) calls
   * for. The trace's decoded claims + jose header are already non-secret.
   */
  async debug(
    assertion: string,
    trust: WifTrust,
  ): Promise<{ outcome: 'accept' | 'reject'; reasonCode?: string; trace: AuthDecisionTrace }> {
    try {
      // Reuse the REAL validation trace (full per-claim checks, each with
      // expected + received) instead of synthesizing a lossy 2-check summary.
      const { trace } = await this.validateWithTrace(assertion, trust);
      return { outcome: 'accept', trace };
    } catch (err) {
      if (err instanceof WifAssertionInvalidError && err.trace) {
        return { outcome: 'reject', reasonCode: err.reasonCode, trace: err.trace };
      }
      // Any non-WIF error (shouldn't happen - validate wraps everything) still
      // yields a reject trace so the debugger never surfaces a raw stack.
      const fallback = new AuthDecisionTraceBuilder('token-mint', 'wif')
        .fail('jwks_signature', { detail: (err as Error).message })
        .reject('assertion_signature_invalid')
        .build();
      return { outcome: 'reject', reasonCode: 'assertion_signature_invalid', trace: fallback };
    }
  }

  private failTraced(
    reasonCode: string,
    reason: string,
    trust: WifTrust,
    trace: AuthDecisionTraceBuilder,
  ): never {
    this.logger.warn(LogCategory.AUTH, 'WIF assertion rejected', {
      reason,
      reasonCode,
      issuer: trust.expectedIssuer,
    });
    throw new WifAssertionInvalidError(reason, reasonCode, trace.reject(reasonCode).build());
  }
}
