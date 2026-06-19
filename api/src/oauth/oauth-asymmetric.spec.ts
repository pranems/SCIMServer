import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { OAuthSigningKeyService } from './oauth-signing-key.service';
import { buildJwtModuleOptions } from './oauth.module';
import { OAuthService } from './oauth.service';

/**
 * Pre-Q.B - asymmetric (RS256/ES256), externalized signing key + published JWKS.
 *
 * These tests exercise the REAL production factory (`buildJwtModuleOptions`) so
 * the algorithm-pinning + kid behavior under test is the same config the
 * OAuthModule wires at runtime, not a hand-rolled stand-in.
 */

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    OAUTH_CLIENT_ID: 'test-client',
    OAUTH_CLIENT_SECRET: 'test-secret',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

const logger: any = {
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  trace: jest.fn(),
};

function decodeHeader(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf-8'));
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
}

describe('OAuth asymmetric signing (Pre-Q.B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  describe('OAuthSigningKeyService', () => {
    it('defaults to RS256 and exposes a non-empty kid', () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      expect(keys.alg).toBe('RS256');
      expect(typeof keys.kid).toBe('string');
      expect(keys.kid.length).toBeGreaterThan(0);
    });

    it('publishes a JWKS containing exactly the active key with no private material', () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwks = keys.getJwks();
      expect(jwks.keys).toHaveLength(1);
      const jwk = jwks.keys[0];
      expect(jwk.kid).toBe(keys.kid);
      expect(jwk.kty).toBe('RSA');
      expect(jwk.alg).toBe('RS256');
      expect(jwk.use).toBe('sig');
      expect(jwk.n).toBeDefined();
      expect(jwk.e).toBeDefined();
      // No private key material may leak into the published JWKS.
      expect(jwk.d).toBeUndefined();
      expect(jwk.p).toBeUndefined();
      expect(jwk.q).toBeUndefined();
    });

    it('loads an RS256 private key from config (kid stable across instances)', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      const a = new OAuthSigningKeyService(makeConfig({ OAUTH_JWT_PRIVATE_KEY: pem }));
      const b = new OAuthSigningKeyService(makeConfig({ OAUTH_JWT_PRIVATE_KEY: pem }));
      // Same key in -> same thumbprint kid out (deterministic), unlike generated keys.
      expect(a.kid).toBe(b.kid);
      expect(a.getJwks().keys[0].n).toBe(b.getJwks().keys[0].n);
    });

    it('honors an explicit OAUTH_JWT_KID', () => {
      const keys = new OAuthSigningKeyService(makeConfig({ OAUTH_JWT_KID: 'my-kid-123' }));
      expect(keys.kid).toBe('my-kid-123');
      expect(keys.getJwks().keys[0].kid).toBe('my-kid-123');
    });

    it('supports ES256 when configured', () => {
      const keys = new OAuthSigningKeyService(makeConfig({ OAUTH_JWT_ALG: 'ES256' }));
      expect(keys.alg).toBe('ES256');
      const jwk = keys.getJwks().keys[0];
      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-256');
      expect(jwk.alg).toBe('ES256');
    });
  });

  describe('issued token header (B1)', () => {
    it('carries alg:RS256 and the active kid', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const { accessToken } = await oauth.generateAccessToken('test-client', 'test-secret');
      const header = decodeHeader(accessToken);

      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(keys.kid);
    });
  });

  describe('issued token claims (Q0)', () => {
    it('includes an aud claim on the issued token', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const { accessToken } = await oauth.generateAccessToken('test-client', 'test-secret');
      const payload = decodePayload(accessToken);

      expect(payload.aud).toBeDefined();
      expect(typeof payload.aud).toBe('string');
      expect((payload.aud as string).length).toBeGreaterThan(0);
    });

    it('uses a configured OAUTH_TOKEN_AUDIENCE when provided', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(
        jwt,
        makeConfig({ OAUTH_TOKEN_AUDIENCE: 'https://scim.example.com' }),
        logger,
      );

      const { accessToken } = await oauth.generateAccessToken('test-client', 'test-secret');
      const payload = decodePayload(accessToken);

      expect(payload.aud).toBe('https://scim.example.com');
    });
  });

  describe('per-endpoint token issuance (Q1)', () => {
    const ENDPOINT_ID = '11111111-1111-1111-1111-111111111111';

    it('stamps the endpoint_id claim onto a per-endpoint token', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const { accessToken } = await oauth.generateEndpointAccessToken(ENDPOINT_ID, 'epc_abc');
      const payload = decodePayload(accessToken);

      expect(payload.endpoint_id).toBe(ENDPOINT_ID);
      expect(payload.client_id).toBe('epc_abc');
      expect(payload.sub).toBe('epc_abc');
    });

    it('sets a per-endpoint aud claim distinct from the global audience', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const global = await oauth.generateAccessToken('test-client', 'test-secret');
      const perEndpoint = await oauth.generateEndpointAccessToken(ENDPOINT_ID, 'epc_abc');

      const globalAud = decodePayload(global.accessToken).aud as string;
      const epAud = decodePayload(perEndpoint.accessToken).aud as string;

      expect(epAud).toContain(ENDPOINT_ID);
      expect(epAud).not.toBe(globalAud);
    });

    it('signs the per-endpoint token with the asymmetric key (verifiable + alg-pinned)', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const { accessToken } = await oauth.generateEndpointAccessToken(ENDPOINT_ID, 'epc_abc');
      expect(decodeHeader(accessToken).alg).toBe('RS256');

      // The guard validates per-endpoint tokens via the same verify path.
      const payload = await oauth.validateAccessToken(accessToken);
      expect(payload.endpoint_id).toBe(ENDPOINT_ID);
    });

    it('grants a default scope and honors a narrower requested scope', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const def = await oauth.generateEndpointAccessToken(ENDPOINT_ID, 'epc_abc');
      expect(def.scope).toContain('scim.read');

      const narrow = await oauth.generateEndpointAccessToken(ENDPOINT_ID, 'epc_abc', 'scim.read');
      expect(narrow.scope).toBe('scim.read');
    });
  });

  describe('verification (B3)', () => {
    it('accepts a token signed by the asymmetric private key', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const { accessToken } = await oauth.generateAccessToken('test-client', 'test-secret');
      const payload = await oauth.validateAccessToken(accessToken);
      expect(payload.client_id).toBe('test-client');
    });

    it('rejects an HS256 token whose secret is the RSA public key (alg-confusion attack)', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      // Classic algorithm-confusion forgery: sign HS256 using the published
      // RSA public-key PEM as the HMAC secret. A verifier that does not pin the
      // algorithm would accept this. Algorithm pinning MUST reject it.
      const forgerJwt = new JwtService({
        secret: keys.publicKeyPem,
        signOptions: { algorithm: 'HS256' },
      });
      const forged = forgerJwt.sign({
        sub: 'attacker',
        client_id: 'attacker',
        token_type: 'access_token',
      });

      // validateAccessToken throws synchronously (it is not declared async).
      expect(() => oauth.validateAccessToken(forged)).toThrow('Invalid or expired token');
    });

    it('rejects an HS256 token signed with an unrelated secret', async () => {
      const keys = new OAuthSigningKeyService(makeConfig());
      const jwt = new JwtService(buildJwtModuleOptions(keys));
      const oauth = new OAuthService(jwt, makeConfig(), logger);

      const forgerJwt = new JwtService({
        secret: 'totally-unrelated-secret',
        signOptions: { algorithm: 'HS256' },
      });
      const forged = forgerJwt.sign({ sub: 'x', client_id: 'x', token_type: 'access_token' });

      expect(() => oauth.validateAccessToken(forged)).toThrow('Invalid or expired token');
    });
  });
});
