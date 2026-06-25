import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { exportJWK, SignJWT, importJWK } from 'jose';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';

/**
 * Q2 - external JWKS validator unit tests.
 *
 * The validator is the reusable signature core (alg-pinning, cache-by-kid,
 * fail-closed, SSRF host allowlist) that Q6 layers the WIF claim checks on top
 * of. These tests inject a fake fetch so no network is touched.
 */

const logger: any = {
  warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn(), trace: jest.fn(),
};

function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    JWKS_HOST_ALLOWLIST: 'login.microsoftonline.com,idp.example.com',
    ...overrides,
  };
  return { get: jest.fn((k: string) => values[k]) } as unknown as ConfigService;
}

interface KeyPairFixture {
  kid: string;
  privateKey: crypto.KeyObject;
  jwks: { keys: Record<string, unknown>[] };
}

async function makeRsaKey(kid: string): Promise<KeyPairFixture> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = (await exportJWK(publicKey)) as unknown as Record<string, unknown>;
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { kid, privateKey, jwks: { keys: [jwk] } };
}

async function signRs256(privateKey: crypto.KeyObject, kid: string, claims: Record<string, unknown>) {
  const jwk = await exportJWK(privateKey);
  const key = await importJWK({ ...jwk, alg: 'RS256' }, 'RS256');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

describe('ExternalJwksValidatorService (Q2)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates a good RS256 signature against the JWKS', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => fx.jwks });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'https://idp.example.com', sub: 's' });
    const result = await svc.verify(token, 'https://login.microsoftonline.com/tid/discovery/v2.0/keys');

    expect(result.payload.iss).toBe('https://idp.example.com');
    expect(result.payload.sub).toBe('s');
  });

  it('rejects alg:none (unsigned) tokens', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => fx.jwks });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    // Hand-craft an alg:none token.
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'kid-1' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: 'x', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const noneToken = `${header}.${body}.`;

    await expect(
      svc.verify(noneToken, 'https://idp.example.com/keys'),
    ).rejects.toThrow();
  });

  it('rejects an HS256 token (symmetric alg not allowed)', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => fx.jwks });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    const secret = new TextEncoder().encode('shared-secret-shared-secret-1234');
    const hsToken = await new SignJWT({ iss: 'x' })
      .setProtectedHeader({ alg: 'HS256', kid: 'kid-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(
      svc.verify(hsToken, 'https://idp.example.com/keys'),
    ).rejects.toThrow();
  });

  it('rejects a token signed by a DIFFERENT key (signature mismatch)', async () => {
    const good = await makeRsaKey('kid-1');
    const attacker = await makeRsaKey('kid-1'); // same kid, different key
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => good.jwks });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    const forged = await signRs256(attacker.privateKey, 'kid-1', { iss: 'x' });
    await expect(svc.verify(forged, 'https://idp.example.com/keys')).rejects.toThrow();
  });

  it('SSRF: rejects a jwksUri whose host is not on the allowlist', async () => {
    const fetchMock = jest.fn();
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    await expect(
      svc.verify('a.b.c', 'https://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(/not permitted|allowlist|host/i);
    // The fetch must never be attempted for a disallowed host.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('SSRF: rejects a non-https jwksUri', async () => {
    const fetchMock = jest.fn();
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    await expect(
      svc.verify('a.b.c', 'http://idp.example.com/keys'),
    ).rejects.toThrow(/https/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the JWKS fetch fails and no key is cached', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    await expect(
      svc.verify('a.b.c', 'https://idp.example.com/keys'),
    ).rejects.toThrow();
  });

  it('caches the JWKS by URI (second verify does not refetch)', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => fx.jwks });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const uri = 'https://idp.example.com/keys';

    const t1 = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });
    const t2 = await signRs256(fx.privateKey, 'kid-1', { iss: 'b' });
    await svc.verify(t1, uri);
    await svc.verify(t2, uri);

    // jose's createRemoteJWKSet caches internally; the fetch is called at most once
    // for a stable kid.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
