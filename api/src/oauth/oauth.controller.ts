import { Body, Controller, Get, Headers, Post, HttpException, HttpStatus, Optional, Inject } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { OAuthService } from './oauth.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { resolveClientCredentials } from './client-credential-location';
import { AuthDecisionRecordStore } from './auth-decision-record.store';
import {
  emitAuthDecisionEvent,
  type AuthDecisionTrace,
  type AuthCheck,
} from './auth-decision-trace';
import { getCorrelationContext } from '../modules/logging/scim-logger.service';

export interface TokenRequest {
  grant_type: string;
  client_id: string;
  client_secret: string;
  scope?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

@Controller('oauth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly logger: ScimLogger,
    @Optional() @Inject(AuthDecisionRecordStore)
    private readonly decisionStore: AuthDecisionRecordStore | null = null,
  ) {}

  /**
   * WI-D4 + WI-D5 - emit ONE canonical AUTH decision event for the global
   * client-credentials token mint AND capture the short-TTL record, so a global
   * token failure is observable in the AUTH log + diagnostics store exactly like
   * the per-endpoint path. Plane `token-mint`, method `oauth_client`, no
   * endpointId (global). Never carries a secret value.
   */
  private emitDecision(
    outcome: 'accept' | 'reject',
    opts: { reasonCode?: string; checks?: AuthCheck[] } = {},
  ): void {
    const trace: AuthDecisionTrace = {
      plane: 'token-mint',
      method: 'oauth_client',
      outcome,
      correlationId: getCorrelationContext()?.requestId,
      checks: opts.checks ?? [],
    };
    if (opts.reasonCode) trace.reasonCode = opts.reasonCode;
    emitAuthDecisionEvent(this.logger, trace, LogCategory.AUTH);
    this.decisionStore?.record(trace);
  }

  @Public()
  @Get('test')
  testEndpoint() {
    return { message: 'OAuth controller is working!', timestamp: new Date().toISOString(), version: '1.1' };
  }

  @Public()
  @Post('token')
  async getToken(
    @Body() tokenRequest: TokenRequest,
    @Headers('authorization') authorization?: string,
  ): Promise<TokenResponse> {
    // RFC 6749 section 2.3.1 - accept client credentials from the
    // `Authorization: Basic` header (client_secret_basic) as well as the body
    // (client_secret_post). Entra's newer provisioning experience sends them in
    // the header; body values win when both are present.
    const resolved = resolveClientCredentials(
      { clientId: tokenRequest.client_id, clientSecret: tokenRequest.client_secret },
      authorization,
    );
    tokenRequest = {
      ...tokenRequest,
      client_id: resolved.clientId as string,
      client_secret: resolved.clientSecret as string,
    };

    this.logger.debug(LogCategory.OAUTH, 'OAuth token request received', {
      grantType: tokenRequest.grant_type,
      clientId: tokenRequest.client_id,
      scope: tokenRequest.scope,
    });
    this.logger.trace(LogCategory.OAUTH, 'OAuth token request full body', {
      body: tokenRequest as unknown as Record<string, unknown>,
    });

    // Validate grant_type (Microsoft Entra requires client_credentials)
    if (tokenRequest.grant_type !== 'client_credentials') {
      this.emitDecision('reject', {
        reasonCode: 'grant_type_unsupported',
        checks: [{ id: 'grant_type', status: 'fail', expected: 'client_credentials', received: String(tokenRequest.grant_type ?? '') }],
      });
      throw new HttpException(
        {
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials grant type is supported',
          reason_code: 'grant_type_unsupported',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate client credentials
    if (!tokenRequest.client_id || !tokenRequest.client_secret) {
      this.emitDecision('reject', {
        reasonCode: 'missing_credentials',
        checks: [
          { id: 'client_id_present', status: tokenRequest.client_id ? 'pass' : 'fail', expected: 'present', received: tokenRequest.client_id ? 'present' : 'absent' },
          { id: 'client_secret_present', status: tokenRequest.client_secret ? 'pass' : 'fail', expected: 'present', received: tokenRequest.client_secret ? 'present' : 'absent' },
        ],
      });
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret are required',
          reason_code: 'missing_credentials',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const token = await this.oauthService.generateAccessToken(
        tokenRequest.client_id,
        tokenRequest.client_secret,
        tokenRequest.scope
      );

      this.logger.info(LogCategory.OAUTH, 'OAuth token generated successfully', {
        clientId: tokenRequest.client_id,
      });
      // WI-D4 - canonical AUTH decision (accept). secret_match never echoes the secret.
      this.emitDecision('accept', {
        checks: [
          { id: 'grant_type', status: 'pass', expected: 'client_credentials', received: 'client_credentials' },
          { id: 'client_id_present', status: 'pass', expected: 'present', received: 'present' },
          { id: 'secret_match', status: 'pass', expected: '(the registered client secret)', received: 'match' },
          { id: 'token_ttl', status: 'pass', expected: 'clamped to policy', received: `${token.expiresIn}s` },
        ],
      });

      return {
        access_token: token.accessToken,
        token_type: 'Bearer',
        expires_in: token.expiresIn,
        scope: token.scope
      };
    } catch (error) {
      this.logger.warn(LogCategory.OAUTH, 'OAuth token generation failed', {
        clientId: tokenRequest.client_id,
        reason: error instanceof Error ? error.message : String(error),
      });
      // WI-D4 - canonical AUTH decision (reject). client-not-found and
      // secret-mismatch are deliberately merged on the wire (T3); the per-check
      // trace still records secret_match=mismatch for the operator.
      this.emitDecision('reject', {
        reasonCode: 'oauth_client_auth_failed',
        checks: [
          { id: 'grant_type', status: 'pass', expected: 'client_credentials', received: 'client_credentials' },
          { id: 'client_id_present', status: 'pass', expected: 'present', received: 'present' },
          { id: 'secret_match', status: 'fail', expected: '(the registered client secret)', received: 'mismatch' },
        ],
      });

      throw new HttpException(
        {
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
          reason_code: 'oauth_client_auth_failed',
        },
        HttpStatus.UNAUTHORIZED
      );
    }
  }
}