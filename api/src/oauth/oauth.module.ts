import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { JwksController } from './jwks.controller';
import { OAuthSigningKeyService } from './oauth-signing-key.service';
import { OAuthSigningModule } from './oauth-signing.module';

/**
 * Build the JwtModule options from the active asymmetric signing key (Pre-Q.B).
 *
 * Signs with the private key using `keys.alg` (RS256/ES256) and stamps the
 * `kid` into every token header so verifiers can select the right JWKS key.
 * Verification PINS the allowed algorithms to `[keys.alg]` - this is the
 * algorithm-confusion defense: an HS256 token (e.g. one forged by HMAC-ing the
 * published RSA public key) is rejected because HS256 is not in the allowlist.
 *
 * Exported so the production config is exercised directly by unit tests.
 */
export function buildJwtModuleOptions(keys: OAuthSigningKeyService): JwtModuleOptions {
  return {
    privateKey: keys.privateKeyPem,
    publicKey: keys.publicKeyPem,
    signOptions: {
      algorithm: keys.alg,
      keyid: keys.kid,
      issuer: 'scimserver-oauth-server',
    },
    verifyOptions: {
      algorithms: [keys.alg],
      issuer: 'scimserver-oauth-server',
    },
  };
}

@Module({
  imports: [
    ConfigModule,
    OAuthSigningModule,
    JwtModule.registerAsync({
      imports: [OAuthSigningModule],
      inject: [OAuthSigningKeyService],
      useFactory: (keys: OAuthSigningKeyService) => buildJwtModuleOptions(keys),
    }),
  ],
  controllers: [OAuthController, JwksController],
  providers: [OAuthService],
  exports: [OAuthService], // Export for use in SCIM authentication
})
export class OAuthModule {}