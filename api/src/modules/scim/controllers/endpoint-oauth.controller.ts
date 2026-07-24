import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Post,
} from '@nestjs/common';
import { Public } from '../../auth/public.decorator';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { resolveEndpointAuthEnablement, type EndpointConfig } from '../../endpoint/endpoint-config.interface';
import {
  ASSERTION_TOKEN_PROVIDER,
  type IAssertionTokenProvider,
} from './assertion-token-provider';
import { ClientSecretTokenProvider } from './client-secret-token-provider';
import { parseEndpointTokenRequest } from './endpoint-token-request-parser';
import type { ParsedEndpointTokenRequest } from './endpoint-token-request.types';
import { WifAssertionInvalidError } from '../../../oauth/wif-assertion-validator.service';
import { emitAndRecordAuthDecision, type AuthDecisionTrace, type AuthCheck } from '../../../oauth/auth-decision-trace';
import { AuthDecisionRecordStore } from '../../../oauth/auth-decision-record.store';
import { getCorrelationContext } from '../../logging/scim-logger.service';

interface EndpointTokenRequest {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  /** A3 - WIF client assertion (RFC 7523). Mutually exclusive with client_secret. */
  client_assertion?: string;
  client_assertion_type?: string;
  scope?: string;
}

/**
 * EndpointOAuthController (Q1) - the per-endpoint token issuer.
 *
 * `POST /scim/endpoints/:endpointId/oauth/token` mints an access token scoped
 * to a single endpoint. The caller authenticates with a per-endpoint
 * `oauth_client` credential (client_id + client_secret created via the admin
 * credential API). The issued token carries an `endpoint_id` claim, so the
 * resource guard authorizes it ONLY for that endpoint's routes - a token
 * minted for endpoint A cannot be used against endpoint B.
 *
 * Public route (no bearer required to obtain a token); the credentials in the
 * body are the authentication. The shared-URL form-urlencoded routing cascade
 * is a separate concern handled in A3.
 */
@Controller('endpoints/:endpointId/oauth')
export class EndpointOAuthController {
  constructor(
    private readonly clientSecretProvider: ClientSecretTokenProvider,
    private readonly logger: ScimLogger,
    @Optional() @Inject(ASSERTION_TOKEN_PROVIDER)
    private readonly assertionProvider: IAssertionTokenProvider | null = null,
    @Optional() @Inject(AuthDecisionRecordStore)
    private readonly decisionStore: AuthDecisionRecordStore | null = null,
    @Optional() @Inject(EndpointService)
    private readonly endpointService: EndpointService | null = null,
  ) {}

  // RFC 6749 section 5.1 (+ RFC 8693 section 2.2.1 for the WIF/token-exchange
  // route) - a successful token response MUST be HTTP 200 with
  // `Cache-Control: no-store` + `Pragma: no-cache`. One decorator set covers
  // BOTH sub-routes (client_secret and client_assertion) because both return
  // through this handler. Thrown HttpExceptions keep their 400/401 status
  // (section 5.2) and bypass the @Header decorators, as intended for errors.
  @Public()
  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async getToken(
    @Param('endpointId') endpointId: string,
    @Body() body: EndpointTokenRequest,
    @Headers('authorization') authorization?: string,
  ) {
    // W2.2 - the strict parser produces a discriminated union (client_assertion
    // / client_secret / invalid) from the raw form + Authorization header. The
    // controller no longer re-derives the method by hand: it just routes the
    // well-formed variants and shapes the error response for the invalid one.
    const parsed = parseEndpointTokenRequest(body, authorization);

    if (parsed.kind === 'invalid') {
      throw new HttpException(
        {
          error: parsed.error,
          error_description: parsed.errorDescription,
          reason_code: parsed.reasonCode,
        },
        parsed.status,
      );
    }

    if (parsed.kind === 'client_assertion') {
      return this.handleAssertion(endpointId, parsed);
    }

    return this.handleClientSecret(endpointId, parsed);
  }

  /** A3 - WIF assertion route: dispatch to the assertion provider (Q6 binds it). */
  private async handleAssertion(endpointId: string, parsed: Extract<ParsedEndpointTokenRequest, { kind: 'client_assertion' }>) {
    // Three-outcome acceptor (architecture section 2.2):
    //  - provider returns a token  -> accept
    //  - provider returns null     -> not-mine-continue (no other route here) -> invalid_client
    //  - provider throws           -> mine-but-invalid-stop -> invalid_client
    //  - no provider wired (A3)    -> invalid_client until Q6 binds the validator
    if (!this.assertionProvider) {
      this.logger.warn(LogCategory.OAUTH, 'client_assertion presented but no WIF provider is configured', { endpointId });
      throw this.invalidClient('wif_no_trust_configured');
    }

    let minted;
    try {
      minted = await this.assertionProvider.mintFromAssertion(endpointId, parsed.assertion);
    } catch (err) {
      const reasonCode =
        err instanceof WifAssertionInvalidError && err.reasonCode
          ? err.reasonCode
          : 'wif_no_trust_accepted';
      this.logger.warn(LogCategory.OAUTH, 'WIF assertion validation failed (mine-but-invalid-stop)', {
        endpointId,
        reason: (err as Error).message,
        reasonCode,
      });
      throw this.invalidClient(reasonCode);
    }

    if (!minted) {
      this.logger.warn(LogCategory.OAUTH, 'No WIF trust configured for endpoint (not-mine)', { endpointId });
      throw this.invalidClient('wif_no_trust_configured');
    }

    this.logger.info(LogCategory.OAUTH, 'Per-endpoint token issued via WIF assertion', { endpointId });
    return {
      access_token: minted.accessToken,
      token_type: 'Bearer',
      expires_in: minted.expiresIn,
      scope: minted.scope,
    };
  }

