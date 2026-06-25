import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../modules/auth/public.decorator';
import { OAuthSigningKeyService } from './oauth-signing-key.service';

/**
 * JwksController (Pre-Q.B) - publishes the OAuth issuer's public JWKS
 * (RFC 7517) at `GET /scim/oauth/jwks`.
 *
 * The endpoint is public (no bearer required): it exposes only public key
 * material so any client can verify a token this server issued. The RFC 8414
 * authorization-server metadata (Q0/A2) advertises this URL as `jwks_uri`.
 */
@Controller('oauth')
export class JwksController {
  constructor(private readonly signingKey: OAuthSigningKeyService) {}

  @Public()
  @Get('jwks')
  @Header('Cache-Control', 'public, max-age=3600')
  getJwks(): { keys: Record<string, unknown>[] } {
    return this.signingKey.getJwks();
  }
}
