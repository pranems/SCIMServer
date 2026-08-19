import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { JwksController } from './jwks.controller';
import { OAuthMetadataController } from './oauth-metadata.controller';
import { AuthErrorsCatalogController } from './auth-errors-catalog.controller';
import { OAuthSigningKeyService } from './oauth-signing-key.service';
import { OAuthSigningModule } from './oauth-signing.module';
import { ExternalJwksValidatorService, JWKS_FETCH } from './external-jwks-validator.service';
import { JwksPrewarmService } from './jwks-prewarm.service';
import { RepositoryModule } from '../infrastructure/repositories/repository.module';
import { WifAssertionValidatorService } from './wif-assertion-validator.service';
import { WifDiscoveryResolverService } from './wif-discovery-resolver.service';
import { JwksHostAllowlistService } from './jwks-host-allowlist.service';
import { AuthDecisionRecordStore } from './auth-decision-record.store';
import { OAUTH_ISSUER } from './oauth.constants';

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
      issuer: OAUTH_ISSUER,
    },
    verifyOptions: {
      algorithms: [keys.alg],
      issuer: OAUTH_ISSUER,
    },
  };
}

@Module({
  imports: [
    ConfigModule,
    OAuthSigningModule,
    // W1.2 - the boot JWKS prewarm needs the credential repository to enumerate
    // registered trusts. Without this import the optional token resolves to
    // undefined and the prewarm silently never runs.
    RepositoryModule.register(),
    JwtModule.registerAsync({
      imports: [OAuthSigningModule],
      inject: [OAuthSigningKeyService],
      useFactory: (keys: OAuthSigningKeyService) => buildJwtModuleOptions(keys),
    }),
  ],
  controllers: [OAuthController, JwksController, OAuthMetadataController, AuthErrorsCatalogController],
  providers: [
    OAuthService,
    ExternalJwksValidatorService,
    WifAssertionValidatorService,
    WifDiscoveryResolverService,
    JwksHostAllowlistService,
    AuthDecisionRecordStore,
    JwksPrewarmService,
    // Register the JWKS fetch implementation as an injectable so it can be
    // overridden in tests. The default wraps the platform `fetch` (bound to
    // globalThis), preserving the production behavior of the `?? globalThis.fetch`
    // fallback while giving E2E tests a provider to override.
    { provide: JWKS_FETCH, useFactory: () => globalThis.fetch.bind(globalThis) },
  ],
  exports: [OAuthService, ExternalJwksValidatorService, WifAssertionValidatorService, WifDiscoveryResolverService, JwksHostAllowlistService, AuthDecisionRecordStore], // Export for use in SCIM authentication + WIF
})
export class OAuthModule {}