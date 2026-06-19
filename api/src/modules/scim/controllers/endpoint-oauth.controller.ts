import {
  Body,
  Controller,
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
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import {
  ASSERTION_TOKEN_PROVIDER,
  JWT_BEARER_ASSERTION_TYPE,
  type IAssertionTokenProvider,
} from './assertion-token-provider';

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
  ) {}

  @Public()
  @Post('token')
  async getToken(
    @Param('endpointId') endpointId: string,
    @Body() body: EndpointTokenRequest,
  ) {
    if (body.grant_type !== 'client_credentials') {
      throw new HttpException(
        {
          error: 'unsupported_grant_type',
          error_description: 'Only the client_credentials grant type is supported.',
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
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (hasAssertion) {
      return this.handleAssertion(endpointId, body);
    }

    return this.handleClientSecret(endpointId, body);
  }

  /** A3 - WIF assertion route: dispatch to the assertion provider (Q6 binds it). */
  private async handleAssertion(endpointId: string, body: EndpointTokenRequest) {
    if (body.client_assertion_type !== JWT_BEARER_ASSERTION_TYPE) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: `Unsupported client_assertion_type. Expected "${JWT_BEARER_ASSERTION_TYPE}".`,
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
      throw this.invalidClient();
    }

    let minted;
    try {
      minted = await this.assertionProvider.mintFromAssertion(endpointId, body.client_assertion!);
    } catch (err) {
      this.logger.warn(LogCategory.OAUTH, 'WIF assertion validation failed (mine-but-invalid-stop)', {
        endpointId,
        reason: (err as Error).message,
      });
      throw this.invalidClient();
    }

    if (!minted) {
      this.logger.warn(LogCategory.OAUTH, 'No WIF trust configured for endpoint (not-mine)', { endpointId });
      throw this.invalidClient();
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
  private async handleClientSecret(endpointId: string, body: EndpointTokenRequest) {
    if (!body.client_id || !body.client_secret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret (or a client_assertion) are required.',
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

    if (!candidate || !secretValid) {
      this.logger.warn(LogCategory.OAUTH, 'Per-endpoint oauth_client authentication failed', {
        endpointId,
        clientId: body.client_id,
        credentialFound: candidate != null,
      });
      throw this.invalidClient();
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

    return {
      access_token: token.accessToken,
      token_type: 'Bearer',
      expires_in: token.expiresIn,
      scope: token.scope,
    };
  }

  private invalidClient(): HttpException {
    return new HttpException(
      {
        error: 'invalid_client',
        error_description: 'Invalid per-endpoint client credentials.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
