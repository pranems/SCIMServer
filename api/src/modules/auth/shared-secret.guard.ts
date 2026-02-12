import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { SCIM_ERROR_SCHEMA } from '../scim/common/scim-constants';
import * as crypto from 'node:crypto';
import { OAuthService } from '../../oauth/oauth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';

interface AuthenticatedRequest extends Request {
  oauth?: Record<string, unknown>;
  authType?: 'oauth' | 'legacy';
}

@Injectable()
export class SharedSecretGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Inject(OAuthService) private readonly oauthService: OAuthService,
    private readonly reflector: Reflector,
    private readonly logger: ScimLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      this.logger.trace(LogCategory.AUTH, 'Skipping auth – route is public');
      return true;
    }
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuthenticatedRequest>();
    const response = httpContext.getResponse<Response>();

    const header = request.headers.authorization;

    // Retrieve shared secret from configuration/env.
    // If it's missing in production we fail fast (never prompt).
    // In non-production (dev/test) we auto-generate a secure ephemeral secret once per process
    // to avoid the app "asking" the operator to configure it manually.
    let expectedSecret = this.configService.get<string>('SCIM_SHARED_SECRET');

    if (!expectedSecret) {
      if (process.env.NODE_ENV === 'production') {
        // Fail fast with clear message – operator must configure the secret explicitly.
        this.logger.fatal(LogCategory.AUTH, 'SCIM_SHARED_SECRET is not configured. Set the environment variable or secret in your deployment.');
        this.reject(response, 'SCIM shared secret not configured.');
      } else {
        // Dev / test convenience: generate once and memoize in env so subsequent guard calls reuse it.
        const generated = crypto.randomBytes(32).toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
        process.env.SCIM_SHARED_SECRET = generated;
        expectedSecret = generated;
        this.logger.warn(LogCategory.AUTH, `Auto-generated ephemeral SCIM_SHARED_SECRET for ${process.env.NODE_ENV || 'development'}`, {
          hint: 'Set SCIM_SHARED_SECRET env var to suppress this warning',
        });
      }
    }

    if (!header || !header.startsWith('Bearer ')) {
      this.logger.warn(LogCategory.AUTH, 'Missing or malformed Authorization header');
      this.reject(response, 'Missing bearer token.');
    }

    const token = header?.slice(7) ?? '';

    // First, try OAuth 2.0 JWT token validation
    if (token !== expectedSecret) {
      try {
        this.logger.debug(LogCategory.AUTH, 'Attempting OAuth 2.0 token validation');
        const payload = await this.oauthService.validateAccessToken(token);

        // Add OAuth payload to request for later use
        request.oauth = payload;
        request.authType = 'oauth';

        this.logger.info(LogCategory.AUTH, 'OAuth 2.0 authentication successful', {
          clientId: payload.client_id,
        });
        return true;
      } catch (_oauthError) {
        this.logger.debug(LogCategory.AUTH, 'OAuth 2.0 validation failed, falling back to legacy token');
        // Fall through to legacy token check
      }
    }

    // Fall back to legacy bearer token validation
    if (token === expectedSecret) {
      this.logger.info(LogCategory.AUTH, 'Legacy bearer token authentication successful');
      request.authType = 'legacy';
      return true;
    }

    // Both OAuth and legacy validation failed
    this.logger.warn(LogCategory.AUTH, 'Authentication failed – both OAuth and legacy token invalid');
    this.reject(response, 'Invalid bearer token.');
  }

  private reject(response: Response, detail: string): never {
    response.setHeader('WWW-Authenticate', 'Bearer realm="SCIM"');
    throw new UnauthorizedException({
      schemas: [SCIM_ERROR_SCHEMA],
      detail,
      status: 401,
      scimType: 'invalidToken'
    });
  }
}
