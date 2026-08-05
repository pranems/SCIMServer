/**
 * W1.4 unit tests - Entra-aligned JWKS cache: 24h TTL, background refresh,
 * rate-limited unknown-kid refetch, hard stale ceiling, Cache-Control honoring,
 * and SSRF-rejection non-stale-eligibility.
 *
 * These are written RED-first (Stage 0). Every one of them must FAIL against
 * the pre-W1.4 service, because each asserts a behaviour that does not exist
 * yet. If any passes before the implementation lands it is testing something
 * other than W1.4 - see RCA I-30, where four assertions passed against a build
 * with none of the feature in it.
 */
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { exportJWK, SignJWT, importJWK } from 'jose';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { EGRESS_POLICY_DEFAULTS } from './egress-policy';

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

interface KeyFixture {
  kid: string;
  privateKey: crypto.KeyObject;
  jwk: Record<string, unknown>;
}

async function makeRsaKey(kid: string): Promise<KeyFixture> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = (await exportJWK(publicKey)) as unknown as Record<string, unknown>;
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { kid, privateKey, jwk };
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

/** A fetch double that returns whatever key set the test currently points it at. */
function makeFetch(state: { jwks: { keys: Record<string, unknown>[] }; cacheControl?: string }) {
  return jest.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    headers: {
      get: (h: string) =>
        h.toLowerCase() === 'cache-control' ? (state.cacheControl ?? null) : null,
    },
    text: async () => JSON.stringify(state.jwks),
    json: async () => state.jwks,
  }));
}

const URI = 'https://login.microsoftonline.com/tid/discovery/v2.0/keys';

