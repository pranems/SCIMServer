import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { safeCompare } from '../security/safe-compare';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';

/**
 * Default `aud` claim for issued access tokens (Q0). Identifies the SCIM
 * resource server as the intended audience. Override with OAUTH_TOKEN_AUDIENCE.
 */
export const OAUTH_DEFAULT_AUDIENCE = 'scimserver-scim-api';

export interface AccessToken {
  accessToken: string;
  expiresIn: number;
  scope?: string;
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
  scopes: string[];
}

interface TokenPayload {
  sub: string;
  client_id: string;
  scope?: string;
  token_type: string;
  [key: string]: unknown;
}

@Injectable()
export class OAuthService {
  private readonly validClients: Map<string, ClientCredentials>;
  private readonly audience: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly logger: ScimLogger,
  ) {
    const defaultClientId = this.config.get<string>('OAUTH_CLIENT_ID') || 'scimserver-client';
    const configuredSecret = this.config.get<string>('OAUTH_CLIENT_SECRET');
    const configuredScopes = this.config.get<string>('OAUTH_CLIENT_SCOPES');

    this.audience = this.config.get<string>('OAUTH_TOKEN_AUDIENCE') || OAUTH_DEFAULT_AUDIENCE;

    let clientSecret = configuredSecret;

    if (!clientSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('OAUTH_CLIENT_SECRET is required in production to secure OAuth access.');
      }

      clientSecret = crypto.randomBytes(32).toString('hex');
      this.logger.warn(LogCategory.OAUTH, `Auto-generated development client secret for "${defaultClientId}". Configure OAUTH_CLIENT_SECRET for production.`);
    }

    const scopes = configuredScopes
      ? configuredScopes.split(',').map(scope => scope.trim()).filter(Boolean)
      : ['scim.read', 'scim.write', 'scim.manage'];

    this.validClients = new Map([
      [defaultClientId, {
        clientId: defaultClientId,
        clientSecret,
        scopes,
      }],
    ]);
  }

  generateAccessToken(
    clientId: string,
    clientSecret: string,
    requestedScope?: string
  ): Promise<AccessToken> {
    this.logger.debug(LogCategory.OAUTH, 'Validating client credentials', {
      clientId,
      availableClients: Array.from(this.validClients.keys()),
    });

    // Validate client credentials
    const client = this.validClients.get(clientId);

    // S-2: timing-safe comparison via safeCompare prevents byte-by-byte
    // guessing of the configured client secret via response-time analysis.
    if (!client || !safeCompare(client.clientSecret, clientSecret)) {
      this.logger.warn(LogCategory.OAUTH, 'Client validation failed', {
        clientFound: !!client,
      });
      throw new UnauthorizedException('Invalid client credentials');
    }

    // Validate and filter scopes
    const requestedScopes = requestedScope ? requestedScope.split(' ') : [];
    const allowedScopes = requestedScopes.filter(scope =>
      client.scopes.includes(scope)
    );

    // If no specific scopes requested, grant all client scopes
    const grantedScopes = allowedScopes.length > 0 ? allowedScopes : client.scopes;

    // Token payload
    const payload = {
      sub: clientId,
      client_id: clientId,
      aud: this.audience,
      scope: grantedScopes.join(' '),
      token_type: 'access_token'
    };

    // Generate JWT token (expires in 1 hour)
    const expiresIn = 3600; // 1 hour in seconds
    const accessToken = this.jwtService.sign(payload, { expiresIn: `${expiresIn}s` });

    this.logger.info(LogCategory.OAUTH, 'Access token generated', {
      clientId,
      scopes: grantedScopes,
      expiresIn,
    });

    return Promise.resolve({
      accessToken,
      expiresIn,
      scope: grantedScopes.join(' ')
    });
  }

  /**
   * Mint a per-endpoint access token (Q1).
   *
   * The token carries an `endpoint_id` claim that scopes it to a single
   * endpoint: the resource guard authorizes it ONLY for requests to that
   * endpoint's routes (a token presented to a different endpoint is rejected,
   * never falling through to a broader acceptor). The `aud` claim is a
   * per-endpoint value so downstream consumers can also assert the audience.
   *
   * Credential validation (matching the per-endpoint `oauth-client` client_id /
   * secret) is the caller's responsibility; this method only issues the token.
   *
   * Q6.4 - `options.trustedScope` lets the WIF flow mint with an
   * admin-configured scope verbatim (the scope is set by the operator on the
   * `wif` trust, not requested by the caller, so it bypasses the caller-scope
   * filter). `options.ttlSec` sets the lifetime, clamped to the Entra-spec
   * 1-6h window.
   */
  generateEndpointAccessToken(
    endpointId: string,
    clientId: string,
    requestedScope?: string,
    options?: { ttlSec?: number; trustedScope?: string },
  ): Promise<AccessToken> {
    const defaultScopes = ['scim.read', 'scim.write', 'scim.manage'];

    let grantedScope: string;
    if (options?.trustedScope && options.trustedScope.trim().length > 0) {
      // Admin-configured (WIF) scope - trusted, used verbatim.
      grantedScope = options.trustedScope.trim();
    } else {
      const requestedScopes = requestedScope ? requestedScope.split(' ').filter(Boolean) : [];
      const allowed = requestedScopes.filter((s) => defaultScopes.includes(s));
      grantedScope = (allowed.length > 0 ? allowed : defaultScopes).join(' ');
    }

    // Clamp the lifetime to the Entra WIF 1-6h window; default 1h.
    const TTL_FLOOR = 3600;
    const TTL_CEIL = 21600;
    let expiresIn = TTL_FLOOR;
    if (typeof options?.ttlSec === 'number' && Number.isFinite(options.ttlSec)) {
      expiresIn = Math.min(TTL_CEIL, Math.max(TTL_FLOOR, Math.floor(options.ttlSec)));
    }

    const payload = {
      sub: clientId,
      client_id: clientId,
      aud: `${this.audience}:${endpointId}`,
      endpoint_id: endpointId,
      scope: grantedScope,
      token_type: 'access_token',
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn: `${expiresIn}s` });

    this.logger.info(LogCategory.OAUTH, 'Per-endpoint access token generated', {
      endpointId,
      clientId,
      scopes: grantedScope,
      expiresIn,
    });

    return Promise.resolve({
      accessToken,
      expiresIn,
      scope: grantedScope,
    });
  }

  validateAccessToken(token: string): Promise<TokenPayload> {
    try {
      const payload = this.jwtService.verify<TokenPayload>(token);
      this.logger.debug(LogCategory.OAUTH, 'Token validation success', {
        clientId: payload.client_id,
        scope: payload.scope,
      });
      return Promise.resolve(payload);
    } catch (error) {
      this.logger.debug(LogCategory.OAUTH, 'Token validation failed', {
        reason: error instanceof Error ? error.message : String(error),
      });
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  hasScope(payload: TokenPayload, requiredScope: string): boolean {
    const scopes = payload.scope ? payload.scope.split(' ') : [];
    return scopes.includes(requiredScope);
  }
}