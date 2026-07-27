import { Inject, Injectable } from '@nestjs/common';
import type { AccessToken } from '../../../oauth/oauth.service';
import { OAuthService } from '../../../oauth/oauth.service';
import {
  WifAssertionValidatorService,
  WifAssertionInvalidError,
  type WifTrust,
  type WifValidatedClaims,
} from '../../../oauth/wif-assertion-validator.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { computeShadowDecision } from '../../../oauth/wif-shadow-telemetry';
import {
  emitAndRecordAuthDecision,
  type AuthDecisionTrace,
} from '../../../oauth/auth-decision-trace';
import { AuthDecisionRecordStore } from '../../../oauth/auth-decision-record.store';
import { getCorrelationContext } from '../../logging/scim-logger.service';
import { isUnsafeObjectKey } from '../../../security/safe-object-key';
import type { IAssertionTokenProvider, AssertionMintRequest } from './assertion-token-provider';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { resolveEndpointEgressOverrides } from '../../endpoint/endpoint-config.interface';

/**
 * WifAssertionTokenProvider (Q6.4) - binds the A3 `IAssertionTokenProvider`
 * seam to the WIF validation + issuance pipeline.
 *
 * Three-outcome contract (architecture section 2.2):
 *  - No `wif` trust configured for the endpoint  -> `null` (not-mine-continue).
 *  - A `wif` trust exists but the assertion fails -> throws (mine-but-invalid-stop).
 *  - A `wif` trust exists and the assertion is valid -> mints and returns the
 *    endpoint's own short-lived token, scoped to the configured `scope`.
 *
 * WI-16 (multi-trust): an endpoint may hold SEVERAL `wif` trusts (one per IdP,
 * per CONNECTION_INFO_AND_ENTRA_SETUP.md section 5F). Every active `wif` row is
 * tried until one validates; if none does, the assertion is "mine-but-invalid"
 * and we fail closed (throw). This is the config-level half of the multi-IdP
 * design; the resource level is unchanged (all IdPs share one common pool).
 *
 * The minted token is the ISV's OWN token (the Entra assertion is presented once
 * here and never rides the SCIM calls). No secret is read or stored - the WIF
 * trust is all public values on the `wif` EndpointCredential.metadata.
 */
