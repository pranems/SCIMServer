import * as bcrypt from 'bcrypt';
import { EndpointCredentialAuthenticator } from './endpoint-credential.authenticator';
import type { AuthContext } from './resource-authenticator';

/**
 * EndpointCredentialAuthenticator unit spec (W2.1). Proves the X9 not-applicable
 * fast-paths (a JWT / the global secret can never be a per-endpoint opaque
 * secret) fire BEFORE any bcrypt work, the enablement gate, an accept on a real
 * bcrypt match, and that a non-match is always not-applicable (never reject).
 */
describe('EndpointCredentialAuthenticator (W2.1)', () => {
  let credentialRepo: { findActiveByEndpoint: jest.Mock };
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
    credentialRepo = { findActiveByEndpoint: jest.fn().mockResolvedValue([]) };
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
});
