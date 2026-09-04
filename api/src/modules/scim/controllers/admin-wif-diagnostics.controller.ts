/**
 * AdminWifDiagnosticsController - config-time WIF diagnostics.
 *
 * D1 step 1: split out of AdminCredentialController, which had grown to ~1,265
 * lines across 11 routes and 8 injected dependencies. These three routes share
 * a responsibility the rest of that controller does not have - they help an
 * operator get a federated trust CORRECT before it is saved, and none of them
 * mints, stores or returns a secret.
 *
 * The split removes ONE dependency from the credential controller
 * (`WifAssertionValidatorService`, used only by the assertion debugger).
 * `WifDiscoveryResolverService` is deliberately still injected in BOTH: the
 * create path uses it for the `verify: true` pre-save check, so it is shared
 * rather than moved. A first draft of this comment claimed both moved, which
 * the compiler immediately disproved.
 *
 * The `@Controller` prefix is deliberately identical to AdminCredentialController's,
 * so every URL is unchanged - this is a pure internal reorganisation with no
 * API surface change.
 *
 * Routes:
 *   POST /admin/endpoints/:endpointId/wif/resolve          - discover issuer + JWKS from an IdP
 *   POST /admin/endpoints/:endpointId/wif/verify           - reachability/liveness checklist
 *   POST /admin/endpoints/:endpointId/wif/debug-assertion  - dry-run an assertion vs every trust
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import {
  WifDiscoveryResolverService,
  type WifResolveRequest,
  type WifResolveResult,
  type WifVerifyRequest,
  type WifVerifyResult,
} from '../../../oauth/wif-discovery-resolver.service';
import {
  WifAssertionValidatorService,
  type WifTrust,
} from '../../../oauth/wif-assertion-validator.service';
import type {
  WifDebugAssertionRequest,
  WifDebugAssertionResponse,
  WifDebugTrustResult,
} from '../../../shared/types/wif-debug.types';
import {
  getConfigBoolean,
  ENDPOINT_CONFIG_FLAGS,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import { ScimLogger, getCorrelationContext } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { emitAuthAdminEvent } from '../../../oauth/auth-admin-event';

@Controller('admin/endpoints')
export class AdminWifDiagnosticsController {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly endpointService: EndpointService,
    private readonly logger: ScimLogger,
    private readonly wifResolver: WifDiscoveryResolverService,
    private readonly wifValidator: WifAssertionValidatorService,
  ) {}

  /**
   * POST /admin/endpoints/:endpointId/wif/resolve  (WI-14)
   *
   * Config-time WIF discovery resolver. Reads the SOURCE IdP's OIDC discovery
   * document and returns the signing-trust fields (`expectedIssuer` +
   * `jwksUri`) plus a proposed `expectedAudience` default (the endpointId), so
   * the admin fills five previously-required fields from one or two inputs.
   * Nothing is persisted here - the returned values are handed to the normal
   * `wif` create call. Gated by the JWKS host allowlist (SSRF).
   */
  @Post(':endpointId/wif/resolve')
  async resolveWifDiscovery(
    @Param('endpointId') endpointId: string,
    @Body() body: WifResolveRequest,
  ): Promise<WifResolveResult> {
    await this.requireWifEnabled(endpointId);
    return this.wifResolver.resolve(endpointId, body ?? {});
  }

  /**
   * POST /admin/endpoints/:endpointId/wif/verify  (item 6)
   *
   * Config-time reachability + liveness check for a WIF trust's issuer + JWKS
   * URI. Fetches (SSRF-gated) the issuer's OIDC discovery document and the JWKS
   * URI, and reports a per-check checklist: valid https format, host on the
   * allowlist, reachable, and that the JWKS actually serves a non-empty key set
   * - so the operator confirms the URLs work BEFORE saving the trust instead of
   * hitting a runtime surprise. Non-throwing: a failed check is reported, not an
   * error status. Same allowlist gate as the runtime JWKS fetch.
   */
  @Post(':endpointId/wif/verify')
  @HttpCode(200)
  async verifyWifTrust(
    @Param('endpointId') endpointId: string,
    @Body() body: WifVerifyRequest & { credentialId?: string },
  ): Promise<WifVerifyResult> {
    await this.requireWifEnabled(endpointId);
    const result = await this.wifResolver.verifyTrust(body ?? {});
    // V7 - when the verify targets a SAVED trust (credentialId supplied) and it
    // passes, persist lastVerifiedAt onto that credential so the trust card
    // flips Unverified -> Verified. A verify with no credentialId stays a pure
    // dry-run (the add-form / ad-hoc case), unchanged.
    let verifiedAt: string | undefined;
    if (result.ok && typeof body?.credentialId === 'string' && body.credentialId.length > 0) {
      const credential = await this.credentialRepo.findById(body.credentialId);
      if (credential && credential.endpointId === endpointId && credential.credentialType === 'wif') {
        verifiedAt = new Date().toISOString();
        const nextMetadata: Record<string, unknown> = { ...(credential.metadata ?? {}), lastVerifiedAt: verifiedAt };
        await this.credentialRepo.updateMetadata(body.credentialId, nextMetadata);
      }
    }
    // Phase 4 - config-time auth audit event for a WIF trust verification.
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'wif_verify',
        outcome: result.ok ? 'success' : 'failure',
        endpointId,
        method: 'wif',
        credentialId: body?.credentialId,
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );
    return verifiedAt ? { ...result, lastVerifiedAt: verifiedAt } : result;
  }

  /**
   * POST /admin/endpoints/:endpointId/wif/debug-assertion  (WI-D7)
   *
   * Assertion debugger: decode a pasted `client_assertion` and dry-run it
   * against EVERY configured WIF trust for this endpoint using the exact same
   * server-side checks a real mint would run (real JWKS fetch + signature +
   * issuer/subject/audience/tenant/role matching), but WITHOUT minting a
   * token. Returns the per-check `AuthDecisionTrace` for each trust so the
   * operator sees precisely which claim is wrong before the IdP is wired up.
   * Admin-only, non-throwing on a bad assertion (a reject is a result, not a
   * 4xx). Same WIF-enabled gate as the other wif/* admin endpoints.
   */
  @Post(':endpointId/wif/debug-assertion')
  @HttpCode(200)
  async debugWifAssertion(
    @Param('endpointId') endpointId: string,
    @Body() body: WifDebugAssertionRequest,
  ): Promise<WifDebugAssertionResponse> {
    await this.requireWifEnabled(endpointId);

    const assertion = typeof body?.assertion === 'string' ? body.assertion.trim() : '';
    if (assertion.length === 0) {
      throw new BadRequestException('A non-empty "assertion" (client_assertion JWT) is required.');
    }

    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const wifCredentials = credentials.filter((c) => c.credentialType === 'wif');

    const results: WifDebugTrustResult[] = [];
    for (const wif of wifCredentials) {
      let trust: WifTrust;
      try {
        trust = this.buildDebugTrust(wif.metadata);
      } catch {
        // A misconfigured trust row cannot match; skip it in the debugger just
        // as the runtime does, but surface it as a reject so the operator sees
        // the endpoint has an unusable trust.
        results.push({
          expectedIssuer:
            typeof wif.metadata?.expectedIssuer === 'string' ? wif.metadata.expectedIssuer : '(unconfigured)',
          outcome: 'reject',
          reasonCode: 'wif_no_trust_configured',
          trace: {
            plane: 'token-mint',
            method: 'wif',
            outcome: 'reject',
            reasonCode: 'wif_no_trust_configured',
            checks: [],
          },
        });
        continue;
      }
      const result = await this.wifValidator.debug(assertion, trust);
      results.push({
        expectedIssuer: trust.expectedIssuer,
        outcome: result.outcome,
        reasonCode: result.reasonCode,
        trace: result.trace,
      });
    }

    const overallOutcome = results.some((r) => r.outcome === 'accept') ? 'accept' : 'reject';
    // Phase 4 - config-time auth audit event for a WIF assertion dry-run. This
    // is a DRY-RUN: it evaluates against every trust but never mints a token.
    const firstReject = results.find((r) => r.outcome === 'reject');
    emitAuthAdminEvent(
      this.logger,
      {
        action: 'wif_debug_assertion',
        outcome: overallOutcome === 'accept' ? 'success' : 'failure',
        endpointId,
        method: 'wif',
        dryRun: true,
        reasonCode: overallOutcome === 'accept' ? undefined : firstReject?.reasonCode,
        detail: `${wifCredentials.length} trust(s) evaluated`,
        correlationId: getCorrelationContext()?.requestId,
      },
      LogCategory.AUTH,
    );

    return {
      overallOutcome,
      results,
    };
  }

  /**
   * All three routes share one precondition: the endpoint must exist AND have
   * WIF enabled. It was copied verbatim into each route before the split; the
   * 404-then-403 ORDER is part of the contract (an unknown endpoint must not
   * report on its feature flags), so it stays in one place.
   */
  private async requireWifEnabled(endpointId: string): Promise<void> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED)) {
      throw new ForbiddenException(
        `WIF credentials are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}" to "True" in the endpoint config.`,
      );
    }
  }

  /** WI-D7 - defensively read a WifTrust from credential metadata for a dry-run. */
  private buildDebugTrust(metadata: Record<string, unknown> | null): WifTrust {
    const m = metadata ?? {};
    const requireString = (key: string): string => {
      const value = m[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`WIF trust metadata is missing required field "${key}".`);
      }
      return value;
    };
    return {
      expectedIssuer: requireString('expectedIssuer'),
      expectedSubject: requireString('expectedSubject'),
      expectedAudience: requireString('expectedAudience'),
      jwksUri: requireString('jwksUri'),
      allowedTenantId: requireString('allowedTenantId'),
      requiredRoles: Array.isArray(m.requiredRoles)
        ? (m.requiredRoles as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined,
      roleEnforcement:
        m.roleEnforcement === 'shadow' || m.roleEnforcement === 'enforce' ? m.roleEnforcement : 'off',
    };
  }
}
