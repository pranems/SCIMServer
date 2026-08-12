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

  // `getFreshCached` treats an entry as fresh while `elapsed <= maxAge`, so with
  // maxAge=0 a second call in the SAME millisecond is still a cache hit. These
  // W1.3 tests need a genuinely cold second fetch, so they let a few ms pass.
  const elapse = () => new Promise((r) => setTimeout(r, 5));

  it('W1.3: the resolved redirect target is remembered, so a later cold fetch skips the hop', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest
      .fn()
      // first cold fetch: legacy host -> 302 -> canonical host
      .mockResolvedValueOnce(redirect('https://login.microsoftonline.com/keys'))
      .mockResolvedValueOnce(ok(fx.jwks))
      // second cold fetch (cache expired): must go STRAIGHT to the canonical host
      .mockResolvedValue(ok(fx.jwks));
    // cacheMaxAgeMs=0 (+ elapsed time) forces every verify to be a cold fetch.
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0', JWKS_CACHE_MAX_AGE_MS: '0' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });

    await svc.verify(token, 'https://idp.example.com/keys');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 302 + follow

    await elapse();
    fetchMock.mockClear();
    await svc.verify(token, 'https://idp.example.com/keys');

    // The redirect hop is NOT paid again - one request, straight to the target.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://login.microsoftonline.com/keys');
  });

  it('W1.3: a remembered target is still re-validated against the SSRF allowlist on every use', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(redirect('https://login.microsoftonline.com/keys'))
      .mockResolvedValue(ok(fx.jwks));
    // A mutable allowlist so the canonical host can be revoked AFTER it has
    // been remembered - this is the case that proves the shortcut cannot widen
    // what the fetcher may reach.
    let canonicalAllowed = true;
    const allowlistStub = {
      isAllowed: (host: string) =>
        host === 'idp.example.com' || (host === 'login.microsoftonline.com' && canonicalAllowed),
    };
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_FETCH_RETRY_BACKOFF_MS: '0', JWKS_CACHE_MAX_AGE_MS: '0' }),
      logger,
      fetchMock as any,
      allowlistStub as any,
    );
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });

    await svc.verify(token, 'https://idp.example.com/keys');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 302 + follow (now remembered)

    // Revoke the canonical host. The REMEMBERED target must be re-checked, so
    // NO request may go out to it.
    //
    // W1.4 CHANGED THE OUTCOME HERE (intended, not a regression). This test
    // used to assert that `verify` still SUCCEEDED, because fail-to-stale
    // returned the keys fetched while the host was allowed - recorded as the
    // open question in EXECUTION_ISSUES_AND_RCA.md section 10.2. W1.4 resolves
    // that question: an allowlist rejection is now explicitly NOT
    // stale-eligible, while a network failure still is. Keeping the old
    // behaviour alongside the 10-min -> 24 h TTL raise would have widened the
    // post-revocation exposure window by 144x.
    await elapse();
    canonicalAllowed = false;
    fetchMock.mockClear();
    await expect(
      svc.verify(token, 'https://idp.example.com/keys', { retries: 0 }),
    ).rejects.toThrow(/not permitted|allowlist/i);
    // The property this test has always guarded is unchanged: the remembered
    // redirect target is re-validated, so no request reaches the revoked host.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('W1.1: onModuleInit pre-loads jose so the first mint does not pay the module import', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn().mockResolvedValue(ok(fx.jwks));
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    expect(svc.isJoseLoaded()).toBe(true);

    // ...and verification still works normally afterwards.
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'a' });
    const res = await svc.verify(token, 'https://idp.example.com/keys');
    expect(res.payload.iss).toBe('a');
  });

  it('W1.1: a failed pre-load is non-fatal (boot must never break on it)', async () => {
    const fetchMock = jest.fn();
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    // Force the loader to fail once; onModuleInit must swallow it.
    jest.spyOn(svc as unknown as { loadJose: () => Promise<unknown> }, 'loadJose')
      .mockRejectedValueOnce(new Error('module resolution failed'));
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
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

/**
 * W1.5 - the safety envelope around the JWKS fetch.
 *
 * A per-attempt timeout does NOT bound the operation: with retries and
 * exponential backoff the worst case is tens of seconds on the token-mint hot
 * path. These tests pin the total deadline and the response caps, and every
 * cap is driven by configuration rather than a hardcoded literal.
 */
describe('ExternalJwksValidatorService - W1.5 total deadline + response caps', () => {
  beforeEach(() => jest.clearAllMocks());

  const URI = 'https://idp.example.com/keys';

  /** A 200 response that also exposes text(), the way a real Response does. */
  const okBody = (body: unknown) => {
    const text = JSON.stringify(body);
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };

  it('bounds the whole retry ladder by the total deadline instead of running it to completion', async () => {
    // retries=5 with a 200 ms base backoff would sleep 200+400+800+1600+3200 =
    // 6.2 s before failing. The 400 ms total deadline must cut that short.
    const fetchMock = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const svc = new ExternalJwksValidatorService(
      makeConfig({
        JWKS_TOTAL_DEADLINE_MS: '400',
        JWKS_FETCH_RETRIES: '5',
        JWKS_FETCH_RETRY_BACKOFF_MS: '200',
      }),
      logger,
      fetchMock as any,
    );
    const fx = await makeRsaKey('kid-1');
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'x' });

    const started = Date.now();
    await expect(svc.verify(token, URI)).rejects.toThrow();
    const elapsed = Date.now() - started;

    // Generous slack for CI scheduling, but far below the ~6.2 s full ladder.
    expect(elapsed).toBeLessThan(2000);
    expect(fetchMock.mock.calls.length).toBeLessThan(6);
  });

  it('reports the deadline as the reason when it is what stopped the work', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const svc = new ExternalJwksValidatorService(
      makeConfig({
        JWKS_TOTAL_DEADLINE_MS: '150',
        JWKS_FETCH_RETRIES: '5',
        JWKS_FETCH_RETRY_BACKOFF_MS: '200',
      }),
      logger,
      fetchMock as any,
    );
    const fx = await makeRsaKey('kid-1');
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'x' });
    await expect(svc.verify(token, URI)).rejects.toThrow(/deadline/i);
  });

  it('rejects a JWKS response larger than maxResponseBytes', async () => {
    const fx = await makeRsaKey('kid-1');
    const bloated = { keys: fx.jwks.keys, padding: 'x'.repeat(5000) };
    const fetchMock = jest.fn(async () => okBody(bloated));
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_MAX_RESPONSE_BYTES: '512', JWKS_FETCH_RETRIES: '0' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'x' });
    await expect(svc.verify(token, URI)).rejects.toThrow(/bytes|size|too large/i);
  });

  it('accepts a JWKS response within maxResponseBytes', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn(async () => okBody(fx.jwks));
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_MAX_RESPONSE_BYTES: '1048576' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'ok' });
    await expect(svc.verify(token, URI)).resolves.toBeDefined();
  });

  it('rejects a key set with more keys than maxKeys', async () => {
    // Distinct kids on purpose. An earlier draft of this test reused ONE key
    // three times, which made `createLocalJWKSet` reject on duplicate `kid` -
    // so the test passed before the cap existed, for the wrong reason. With
    // distinct kids the key set is perfectly valid and kid-1 resolves, so the
    // ONLY thing that can reject it is the cap under test.
    const fx1 = await makeRsaKey('kid-1');
    const fx2 = await makeRsaKey('kid-2');
    const fx3 = await makeRsaKey('kid-3');
    const many = { keys: [fx1.jwks.keys[0], fx2.jwks.keys[0], fx3.jwks.keys[0]] };
    const fetchMock = jest.fn(async () => okBody(many));
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_MAX_KEYS: '2', JWKS_FETCH_RETRIES: '0' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx1.privateKey, 'kid-1', { iss: 'x' });
    await expect(svc.verify(token, URI)).rejects.toThrow(/too many keys|maxKeys|key count/i);
  });

  it('accepts a key set at exactly maxKeys (boundary, must not off-by-one)', async () => {
    const fx1 = await makeRsaKey('kid-1');
    const fx2 = await makeRsaKey('kid-2');
    const exactly = { keys: [fx1.jwks.keys[0], fx2.jwks.keys[0]] };
    const fetchMock = jest.fn(async () => okBody(exactly));
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_MAX_KEYS: '2' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx1.privateKey, 'kid-1', { iss: 'x' });
    await expect(svc.verify(token, URI)).resolves.toBeDefined();
  });

  it('bounds cache cardinality, evicting the oldest entry', async () => {
    const fx = await makeRsaKey('kid-1');
    const fetchMock = jest.fn(async () => okBody(fx.jwks));
    const svc = new ExternalJwksValidatorService(
      makeConfig({ JWKS_MAX_CACHE_ENTRIES: '2' }),
      logger,
      fetchMock as any,
    );
    const token = await signRs256(fx.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, 'https://idp.example.com/a');
    await svc.verify(token, 'https://idp.example.com/b');
    await svc.verify(token, 'https://idp.example.com/c');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // /a was evicted when /c arrived, so it must be refetched rather than served
    // from cache. If cardinality were unbounded this would be a cache hit.
    await svc.verify(token, 'https://idp.example.com/a');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // /c is still cached and must NOT refetch.
    await svc.verify(token, 'https://idp.example.com/c');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

