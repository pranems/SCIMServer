import * as bcrypt from 'bcrypt';
import { EndpointCredentialAuthenticator } from './endpoint-credential.authenticator';
import { HASH_ALGO_HMAC_V1, mintCredentialToken } from '../../../security/credential-token';
import type { AuthContext } from './resource-authenticator';

/**
 * EndpointCredentialAuthenticator unit spec (W2.1). Proves the X9 not-applicable
 * fast-paths (a JWT / the global secret can never be a per-endpoint opaque
 * secret) fire BEFORE any bcrypt work, the enablement gate, an accept on a real
 * bcrypt match, and that a non-match is always not-applicable (never reject).
 */
describe('EndpointCredentialAuthenticator (W2.1)', () => {
  let credentialRepo: { findActiveByEndpoint: jest.Mock; findActiveByLookupKey: jest.Mock };
  let endpointService: { getEndpoint: jest.Mock };
  let logger: any;
  let auth: EndpointCredentialAuthenticator;

  const OPAQUE = 'opaque-per-endpoint-secret';
  const SECRET = 'the-global-secret';
  const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
    token: OPAQUE,
    request: {} as any,
    endpointId: 'ep-1',
    expectedSecret: SECRET,
    ...over,
  });
  const enabled = { profile: { settings: { SecretTokenBearerAuthEnabled: 'true' } } };

  beforeEach(() => {
    credentialRepo = {
      findActiveByEndpoint: jest.fn().mockResolvedValue([]),
      findActiveByLookupKey: jest.fn().mockResolvedValue(null),
    };
    endpointService = { getEndpoint: jest.fn().mockResolvedValue(enabled) };
    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), enrichContext: jest.fn() };
    auth = new EndpointCredentialAuthenticator(credentialRepo as any, endpointService as any, logger);
  });

  it('is ordered 10 with method endpoint_bearer', () => {
    expect(auth.order).toBe(10);
    expect(auth.method).toBe('endpoint_bearer');
  });

  it('not-applicable for a non-endpoint route (no endpointId)', async () => {
    const r = await auth.tryAuthenticate(ctx({ endpointId: null }));
    expect(r.outcome).toBe('not-applicable');
    expect(endpointService.getEndpoint).not.toHaveBeenCalled();
  });

  it('not-applicable when neither per-endpoint method is enabled', async () => {
    endpointService.getEndpoint.mockResolvedValue({ profile: { settings: {} } });
    const r = await auth.tryAuthenticate(ctx());
    expect(r.outcome).toBe('not-applicable');
    expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
  });

  it('X9 fast-path: not-applicable for a JWT WITHOUT touching bcrypt/the repo', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    const jwtLike = `${header}.${payload}.sig`;
    const r = await auth.tryAuthenticate(ctx({ token: jwtLike }));
    expect(r.outcome).toBe('not-applicable');
    expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
  });

  it('X9 fast-path: not-applicable when the token IS the global secret', async () => {
    const r = await auth.tryAuthenticate(ctx({ token: SECRET }));
    expect(r.outcome).toBe('not-applicable');
    expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
  });

  it('accepts on a real bcrypt match and stamps the request', async () => {
    const hash = await bcrypt.hash(OPAQUE, 4);
    credentialRepo.findActiveByEndpoint.mockResolvedValue([
      { id: 'cred-1', credentialType: 'bearer', credentialHash: hash, label: 'tok' },
    ]);
    const r = await auth.tryAuthenticate(ctx());
    expect(r.outcome).toBe('accept');
    const req: any = {};
    if (r.outcome === 'accept') r.apply?.(req);
    expect(req.authType).toBe('endpoint_credential');
    expect(req.authCredentialId).toBe('cred-1');
  });

  it('not-applicable (never reject) when no credential matches', async () => {
    const hash = await bcrypt.hash('a-different-secret', 4);
    credentialRepo.findActiveByEndpoint.mockResolvedValue([
      { id: 'cred-1', credentialType: 'bearer', credentialHash: hash, label: 'tok' },
    ]);
    const r = await auth.tryAuthenticate(ctx());
    expect(r.outcome).toBe('not-applicable');
  });

  /**
   * P1 - keyed lookup. See docs/auth/P1_KEYED_CREDENTIAL_LOOKUP_DESIGN.md.
   *
   * The assertions that matter are about WHICH repository method is called, not
   * merely that authentication succeeds. "It works" would also pass if the fast
   * path silently fell through to the O(N) bcrypt scan - which is the entire
   * defect this item exists to remove. So every test here asserts the scan was
   * NOT used.
   */
  describe('P1 - keyed lookup replaces the O(N) bcrypt scan', () => {
    it('P1-A1: a keyed token verifies via ONE lookup and never scans', async () => {
      const minted = mintCredentialToken();
      credentialRepo.findActiveByLookupKey.mockResolvedValue({
        id: 'cred-k', endpointId: 'ep-1', credentialType: 'bearer',
        hashAlgo: HASH_ALGO_HMAC_V1, secretHash: minted.secretHash, lookupKey: minted.lookupKey,
      });

      const r = await auth.tryAuthenticate(ctx({ token: minted.token }));

      expect(r.outcome).toBe('accept');
      expect(credentialRepo.findActiveByLookupKey).toHaveBeenCalledTimes(1);
      expect(credentialRepo.findActiveByLookupKey).toHaveBeenCalledWith(minted.lookupKey);
      expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
    });

    it('P1-A2: a wrong secret under a VALID key rejects without falling back to the scan', async () => {
      // The dangerous failure: verify fails, code "helpfully" retries the old
      // path, and the amplification is back with an extra DB read on top.
      const minted = mintCredentialToken();
      const other = mintCredentialToken();
      credentialRepo.findActiveByLookupKey.mockResolvedValue({
        id: 'cred-k', endpointId: 'ep-1', credentialType: 'bearer',
        hashAlgo: HASH_ALGO_HMAC_V1, secretHash: other.secretHash, lookupKey: minted.lookupKey,
      });

      const r = await auth.tryAuthenticate(ctx({ token: minted.token }));

      expect(r.outcome).toBe('not-applicable');
      expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
    });

    it('P1-A3: an UNKNOWN key does no HMAC and no scan', async () => {
      const minted = mintCredentialToken();
      credentialRepo.findActiveByLookupKey.mockResolvedValue(null);

      const r = await auth.tryAuthenticate(ctx({ token: minted.token }));

      expect(r.outcome).toBe('not-applicable');
      expect(credentialRepo.findActiveByLookupKey).toHaveBeenCalledTimes(1);
      expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
    });

    it('P1-A4: a keyed row belonging to ANOTHER endpoint is refused', async () => {
      // lookupKey is globally unique, so a stolen token must not authenticate
      // against a different endpoint just because the key resolves.
      const minted = mintCredentialToken();
      credentialRepo.findActiveByLookupKey.mockResolvedValue({
        id: 'cred-k', endpointId: 'ep-OTHER', credentialType: 'bearer',
        hashAlgo: HASH_ALGO_HMAC_V1, secretHash: minted.secretHash, lookupKey: minted.lookupKey,
      });

      const r = await auth.tryAuthenticate(ctx({ token: minted.token }));

      expect(r.outcome).toBe('not-applicable');
      expect(credentialRepo.findActiveByEndpoint).not.toHaveBeenCalled();
    });

    it('P1-A5: LEGACY tokens still verify via the bcrypt scan (the migration promise)', async () => {
      // The whole migration rests on this: existing credentials keep working.
      const hash = await bcrypt.hash(OPAQUE, 4);
      credentialRepo.findActiveByEndpoint.mockResolvedValue([
        { id: 'cred-1', credentialType: 'bearer', credentialHash: hash, hashAlgo: 'bcrypt' },
      ]);

      const r = await auth.tryAuthenticate(ctx({ token: OPAQUE }));

      expect(r.outcome).toBe('accept');
      expect(credentialRepo.findActiveByLookupKey).not.toHaveBeenCalled();
    });

    it('P1-A6: the legacy scan SKIPS rows already migrated to HMAC', async () => {
      // Behavioural, not a spy: the row carries a REAL bcrypt hash of the
      // presented token, so it WOULD match if the scan considered it. Requiring
      // not-applicable proves the skip fired, without depending on bcrypt being
      // mockable (it is lazy-loaded and cached, so a spy cannot bind).
      const hash = await bcrypt.hash(OPAQUE, 4);
      credentialRepo.findActiveByEndpoint.mockResolvedValue([
        { id: 'cred-new', credentialType: 'bearer', credentialHash: hash, hashAlgo: HASH_ALGO_HMAC_V1 },
      ]);

      const r = await auth.tryAuthenticate(ctx({ token: OPAQUE }));

      expect(r.outcome).toBe('not-applicable');
    });

    it('P1-A7: NEGATIVE CONTROL - the same row WITHOUT the migrated marker does match', async () => {
      // Proves A6 passes because of the hashAlgo skip, not because the fixture
      // was broken in some other way.
      const hash = await bcrypt.hash(OPAQUE, 4);
      credentialRepo.findActiveByEndpoint.mockResolvedValue([
        { id: 'cred-old', credentialType: 'bearer', credentialHash: hash, hashAlgo: 'bcrypt' },
      ]);

      const r = await auth.tryAuthenticate(ctx({ token: OPAQUE }));

      expect(r.outcome).toBe('accept');
    });
  });
});
