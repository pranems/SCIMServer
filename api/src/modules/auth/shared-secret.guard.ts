import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import { SCIM_ERROR_SCHEMA } from '../scim/common/scim-constants';
import * as crypto from 'node:crypto';
import { safeCompare } from '../../security/safe-compare';
import { OAuthService } from '../../oauth/oauth.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ScimLogger } from '../logging/scim-logger.service';
import { LogCategory } from '../logging/log-levels';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { getConfigBoolean, getEffectiveAuthEnablement, ENDPOINT_CONFIG_FLAGS, type EndpointConfig } from '../endpoint/endpoint-config.interface';

// bcrypt is heavy - lazy-load via dynamic import cached on first use
let bcryptCompare: (data: string, hash: string) => Promise<boolean>;
async function loadBcryptCompare(): Promise<typeof bcryptCompare> {
  if (!bcryptCompare) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = await import('bcrypt');
    bcryptCompare = bcrypt.compare.bind(bcrypt);
  }
  return bcryptCompare;
}

interface AuthenticatedRequest extends Request {
  oauth?: Record<string, unknown>;
  authType?: 'oauth' | 'legacy' | 'endpoint_credential';
  authCredentialId?: string;
}

@Injectable()
export class SharedSecretGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @Inject(OAuthService) private readonly oauthService: OAuthService,
    private readonly reflector: Reflector,
    private readonly logger: ScimLogger,
    @Optional() @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository | null,
    @Optional() @Inject(EndpointService)
    private readonly endpointService: EndpointService | null,
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

    // ── Phase 11: Per-endpoint credential check ──────────────────────
    // If the URL contains an endpointId segment and the endpoint has
    // PerEndpointCredentialsEnabled=true, try per-endpoint credentials first.
    const endpointId = this.extractEndpointId(request);
    if (endpointId && this.credentialRepo && this.endpointService) {
      const matched = await this.tryEndpointCredential(endpointId, token, request);
      if (matched) return true;
    }

    // ── OAuth 2.0 JWT token validation ───────────────────────────────
    if (token !== expectedSecret) {
      this.logger.debug(LogCategory.AUTH, 'Attempting OAuth 2.0 token validation');
      let payload: Record<string, unknown> | undefined;
      try {
        payload = await this.oauthService.validateAccessToken(token);
      } catch (_oauthError) {
        this.logger.debug(LogCategory.AUTH, 'OAuth 2.0 validation failed, falling back to legacy token');
        payload = undefined; // fall through to legacy token check
      }

      if (payload) {
        // Q1: per-endpoint token scoping. A token carrying an `endpoint_id`
        // claim is scoped to exactly one endpoint and authorizes ONLY that
        // endpoint's routes. Presented to a different endpoint (or a route
        // with no endpoint segment, e.g. global admin), it is
        // "mine-but-invalid-stop": reject now, never fall through to the
        // legacy-secret acceptor (downgrade-confusion defense). The check is
        // OUTSIDE the validate try/catch so the rejection is not swallowed.
        const tokenEndpointId =
          typeof payload.endpoint_id === 'string' ? payload.endpoint_id : undefined;
        if (tokenEndpointId) {
          const urlEndpointId = this.extractEndpointId(request);
          if (urlEndpointId !== tokenEndpointId) {
            this.logger.warn(
              LogCategory.AUTH,
              'Per-endpoint OAuth token presented to a route it is not scoped for',
              { tokenEndpointId, urlEndpointId },
            );
            this.reject(
              response,
              'OAuth token is scoped to a different endpoint.',
              'invalid_token',
            );
          }
        }

        // Add OAuth payload to request for later use
        request.oauth = payload;
        request.authType = 'oauth';

        this.logger.enrichContext({ authType: 'oauth', authClientId: payload.client_id as string });
        this.logger.info(LogCategory.AUTH, 'OAuth 2.0 authentication successful', {
          clientId: payload.client_id as string,
          endpointScoped: tokenEndpointId ? true : false,
        });
        return true;
      }
    }

    // ── Legacy global bearer token ───────────────────────────────────
    // S-2: timing-safe comparison via safeCompare prevents byte-by-byte
    // guessing of the configured shared secret via response-time analysis.
    if (safeCompare(token, expectedSecret)) {
      // WI-11 - an endpoint-scoped request may REFUSE the global shared secret
      // when SharedSecretBearerAuthEnabled is false on that endpoint (it then
      // accepts only its own per-endpoint credentials / endpoint-scoped OAuth).
      // Global (non-endpoint) routes always accept the secret.
      if (endpointId && this.endpointService) {
        const allowed = await this.isSharedSecretAllowedForEndpoint(endpointId);
        if (!allowed) {
          this.logger.warn(
            LogCategory.AUTH,
            'Global shared secret refused: SharedSecretBearerAuthEnabled is off for this endpoint',
            { endpointId },
          );
          this.reject(response, 'This endpoint does not accept the global shared secret.', 'invalid_token');
        }
      }
      this.logger.info(LogCategory.AUTH, 'Legacy bearer token authentication successful');
      request.authType = 'legacy';
      this.logger.enrichContext({ authType: 'legacy' });
      return true;
    }

    // Both per-endpoint, OAuth, and legacy validation failed
    this.logger.warn(LogCategory.AUTH, 'Authentication failed – per-endpoint, OAuth, and legacy token all invalid');
    this.reject(response, 'Invalid bearer token.', 'invalid_token');
  }

  // ── Per-endpoint credential helpers ────────────────────────────────

  /**
   * Extract endpointId from URL pattern /endpoints/:endpointId/...
   */
  private extractEndpointId(request: Request): string | null {
    const match = request.url.match(/\/endpoints\/([0-9a-f-]{36})\//i);
    return match ? match[1] : null;
  }

  /**
   * WI-11 - whether the endpoint accepts the global SCIM_SHARED_SECRET.
   * Effective SharedSecretBearerAuthEnabled defaults to `true` (back-compat),
   * so an endpoint refuses the global secret ONLY when it explicitly sets the
   * flag to false. On any lookup error we fail OPEN (return true) to preserve
   * today's behavior - the secret still had to match to reach this check.
   */
  private async isSharedSecretAllowedForEndpoint(endpointId: string): Promise<boolean> {
    try {
      const endpoint = await this.endpointService!.getEndpoint(endpointId);
      const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
      return getEffectiveAuthEnablement(config).sharedSecretBearer;
    } catch (error) {
      this.logger.debug(LogCategory.AUTH, 'Shared-secret enablement check failed, allowing (fail-open)', {
        endpointId,
        error: (error as Error).message,
      });
      return true;
    }
  }

  /**
   * Try to authenticate via per-endpoint credentials.
   * Returns true if a matching active credential is found.
   * Returns false to allow fallback to OAuth/legacy.
   */
  private async tryEndpointCredential(
    endpointId: string,
    token: string,
    request: AuthenticatedRequest,
  ): Promise<boolean> {
    try {
      // WI-11 - per-method enablement. `bearer` credentials ride
      // SecretTokenBearerAuthEnabled and `oauth_client` credentials ride
      // OAuthClientCredentialsAuthEnabled; each falls back to the legacy
      // PerEndpointCredentialsEnabled when unset (value-preserving migration).
      const endpoint = await this.endpointService!.getEndpoint(endpointId);
      const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
      const effective = getEffectiveAuthEnablement(config);

      if (!effective.secretTokenBearer && !effective.oauthClientCredentials) {
        this.logger.debug(LogCategory.AUTH, 'Per-endpoint credentials not enabled for this endpoint', { endpointId });
        return false; // Fall through to OAuth/legacy
      }

      // Load active credentials for this endpoint
      const credentials = await this.credentialRepo!.findActiveByEndpoint(endpointId);
      if (credentials.length === 0) {
        this.logger.debug(LogCategory.AUTH, 'No active per-endpoint credentials found, falling back', { endpointId });
        return false; // Fall through to OAuth/legacy
      }

      // Compare token against each credential's bcrypt hash, but ONLY consider a
      // credential whose type's auth method is enabled (WI-11). A `wif` row has
      // an empty hash and never matches; a `bearer`/`oauth_client` row is
      // skipped when its method flag is off.
      const compare = await loadBcryptCompare();
      for (const cred of credentials) {
        if (cred.credentialType === 'bearer' && !effective.secretTokenBearer) continue;
        if (cred.credentialType === 'oauth_client' && !effective.oauthClientCredentials) continue;
        const isMatch = cred.credentialHash
          ? await compare(token, cred.credentialHash)
          : false;
        if (isMatch) {
          request.authType = 'endpoint_credential';
          request.authCredentialId = cred.id;
          this.logger.enrichContext({ authType: 'endpoint_credential', authCredentialId: cred.id });
          this.logger.info(LogCategory.AUTH, 'Per-endpoint credential authentication successful', {
            endpointId,
            credentialId: cred.id,
            label: cred.label,
          });
          return true;
        }
      }

      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential mismatch, falling back to OAuth/legacy', { endpointId });
      return false; // No match - fall through to OAuth/legacy
    } catch (error) {
      // If endpoint not found or any error, fall through to global auth
      this.logger.debug(LogCategory.AUTH, 'Per-endpoint credential check failed, falling back', {
        endpointId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  private reject(
    response: Response,
    detail: string,
    errorCode?: 'invalid_token' | 'invalid_request' | 'insufficient_scope',
  ): never {
    // RFC 6750 section 3: a 401 carries a WWW-Authenticate challenge. When a
    // token was presented but rejected, include error + error_description so
    // the client learns why. When the request lacked credentials entirely,
    // advertise only the realm and omit the error code (RFC 6750 section 3).
    let header = 'Bearer realm="SCIM"';
    if (errorCode) {
      const safeDescription = detail.replace(/[\\"]/g, ' ').trim();
      header += `, error="${errorCode}", error_description="${safeDescription}"`;
    }
    response.setHeader('WWW-Authenticate', header);
    throw new UnauthorizedException({
      schemas: [SCIM_ERROR_SCHEMA],
      detail,
      status: 401,
      scimType: 'invalidToken'
    });
  }
}