  /** Q1 - oauth_client (client_id + client_secret) route. */
  private async handleClientSecret(
    endpointId: string,
    parsed: Extract<ParsedEndpointTokenRequest, { kind: 'client_secret' }>,
  ) {
    const clientId = parsed.clientId;

    // W2.3 - the credential lookup + bcrypt verification + mint live in the
    // ClientSecretTokenProvider. The controller owns only the cross-cutting
    // response shaping, the W2.5 shadow read, and the decision emission.
    const result = await this.clientSecretProvider.mintFromClientSecret(endpointId, {
      clientId,
      clientSecret: parsed.clientSecret,
      credentialLocation: parsed.credentialLocation,
      ...(parsed.scope !== undefined ? { scope: parsed.scope } : {}),
    });

    if (result.outcome === 'reject') {
      this.logger.warn(LogCategory.OAUTH, 'Per-endpoint oauth_client authentication failed', {
        endpointId,
        clientId,
      });
      // WI-D4 - one canonical AUTH decision event (reject); the per-check trace
      // still shows client_found vs secret_match so the operator sees the step.
      this.emitOauthClientDecision(endpointId, 'reject', {
        reasonCode: result.reasonCode,
        checks: result.checks,
      });
      throw this.invalidClient(result.reasonCode);
    }

    const token = result.token;
    const oauthChecks = result.checks;

    // W2.5 (shadow) - the mint plane CONSULTS the same per-method enablement
    // source as the resource guard + create-gate, fixing the design 7.1 mint-vs-
    // resource asymmetry. It runs in SHADOW: when the `oauth_client` method is
    // disabled for this endpoint (the disabled-with-credential state) it records
    // a fail check + warns, but STILL mints - so the future enforcement flip can
    // be validated against real traffic first. Fails OPEN (never blocks a mint).
    if (this.endpointService) {
      try {
        const endpoint = await this.endpointService.getEndpoint(endpointId);
        const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
        const enabled = resolveEndpointAuthEnablement(
          config,
          endpoint.profile?.authentication?.methods,
        ).oauthClientCredentials;
        if (!enabled) {
          this.logger.warn(
            LogCategory.OAUTH,
            'W2.5 shadow: oauth_client method is disabled for this endpoint - minting anyway (shadow mode, not yet enforced)',
            { endpointId, clientId },
          );
        }
        oauthChecks.push({
          id: 'method_enabled_shadow',
          status: enabled ? 'pass' : 'fail',
          expected: 'oauth_client method enabled for this endpoint',
          received: enabled ? 'enabled' : 'disabled (shadow - not enforced)',
        });
      } catch {
        // Shadow read must never block a mint - swallow any lookup error.
      }
    }

    this.logger.info(LogCategory.OAUTH, 'Per-endpoint access token issued', {
      endpointId,
      clientId,
    });
    oauthChecks.push({
      id: 'token_ttl',
      status: 'pass',
      expected: 'clamped to endpoint policy',
      received: `${token.expiresIn}s`,
    });
    this.emitOauthClientDecision(endpointId, 'accept', { checks: oauthChecks });

    return {
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: token.expiresIn,
      scope: token.scope,
    };
  }

  /** WI-D4 + WI-D5 - emit one canonical AUTH decision event AND capture the record. */
  private emitOauthClientDecision(
    endpointId: string,
    outcome: 'accept' | 'reject',
    opts: { reasonCode?: string; checks?: AuthCheck[] } = {},
  ): void {
    const trace: AuthDecisionTrace = {
      plane: 'token-mint',
      method: 'oauth_client',
      outcome,
      endpointId,
      correlationId: getCorrelationContext()?.requestId,
      checks: opts.checks ?? [],
    };
    if (opts.reasonCode) trace.reasonCode = opts.reasonCode;
    emitAndRecordAuthDecision(this.logger, trace, this.decisionStore, LogCategory.AUTH);
  }

  private invalidClient(reasonCode?: string): HttpException {
    // WI-D3: when a catalog reason_code is present, omit a hardcoded
    // error_description so the WI-D1 filter fills the tier-safe description from
    // the WI-D2 catalog (T3 merges, T4 generalizes). Without a reason code, keep
    // the generic fallback.
    return new HttpException(
      reasonCode
        ? { error: 'invalid_client', reason_code: reasonCode }
        : { error: 'invalid_client', error_description: 'Invalid per-endpoint client credentials.' },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
