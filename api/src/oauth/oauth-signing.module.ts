import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OAuthSigningKeyService } from './oauth-signing-key.service';

/**
 * OAuthSigningModule (Pre-Q.B) - provides the single shared
 * {@link OAuthSigningKeyService} instance.
 *
 * Isolated in its own module so the JwtModule's async factory and the
 * JwksController both inject the SAME signing identity (one key, one kid,
 * one published JWKS) rather than constructing separate instances with
 * divergent keys.
 */
@Module({
  imports: [ConfigModule],
  providers: [OAuthSigningKeyService],
  exports: [OAuthSigningKeyService],
})
export class OAuthSigningModule {}
