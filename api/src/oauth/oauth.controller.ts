import { Body, Controller, Get, Post, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { OAuthService } from './oauth.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';

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
  ) {}

  @Public()
  @Get('test')
  testEndpoint() {
    return { message: 'OAuth controller is working!', timestamp: new Date().toISOString(), version: '1.1' };
  }

  @Public()
  @Post('token')
  async getToken(@Body() tokenRequest: TokenRequest): Promise<TokenResponse> {
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
      throw new HttpException(
        {
          error: 'unsupported_grant_type',
          error_description: 'Only client_credentials grant type is supported'
        },
        HttpStatus.BAD_REQUEST
      );
    }

    // Validate client credentials
    if (!tokenRequest.client_id || !tokenRequest.client_secret) {
      throw new HttpException(
        {
          error: 'invalid_request',
          error_description: 'client_id and client_secret are required'
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

      throw new HttpException(
        {
          error: 'invalid_client',
          error_description: 'Invalid client credentials'
        },
        HttpStatus.UNAUTHORIZED
      );
    }
  }
}