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

// ─── Runtime egress robustness (timeout / retries / redirect / single-flight) ──

describe('ExternalJwksValidatorService - runtime egress robustness', () => {
  beforeEach(() => jest.clearAllMocks());

  const ok = (jwks: unknown) => ({
    status: 200,
    ok: true,
    headers: { get: () => null },
    json: async () => jwks,
  });
  const redirect = (location: string) => ({
    status: 302,
    ok: false,
    headers: { get: (h: string) => (h.toLowerCase() === 'location' ? location : null) },
    json: async () => ({}),
  });

  it('G1/G2: passes an AbortSignal timeout + redirect:manual to fetch', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue(ok(fx.jwks));
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });

    await svc.verify(token, 'https://idp.example.com/keys');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.redirect).toBe('manual');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('G5: retries a transient fetch failure then succeeds', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(ok(fx.jwks));
    // backoff 0 keeps the test fast; server default retries=2 -> 3 tries total.
    const svc = new ExternalJwksValidatorService(makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0' }), logger, fetchMock as any);
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });

    const res = await svc.verify(token, 'https://idp.example.com/keys');
    expect(res.payload.iss).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('G5: an endpoint override of retries=0 disables retry (one try, fail closed)', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    const svc = new ExternalJwksValidatorService(makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0' }), logger, fetchMock as any);

    await expect(
      svc.verify('a.b.c', 'https://idp.example.com/keys', { retries: 0 }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('G2 SSRF: a redirect to a DISALLOWED host is rejected (never fetched)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(redirect('https://169.254.169.254/latest/'));
    // allowlist has idp.example.com but NOT 169.254.169.254
    const svc = new ExternalJwksValidatorService(makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0' }), logger, fetchMock as any);

    await expect(
      svc.verify('a.b.c', 'https://idp.example.com/keys', { retries: 0 }),
    ).rejects.toThrow();
    // Only the ORIGINAL allowlisted URL was fetched; the redirect target was blocked
    // BEFORE any request to it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://idp.example.com/keys');
  });

  it('G2: a redirect to an ALLOWED host is followed', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect('https://login.microsoftonline.com/keys'))
      .mockResolvedValueOnce(ok(fx.jwks));
    const svc = new ExternalJwksValidatorService(makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0' }), logger, fetchMock as any);
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });

    const res = await svc.verify(token, 'https://idp.example.com/keys');
    expect(res.payload.iss).toBe('a');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://login.microsoftonline.com/keys');
  });

  it('G3 single-flight: concurrent verifies for the same URI fetch once', async () => {
    const fx = await makeRsaKey('kid-1');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = jest.fn(async () => {
      await gate;
      return ok(fx.jwks);
    });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const t1 = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });
    const t2 = await signRs256(fx.privateKey, 'kid-1', { iss: 'b' });

    const p1 = svc.verify(t1, 'https://idp.example.com/keys');
    const p2 = svc.verify(t2, 'https://idp.example.com/keys');
    // let both enter fetchJwks before the fetch resolves
    await new Promise((r) => setTimeout(r, 20));
    release!();
    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

