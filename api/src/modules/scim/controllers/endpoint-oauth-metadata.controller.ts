import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { OAUTH_METADATA_PATH } from '../../../oauth/oauth.constants';

/**
 * EndpointOAuthMetadataController (WI-12) - per-endpoint RFC 8414 OAuth 2.0
 * Authorization Server Metadata, served in the OIDC-style APPEND form:
 *
 *   GET /scim/endpoints/:endpointId/.well-known/oauth-authorization-server
 *
 * This is the per-endpoint sibling of the global
 * [oauth-metadata.controller.ts](../../../oauth/oauth-metadata.controller.ts)
 * (which advertises only the global `/scim/oauth/token`). A standards-based
 * OAuth client can discover the PER-ENDPOINT token endpoint + the shared JWKS
 * without any prior configuration.
 *
 * RFC 8414 rules honored:
 *  - the returned `issuer` MUST exactly equal the identifier used to build the
 *    URL (mix-up-attack defense, RFC 8414 section 3.3), i.e.
 *    `<base>/scim/endpoints/{id}` (the bare identifier form, not the `/v2` one);
 *  - the advertised `token_endpoint` is the per-endpoint one, and it starts
 *    with the issuer identifier (self-consistency);
 *  - `jwks_uri` points at the SHARED global key set - there is one signing key
 *    today, so every endpoint's tokens verify against the same JWKS.
 *
 * Public (no bearer required); the document contains only public URLs. Entra's
 * own provisioning client does NOT consume this (the admin types the values by
 * hand) - it is for standards-based OAuth clients + self-consistency.
 */
@Controller('endpoints/:endpointId')
export class EndpointOAuthMetadataController {
  @Public()
  @Get('.well-known/oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=3600')
  getMetadata(@Param('endpointId') endpointId: string, @Req() req: Request): Record<string, unknown> {
    const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
    const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
    const prefix = process.env.API_PREFIX ?? 'scim';
    const base = `${proto}://${host}`;

    // The issuer identifier is the BARE per-endpoint path (RFC 8414 section
    // 3.3). The token endpoint is built by appending to it, so it is trivially
    // self-consistent (token_endpoint.startsWith(issuer)).
    const issuer = `${base}/${prefix}/endpoints/${endpointId}`;

    return {
      issuer,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${base}/${prefix}/oauth/jwks`,
      grant_types_supported: [
        'client_credentials',
        'urn:ietf:params:oauth:grant-type:token-exchange',
      ],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    };
  }

  /**
   * Re-exported for tests that assert the constant path is used verbatim; the
   * global metadata path constant and this per-endpoint route share the same
   * `.well-known/oauth-authorization-server` suffix.
   */
  static readonly WELL_KNOWN_SUFFIX = OAUTH_METADATA_PATH;
}
