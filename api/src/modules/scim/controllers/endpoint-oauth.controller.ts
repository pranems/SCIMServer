import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
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

interface EndpointTokenRequest {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
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

    if (!body.client_id || !body.client_secret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret are required.',
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
      throw new HttpException(
        {
          error: 'invalid_client',
          error_description: 'Invalid per-endpoint client credentials.',
        },
        HttpStatus.UNAUTHORIZED,
      );
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
}