describe('W1.4 - Entra-aligned JWKS cache', () => {
  let nowSpy: jest.SpyInstance | undefined;
  let clock = 1_700_000_000_000;

  const advance = (ms: number) => {
    clock += ms;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clock = 1_700_000_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  afterEach(() => {
    nowSpy?.mockRestore();
  });

  // ─── Defaults ────────────────────────────────────────────────────────

  it('W1.4-T1: the default cache TTL is 24 hours, matching Microsoft guidance', () => {
    expect(EGRESS_POLICY_DEFAULTS.cacheMaxAgeMs).toBe(86_400_000);
  });

  it('W1.4-T2: the new refresh / unknown-kid / stale-ceiling knobs have Entra-aligned defaults', () => {
    // 1h background refresh, 5-min unknown-kid rate limit, 48h hard stale ceiling.
    expect(EGRESS_POLICY_DEFAULTS.refreshIntervalMs).toBe(3_600_000);
    expect(EGRESS_POLICY_DEFAULTS.unknownKidMinIntervalMs).toBe(300_000);
    expect(EGRESS_POLICY_DEFAULTS.staleIfErrorMs).toBe(172_800_000);
  });

  // ─── The hard constraint: overlap-window key rotation ────────────────

  it('W1.4-T3: OVERLAP WINDOW - during rotation BOTH the retiring and the new key verify', async () => {
    // This is the test the delivery plan makes a hard precondition of raising
    // the TTL from 10 min to 24 h: a 144x longer TTL multiplies the blast
    // radius of getting rotation wrong, so rotation correctness must be locked.
    const oldKey = await makeRsaKey('kid-old');
    const newKey = await makeRsaKey('kid-new');

    // Phase 1: the IdP publishes only the old key.
    const state = { jwks: { keys: [oldKey.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    const oldToken = await signRs256(oldKey.privateKey, 'kid-old', { iss: 'x' });
    await expect(svc.verify(oldToken, URI)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Phase 2: the IdP enters the overlap window - BOTH keys are published.
    state.jwks = { keys: [oldKey.jwk, newKey.jwk] };

    // A token with the NEW kid is not in the cached set, so it must trigger a
    // synchronous refetch and then verify.
    const newToken = await signRs256(newKey.privateKey, 'kid-new', { iss: 'x' });
    await expect(svc.verify(newToken, URI)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The retiring key MUST still verify from the refreshed set - this is the
    // property that makes the overlap window safe. A cache that replaced
    // rather than merged, or that keyed only on the newest kid, breaks here.
    await expect(svc.verify(oldToken, URI)).resolves.toBeDefined();
    // ...and must do so from cache, with no additional fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── Unknown-kid refetch is rate limited ─────────────────────────────

  it('W1.4-T4: an unknown kid triggers ONE refetch, then is rate-limited for the window', async () => {
    // Without this limit, a caller presenting an unknown kid forces an outbound
    // fetch on EVERY request - an amplification vector against the IdP that the
    // caller controls for free.
    const known = await makeRsaKey('kid-known');
    const unknown = await makeRsaKey('kid-unknown');
    const state = { jwks: { keys: [known.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    const knownToken = await signRs256(known.privateKey, 'kid-known', { iss: 'x' });
    await svc.verify(knownToken, URI);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const unknownToken = await signRs256(unknown.privateKey, 'kid-unknown', { iss: 'x' });

    // First unknown-kid attempt: refetch is allowed (the key may have rotated).
    await expect(svc.verify(unknownToken, URI)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Subsequent attempts inside the window must NOT hit the network again.
    await expect(svc.verify(unknownToken, URI)).rejects.toThrow();
    await expect(svc.verify(unknownToken, URI)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Non-vacuity: a token whose kid IS cached still verifies from cache
    // throughout, so the rate limit is not simply breaking all verification.
    await expect(svc.verify(knownToken, URI)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Past the window the next unknown kid is allowed to refetch again, so a
    // genuine rotation is still picked up promptly.
    advance(EGRESS_POLICY_DEFAULTS.unknownKidMinIntervalMs + 1);
    state.jwks = { keys: [known.jwk, unknown.jwk] };
    await expect(svc.verify(unknownToken, URI)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ─── Hard stale ceiling ──────────────────────────────────────────────

  it('W1.4-T5: fail-to-stale serves cached keys during an outage, but ONLY inside the ceiling', async () => {
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);

    // The IdP goes down. Past the TTL the service must refetch, fail, and then
    // fall back to the cached copy - availability over freshness, deliberately.
    fetchMock.mockRejectedValue(new Error('network down'));
    advance(EGRESS_POLICY_DEFAULTS.cacheMaxAgeMs + 1);
    await expect(svc.verify(token, URI)).resolves.toBeDefined();

    // But that fallback is NOT unbounded. Past the hard stale ceiling the
    // cached key is no longer acceptable and the service fails closed. Before
    // W1.4 this path had no age test at all, so a revoked key stayed valid for
    // as long as the IdP was unreachable.
    advance(EGRESS_POLICY_DEFAULTS.staleIfErrorMs);
    await expect(svc.verify(token, URI)).rejects.toThrow(/stale|expired|closed/i);
  });

  // ─── Cache-Control ───────────────────────────────────────────────────

  it('W1.4-T6: a shorter Cache-Control max-age wins over the configured TTL', async () => {
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] }, cacheControl: 'public, max-age=60' };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Inside the 60s the IdP advertised: still a cache hit.
    advance(30_000);
    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past 60s: must refetch, even though the configured TTL is 24 hours.
    // maxAge = min(configured, Cache-Control) - the IdP is allowed to ask for
    // a SHORTER cache, never a longer one.
    advance(31_000);
    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('W1.4-T7: a LONGER Cache-Control max-age cannot extend the configured TTL', async () => {
    const key = await makeRsaKey('kid-1');
    // 30 days - far beyond our 24h ceiling. An IdP must not be able to pin
    // keys in our cache for longer than we chose to trust them.
    const state = { jwks: { keys: [key.jwk] }, cacheControl: 'max-age=2592000' };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);
    advance(EGRESS_POLICY_DEFAULTS.cacheMaxAgeMs + 1);
    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── SSRF rejection is not stale-eligible (RCA 10.2) ─────────────────

  it('W1.4-T8: an allowlist revocation is NOT stale-eligible, while a network failure is', async () => {
    // RCA 10.2 open question, resolved here. Serving stale keys through a real
    // outage is an availability property worth keeping. Serving them after the
    // operator has REVOKED the host is not - that turns a security action into
    // a no-op for up to the full cache lifetime, which the 10-min -> 24h TTL
    // raise would have widened by 144x.
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] } };
    const fetchMock = makeFetch(state);

    const allowlist = { isAllowed: jest.fn().mockReturnValue(true) };
    const svc = new ExternalJwksValidatorService(
      makeConfig(),
      logger,
      fetchMock as any,
      allowlist as any,
    );
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);

    // Control: a plain network outage past the TTL still serves stale.
    fetchMock.mockRejectedValue(new Error('network down'));
    advance(EGRESS_POLICY_DEFAULTS.cacheMaxAgeMs + 1);
    await expect(svc.verify(token, URI)).resolves.toBeDefined();

    // Now the operator revokes the host. The cached keys must STOP being
    // acceptable immediately, not at the end of the cache lifetime.
    allowlist.isAllowed.mockReturnValue(false);
    await expect(svc.verify(token, URI)).rejects.toThrow(/not permitted|allowlist/i);
  });

  // ─── Background refresh ──────────────────────────────────────────────

  it('W1.4-T9: the background refresh re-fetches an ageing entry with no request on the hot path', async () => {
    // The point of the whole item: the steady-state hot path is ALWAYS a cache
    // hit. Before W1.4 every TTL expiry put a synchronous outbound fetch on a
    // user's token mint.
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Age the entry past the refresh interval but well inside the 24h TTL,
    // then run one refresh sweep.
    advance(EGRESS_POLICY_DEFAULTS.refreshIntervalMs + 1);
    await svc.refreshCachedJwksNow();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // The refresh happened off the hot path: this verify is still a cache hit.
    await svc.verify(token, URI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('W1.4-T10: the refresh sweep skips entries that are younger than the refresh interval', async () => {
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);
    advance(EGRESS_POLICY_DEFAULTS.refreshIntervalMs - 1_000);
    await svc.refreshCachedJwksNow();
    // Non-vacuous counterpart to T9: if the sweep refetched unconditionally,
    // T9 would pass for the wrong reason.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('W1.4-T11: a failing background refresh is non-fatal and leaves the cached keys usable', async () => {
    const key = await makeRsaKey('kid-1');
    const state = { jwks: { keys: [key.jwk] } };
    const fetchMock = makeFetch(state);
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);
    const token = await signRs256(key.privateKey, 'kid-1', { iss: 'x' });

    await svc.verify(token, URI);
    fetchMock.mockRejectedValue(new Error('idp down'));
    advance(EGRESS_POLICY_DEFAULTS.refreshIntervalMs + 1);

    // Must not throw - a background sweep that rejects would surface as an
    // unhandled rejection and could take the process down.
    await expect(svc.refreshCachedJwksNow()).resolves.toBeUndefined();

    // And the still-valid cached keys keep working.
    await expect(svc.verify(token, URI)).resolves.toBeDefined();
  });

  it('W1.4-T12: the refresh timer is started on init and cleared on destroy', async () => {
    // A leaked interval keeps the Jest worker alive ("failed to exit
    // gracefully") and, in production, keeps a dead module fetching.
    const key = await makeRsaKey('kid-1');
    const fetchMock = makeFetch({ jwks: { keys: [key.jwk] } });
    const svc = new ExternalJwksValidatorService(makeConfig(), logger, fetchMock as any);

    await svc.onModuleInit();
    expect(svc.hasRefreshTimer()).toBe(true);

    // onModuleDestroy is synchronous - clearing an interval has nothing to wait
    // on, and awaiting a non-Promise would be a lie about the contract.
    svc.onModuleDestroy();
    expect(svc.hasRefreshTimer()).toBe(false);
  });
});