@Injectable()
export class WifAssertionTokenProvider implements IAssertionTokenProvider {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly validator: WifAssertionValidatorService,
    private readonly oauthService: OAuthService,
    private readonly logger: ScimLogger,
    private readonly decisionStore: AuthDecisionRecordStore,
    private readonly endpointService: EndpointService,
  ) {}

  /** WI-D4 + WI-D5: emit the canonical AUTH log event AND capture the record. */
  private recordAndEmit(trace: AuthDecisionTrace): void {
    emitAndRecordAuthDecision(this.logger, trace, this.decisionStore, LogCategory.AUTH);
  }

  async mintFromAssertion(
    endpointId: string,
    clientAssertion: string,
    request?: AssertionMintRequest,
  ): Promise<AccessToken | null> {
    const requestResource = request?.resource;
    const requestClientId = request?.clientId;
    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const wifCredentials = credentials.filter((c) => c.credentialType === 'wif');

    // Not-mine-continue: no WIF trust configured for this endpoint.
    if (wifCredentials.length === 0) {
      return null;
    }

    // Resolve the ENDPOINT-level runtime egress overrides (JWKS fetch timeout /
    // retries / backoff / cache max-age) once for this mint. Any field the
    // endpoint sets OVERRIDES the server-level default; unset fields fall
    // through to the server. A missing/unreadable endpoint is non-fatal - we
    // simply mint with the server defaults.
    const endpoint = await this.endpointService
      .getEndpoint(endpointId)
      .catch(() => undefined);
    const egressOverrides = resolveEndpointEgressOverrides(endpoint?.profile?.settings);

    // From here on the assertion is "mine": one of the configured WIF trusts
    // must accept it. WI-17 orders the trusts issuer-first - decode the
    // assertion's `iss` WITHOUT verifying it and try the trust whose
    // `expectedIssuer` matches FIRST, so the common multi-IdP case does exactly
    // one JWKS verification (O(1)) instead of N. The decoded `iss` only SELECTS
    // the order; the signature is still verified against that trust's JWKS, so
    // an attacker cannot gain anything by spoofing the unverified claim. WI-16
    // guarantees the fallback: if the issuer is undecodable or matches nothing,
    // every trust is tried in turn. A rejecting or misconfigured trust is a
    // non-match; if NONE accepts, we fail closed (throw) and NEVER fall through.
    const orderedTrusts = this.orderByAssertionIssuer(wifCredentials, clientAssertion);

    let lastError: unknown;
    const subTraces: AuthDecisionTrace[] = [];
    for (const wif of orderedTrusts) {
      let trust: WifTrust;
      try {
        trust = this.buildTrust(wif.metadata);
      } catch (err) {
        // A misconfigured trust row cannot match; remember the error so a
        // whole-endpoint failure still surfaces a reason, and try the next.
        lastError = err;
        continue;
      }

      let claims: WifValidatedClaims;
      let validatorTrace: AuthDecisionTrace;
      try {
        const result = await this.validator.validateWithTrace(clientAssertion, trust, egressOverrides, requestResource);
        claims = result.claims;
        validatorTrace = result.trace;
      } catch (err) {
        lastError = err;
        // WI-D3 - collect each rejected trust's sub-trace (tagged with which
        // trust) so a multi-trust failure can explain why EACH one was rejected.
        if (err instanceof WifAssertionInvalidError && err.trace) {
          subTraces.push({ ...err.trace, selectedTrustId: wif.id });
        }
        continue;
      }

      // W3.7 (guide 13.1) - bind the REQUEST's client_id to the trust. The
      // SyncFabric RFC 7523 profile sends the ISV-issued target client id in
      // the form; when this trust pins one, a different value is a rejection,
      // not a silently-ignored field (we advertise `client_id_binding:
      // target-client-id` in the endpoint's RFC 8414 metadata). Backward
      // compatible in both directions: a trust WITHOUT a targetClientId has
      // nothing to bind against, and a request that sends NO client_id is
      // unaffected (only the assertion authenticates it).
      if (
        trust.targetClientId &&
        typeof requestClientId === 'string' &&
        requestClientId.length > 0 &&
        requestClientId !== trust.targetClientId
      ) {
        const mismatchTrace: AuthDecisionTrace = {
          ...validatorTrace,
          outcome: 'reject',
          reasonCode: 'wif_client_id_mismatch',
          correlationId: getCorrelationContext()?.requestId,
          endpointId,
          selectedTrustId: wif.id,
          checks: [
            ...validatorTrace.checks,
            {
              id: 'target_client_id_match',
              status: 'fail',
              expected: trust.targetClientId,
              received: requestClientId,
            },
          ],
        };
        this.logger.warn(LogCategory.AUTH, 'WIF assertion rejected: request client_id does not match the trust', {
          endpointId,
          credentialId: wif.id,
        });
        this.recordAndEmit(mismatchTrace);
        throw new WifAssertionInvalidError(
          'The request client_id does not match this trust.',
          'wif_client_id_mismatch',
          mismatchTrace,
        );
      }

      // W3.2 - the issued token identifies the OAuth CLIENT, not the federated
      // assertion subject. Use the trust's explicit `targetClientId` when the
      // operator configured one, otherwise the stable per-endpoint identity
      // (the endpointId, which is also the default `oauth_client` client_id).
      // The assertion subject rides `sourceSubject` -> the distinct `src_sub`
      // claim for attribution only, so the two identities stay separate.
      const issuedClientId = trust.targetClientId ?? endpointId;
      const token = await this.oauthService.generateEndpointAccessToken(
        endpointId,
        issuedClientId,
        undefined,
        {
          ttlSec: trust.issuedTokenTtlSec,
          trustedScope: trust.scope,
          // WI-17 - stamp the winning trust's issuer for source attribution.
          sourceIssuer: trust.expectedIssuer,
          // W3.2 - preserve the federated assertion subject as a distinct claim.
          sourceSubject: String(claims.sub),
          // W3.6 (guide 13.5) - the issued token must never outlive the
          // assertion that authorized it.
          assertionExpiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
        },
      );

      // A4 - shadow authorization telemetry. Compute the future role -> scope gate
      // WITHOUT enforcing it (roleEnforcement is `off` in A4), so an operator can
      // see in telemetry whether turning enforcement on would reject/narrow this
      // live customer BEFORE flipping it. This NEVER changes what was minted above.
      this.emitShadowTelemetry(endpointId, claims, trust, token);

      this.logger.info(LogCategory.AUTH, 'WIF assertion accepted; endpoint token minted', {
        endpointId,
        subject: trust.expectedSubject,
        scope: token.scope,
        credentialId: wif.id,
        sourceIssuer: trust.expectedIssuer,
      });

      // WI-D4 - one canonical AUTH decision event for this accepted attempt.
      // Phase 1: record the validator's FULL trace (every claim check with
      // expected + received) enriched with the request context, instead of a
      // lossy 2-check summary, so the diagnostics table shows the real per-claim
      // expected-vs-received on the accept path too.
      const acceptTrace: AuthDecisionTrace = {
        ...validatorTrace,
        correlationId: getCorrelationContext()?.requestId,
        endpointId,
        selectedTrustId: wif.id,
      };
      this.recordAndEmit(acceptTrace);

      return token;
    }

    // Mine-but-invalid-stop: the assertion matched no configured WIF trust.
    // WI-D3: with a SINGLE trust, rethrow its specific reason (e.g.
    // wif_audience_mismatch). With MULTIPLE trusts, none accepted, so the
    // aggregate reason is wif_no_trust_accepted, carrying each trust's
    // sub-trace so the operator can see why every one was rejected.
    // WI-D4: emit one canonical AUTH decision event for the rejected attempt.
    const correlationId = getCorrelationContext()?.requestId;
    if (orderedTrusts.length > 1) {
      const aggregateTrace: AuthDecisionTrace = {
        plane: 'token-mint',
        method: 'wif',
        outcome: 'reject',
        reasonCode: 'wif_no_trust_accepted',
        endpointId,
        correlationId,
        checks: [],
        subTraces,
      };
      this.recordAndEmit(aggregateTrace);
      throw new WifAssertionInvalidError(
        'No configured WIF trust accepted the assertion.',
        'wif_no_trust_accepted',
        aggregateTrace,
      );
    }
    if (lastError instanceof WifAssertionInvalidError) {
      // The validator builds the trace without endpoint/correlation context;
      // enrich it here so the WI-D5 store can scope + correlate it.
      const rejectTrace: AuthDecisionTrace = lastError.trace
        ? { ...lastError.trace, endpointId, correlationId }
        : {
            plane: 'token-mint',
            method: 'wif',
            outcome: 'reject',
            reasonCode: lastError.reasonCode,
            endpointId,
            correlationId,
            checks: [],
          };
      this.recordAndEmit(rejectTrace);
      throw lastError;
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new WifAssertionInvalidError(
      'No configured WIF trust accepted the assertion.',
      'wif_no_trust_accepted',
    );
  }

  /**
   * WI-17 - order the WIF trusts so the one whose `expectedIssuer` matches the
   * assertion's (UNVERIFIED) `iss` claim is tried first. Selection only; the
   * signature is still verified against the chosen trust's JWKS. If the `iss`
   * cannot be decoded (non-JWT string, malformed segment) or matches no trust,
   * the original order is preserved and every trust is tried (WI-16 fallback).
   */
  private orderByAssertionIssuer<T extends { metadata: Record<string, unknown> | null }>(
    trusts: T[],
    assertion: string,
  ): T[] {
    if (trusts.length <= 1) {
      return trusts;
    }
    const iss = this.decodeUnverifiedIssuer(assertion);
    if (!iss) {
      return trusts;
    }
    const matchIndex = trusts.findIndex((t) => (t.metadata ?? {}).expectedIssuer === iss);
    if (matchIndex <= 0) {
      // -1 (no match) or 0 (already first) -> nothing to reorder.
      return trusts;
    }
    const reordered = [...trusts];
    const [match] = reordered.splice(matchIndex, 1);
    reordered.unshift(match);
    return reordered;
  }

  /**
   * Decode the `iss` claim from a JWT WITHOUT verifying the signature. Used
   * ONLY to pick which trust to try first (WI-17); it is never a trust
   * decision. Returns null for any non-JWT / malformed / iss-less input.
   */
  private decodeUnverifiedIssuer(assertion: string): string | null {
    try {
      const segments = assertion.split('.');
      if (segments.length < 2) {
        return null;
      }
      const payloadJson = Buffer.from(segments[1], 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadJson) as { iss?: unknown };
      return typeof payload.iss === 'string' && payload.iss.length > 0 ? payload.iss : null;
    } catch {
      return null;
    }
  }

  /**
   * A4 - emit the "would-have-rejected" shadow decision as a log line. Inert:
   * the token has already been minted with the configured scope; this only
   * records what a future `roleEnforcement` flip would have done.
   */
  private emitShadowTelemetry(
    endpointId: string,
    claims: { roles?: unknown },
    trust: WifTrust,
    token: AccessToken,
  ): void {
    const roles = Array.isArray(claims.roles)
      ? (claims.roles as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];
    const decision = computeShadowDecision({
      roles,
      roleScopeMap: trust.roleScopeMap,
      grantedScopes: trust.grantedScopes,
      configuredScope: token.scope,
      identityModel: trust.identityModel,
    });
    this.logger.info(LogCategory.AUTH, 'WIF shadow authorization decision (not enforced)', {
      endpointId,
      identityModel: decision.identityModel,
      roleEnforcement: trust.roleEnforcement ?? 'off',
      wouldReject: decision.wouldReject,
      reason: decision.reason,
      wouldGrantScopes: decision.wouldGrantScopes,
      narrows: decision.narrows,
      enforced: decision.enforced,
    });
  }

  /**
   * Build the validated `WifTrust` from the persisted `wif` credential
   * metadata. A `wif` credential whose metadata is missing a required public
   * trust field is misconfigured - fail closed (throw), never silently accept.
   */
  private buildTrust(metadata: Record<string, unknown> | null): WifTrust {
    const m = metadata ?? {};
    const requireString = (key: string): string => {
      const value = m[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new WifAssertionInvalidError(`WIF trust metadata is missing required field "${key}".`);
      }
      return value;
    };

    return {
      expectedIssuer: requireString('expectedIssuer'),
      expectedSubject: requireString('expectedSubject'),
      expectedAudience: requireString('expectedAudience'),
      jwksUri: requireString('jwksUri'),
      allowedTenantId: requireString('allowedTenantId'),
      // W3.2 - optional OAuth client id the issued token is minted as (never
      // the assertion subject). Absent -> the mint uses the endpointId.
      targetClientId:
        typeof m.targetClientId === 'string' && m.targetClientId.length > 0
          ? m.targetClientId
          : undefined,
      requiredRoles: Array.isArray(m.requiredRoles)
        ? (m.requiredRoles as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined,
      expectedResource: typeof m.expectedResource === 'string' ? m.expectedResource : undefined,
      // W3.4 - RFC 8707 resource policy. Default `ignore` (legacy).
      resourceMode:
        m.resourceMode === 'optionalExact' || m.resourceMode === 'requiredExact'
          ? m.resourceMode
          : 'ignore',
      scope: typeof m.scope === 'string' ? m.scope : undefined,
      issuedTokenTtlSec: typeof m.issuedTokenTtlSec === 'number' ? m.issuedTokenTtlSec : undefined,
      // A4 seams - read inertly (computed in shadow telemetry, never enforced).
      identityModel: m.identityModel === 'first-party' ? 'first-party' : 'per-app',
      roleScopeMap: this.readRoleScopeMap(m.roleScopeMap),
      grantedScopes: Array.isArray(m.grantedScopes)
        ? (m.grantedScopes as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined,
      roleEnforcement:
        m.roleEnforcement === 'shadow' || m.roleEnforcement === 'enforce' ? m.roleEnforcement : 'off',
    };
  }

  /** Read a `roleScopeMap` (role -> string[] scopes) defensively from metadata. */
  private readRoleScopeMap(raw: unknown): Record<string, string[]> | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const out: Record<string, string[]> = {};
    for (const [role, scopes] of Object.entries(raw as Record<string, unknown>)) {
      // CWE-1321: never write a prototype-polluting key from user input.
      if (isUnsafeObjectKey(role)) continue;
      if (Array.isArray(scopes)) {
        out[role] = scopes.filter((s): s is string => typeof s === 'string');
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
}
