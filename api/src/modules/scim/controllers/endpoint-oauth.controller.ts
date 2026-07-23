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
import * as bcrypt from 'bcrypt';
import { Public } from '../../auth/public.decorator';
import { OAuthService } from '../../../oauth/oauth.service';
import { resolveClientCredentials } from '../../../oauth/client-credential-location';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import {
  ASSERTION_TOKEN_PROVIDER,
  JWT_BEARER_ASSERTION_TYPE,
  type IAssertionTokenProvider,
} from './assertion-token-provider';
import { WifAssertionInvalidError } from '../../../oauth/wif-assertion-validator.service';
import { emitAuthDecisionEvent, type AuthDecisionTrace, type AuthCheck } from '../../../oauth/auth-decision-trace';
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
    private readonly oauthService: OAuthService,
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly logger: ScimLogger,
    @Optional() @Inject(ASSERTION_TOKEN_PROVIDER)
    private readonly assertionProvider: IAssertionTokenProvider | null = null,
    @Optional() @Inject(AuthDecisionRecordStore)
    private readonly decisionStore: AuthDecisionRecordStore | null = null,
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
    // RFC 6749 section 2.3.1 - accept client credentials from the
    // `Authorization: Basic` header (client_secret_basic) in addition to the
    // body (client_secret_post). Entra's newer provisioning experience sends
    // them in the header; body values still win when both are present.
    const resolved = resolveClientCredentials(
      { clientId: body.client_id, clientSecret: body.client_secret },
      authorization,
    );
    // Phase 1 - record WHERE the credentials came from for the auth trace:
    // the body (client_secret_post), the Authorization: Basic header
    // (client_secret_basic), or neither. Body wins when both are present.
    const bodyHadSecret = typeof body.client_secret === 'string' && body.client_secret.length > 0;
    const credentialLocation: 'client_secret_post' | 'client_secret_basic' | 'none' = bodyHadSecret
      ? 'client_secret_post'
      : authorization
        ? 'client_secret_basic'
        : 'none';
    body = { ...body, client_id: resolved.clientId, client_secret: resolved.clientSecret };

    if (body.grant_type !== 'client_credentials') {
      throw new HttpException(
        {
          error: 'unsupported_grant_type',
          error_description: 'Only the client_credentials grant type is supported.',
          reason_code: 'grant_type_unsupported',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // A3 - self-describing routing cascade. The request shape selects the
    // credential type with no prior binding (grant_type -> field presence).
    // client_assertion and client_secret are mutually exclusive.
    const hasAssertion = typeof body.client_assertion === 'string' && body.client_assertion.length > 0;
    const hasSecret = typeof body.client_secret === 'string' && body.client_secret.length > 0;

    if (hasAssertion && hasSecret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_assertion and client_secret are mutually exclusive.',
          reason_code: 'mutually_exclusive_credentials',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (hasAssertion) {
      return this.handleAssertion(endpointId, body);
    }

    return this.handleClientSecret(endpointId, body, credentialLocation);
  }

  /** A3 - WIF assertion route: dispatch to the assertion provider (Q6 binds it). */
  private async handleAssertion(endpointId: string, body: EndpointTokenRequest) {
    if (body.client_assertion_type !== JWT_BEARER_ASSERTION_TYPE) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: `Unsupported client_assertion_type. Expected "${JWT_BEARER_ASSERTION_TYPE}".`,
          reason_code: 'unsupported_assertion_type',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

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
      minted = await this.assertionProvider.mintFromAssertion(endpointId, body.client_assertion!);
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
    body: EndpointTokenRequest,
    credentialLocation: 'client_secret_post' | 'client_secret_basic' | 'none' = 'none',
  ) {
    if (!body.client_id || !body.client_secret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret (or a client_assertion) are required.',
          reason_code: 'missing_credentials',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const candidate = credentials.find(
      (c) => c.credentialType === 'oauth_client' && c.metadata?.clientId === body.client_id,
    );

    const secretValid =
      candidate != null && (await bcrypt.compare(body.client_secret, candidate.credentialHash));

    // Phase 1 - build the per-check trace for the oauth_client decision so the
    // diagnostics table shows real expected-vs-received (never the secret
    // value). `credential_location` answers "how did the client present its
    // secret" (basic vs post); `client_found` + `secret_match` answer why the
    // decision went the way it did.
    const oauthChecks: AuthCheck[] = [
      {
        id: 'grant_type',
        status: 'pass',
        expected: 'client_credentials',
        received: 'client_credentials',
      },
      {
        id: 'credential_location',
        status: credentialLocation === 'none' ? 'fail' : 'pass',
        expected: 'client_secret_basic | client_secret_post',
        received: credentialLocation,
      },
      {
        id: 'client_id_present',
        status: body.client_id ? 'pass' : 'fail',
        expected: 'present',
        received: body.client_id ? 'present' : 'absent',
      },
      {
        id: 'client_found',
        status: candidate != null ? 'pass' : 'fail',
        expected: '(a registered oauth_client for this endpoint)',
        received: candidate != null ? 'found' : 'not found',
      },
      {
        id: 'secret_match',
        status: secretValid ? 'pass' : 'fail',
        expected: '(the registered client secret)',
        // Never echo the secret; only whether the bcrypt compare matched.
        received: secretValid ? 'match' : 'mismatch',
      },
    ];

    if (!candidate || !secretValid) {
      this.logger.warn(LogCategory.OAUTH, 'Per-endpoint oauth_client authentication failed', {
        endpointId,
        clientId: body.client_id,
        credentialFound: candidate != null,
      });
      // WI-D4 - one canonical AUTH decision event (reject). The distinguishing
      // fact (credentialFound) stays in the diagnostic warn above; the decision
      // event carries only the merged (T3) reason code - but the per-check trace
      // still shows client_found vs secret_match so the operator sees the step.
      this.emitOauthClientDecision(endpointId, 'reject', {
        reasonCode: 'oauth_client_auth_failed',
        checks: oauthChecks,
      });
      throw this.invalidClient('oauth_client_auth_failed');
    }

    const token = await this.oauthService.generateEndpointAccessToken(
      endpointId,
      body.client_id,
      body.scope,
    );

    this.logger.info(LogCategory.OAUTH, 'Per-endpoint access token issued', {
      endpointId,
      clientId: body.client_id,
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
    emitAuthDecisionEvent(this.logger, trace, LogCategory.AUTH);
    this.decisionStore?.record(trace);
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
