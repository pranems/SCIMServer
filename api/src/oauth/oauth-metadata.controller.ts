import { Controller, Get, Header, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../modules/auth/public.decorator';
import { OAUTH_ISSUER, OAUTH_METADATA_PATH } from './oauth.constants';

/**
 * OAuthMetadataController (Q0) - RFC 8414 OAuth 2.0 Authorization Server Metadata.
 *
 * Served at the deployment ROOT (`GET /.well-known/oauth-authorization-server`,
 * excluded from the `scim` global prefix in main.ts), publicly, so a client can
 * discover the token endpoint and the JWKS URI without prior configuration.
 *
 * The `issuer` is the same constant the JWT signer stamps as `iss`, so the
 * metadata is self-consistent with issued tokens (RFC 8414 requirement).
 */
@Controller()
export class OAuthMetadataController {
  constructor(private readonly config: ConfigService) {}

  @Public()
  @Get(OAUTH_METADATA_PATH)
  @Header('Cache-Control', 'public, max-age=3600')
  getMetadata(@Req() req: Request): Record<string, unknown> {
    const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
    const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
    const base = `${proto}://${host}`;
    const prefix = process.env.API_PREFIX ?? 'scim';

    const scopesRaw = this.config.get<string>('OAUTH_CLIENT_SCOPES');
    const scopes = scopesRaw
      ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean)
      : ['scim.read', 'scim.write', 'scim.manage'];

    return {
      issuer: OAUTH_ISSUER,
      token_endpoint: `${base}/${prefix}/oauth/token`,
      jwks_uri: `${base}/${prefix}/oauth/jwks`,
      grant_types_supported: ['client_credentials'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      scopes_supported: scopes,
    };
  }
}
