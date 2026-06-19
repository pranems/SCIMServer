import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

export type OAuthSigningAlg = 'RS256' | 'ES256';

/**
 * OAuthSigningKeyService (Pre-Q.B) - owns the asymmetric signing identity for
 * the global OAuth issuer.
 *
 * The issuer previously signed with a symmetric HS256 secret, which cannot be
 * published for third-party verification. This service loads (or, for dev,
 * generates) an RS256/ES256 key pair, exposes the private PEM for signing, the
 * public PEM for verification, a stable `kid`, and an RFC 7517 JWKS for
 * publication so any client can verify an issued token.
 *
 * Configuration (all optional):
 * - `OAUTH_JWT_ALG`        - `RS256` (default) or `ES256`.
 * - `OAUTH_JWT_PRIVATE_KEY`- PKCS#8 PEM private key. `\n`-escaped values are
 *                            normalized so the key can ride a single env var.
 * - `OAUTH_JWT_PUBLIC_KEY` - SPKI PEM public key (derived from the private key
 *                            when omitted).
 * - `OAUTH_JWT_KID`        - explicit key id (defaults to the RFC 7638 JWK
 *                            thumbprint, which is stable for a given key).
 *
 * When no private key is configured an ephemeral key is generated and a warning
 * is emitted: tokens verify within the process lifetime, but production
 * deployments should set `OAUTH_JWT_PRIVATE_KEY` for cross-restart /
 * multi-instance stability.
 */
@Injectable()
export class OAuthSigningKeyService {
  readonly alg: OAuthSigningAlg;
  readonly kid: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  private readonly publicJwk: Record<string, unknown>;

  constructor(config: ConfigService) {
    const configuredAlg = (config.get<string>('OAUTH_JWT_ALG') ?? 'RS256').toUpperCase();
    this.alg = configuredAlg === 'ES256' ? 'ES256' : 'RS256';

    const { privateKey, publicKey } = this.loadOrGenerateKeyPair(config);

    this.privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    this.kid = config.get<string>('OAUTH_JWT_KID') ?? this.computeThumbprint(jwk);
    this.publicJwk = { ...jwk, kid: this.kid, alg: this.alg, use: 'sig' };
  }

  /**
   * The public JWKS for publication (RFC 7517). Returns a defensive copy so the
   * internal JWK can never be mutated by a caller, and never carries private
   * key material (`d`/`p`/`q`/`dp`/`dq`/`qi`).
   */
  getJwks(): { keys: Record<string, unknown>[] } {
    return { keys: [{ ...this.publicJwk }] };
  }

  private loadOrGenerateKeyPair(config: ConfigService): {
    privateKey: crypto.KeyObject;
    publicKey: crypto.KeyObject;
  } {
    const privatePem = config.get<string>('OAUTH_JWT_PRIVATE_KEY');
    if (privatePem) {
      const privateKey = crypto.createPrivateKey(this.normalizePem(privatePem));
      const publicPem = config.get<string>('OAUTH_JWT_PUBLIC_KEY');
      const publicKey = publicPem
        ? crypto.createPublicKey(this.normalizePem(publicPem))
        : crypto.createPublicKey(privateKey);
      return { privateKey, publicKey };
    }

    console.warn(
      `[OAuth] No OAUTH_JWT_PRIVATE_KEY configured - generating an ephemeral ${this.alg} signing key. ` +
        'Configure OAUTH_JWT_PRIVATE_KEY for stable token verification across restarts.',
    );
    if (this.alg === 'ES256') {
      return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    }
    return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  }

  /** Allow `\n`-escaped PEM env values (single-line secrets). */
  private normalizePem(pem: string): string {
    return pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  }

  /** RFC 7638 JWK thumbprint over the required members in lexicographic order. */
  private computeThumbprint(jwk: Record<string, unknown>): string {
    const canonical =
      jwk.kty === 'EC'
        ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
        : { e: jwk.e, kty: jwk.kty, n: jwk.n };
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
  }
}
