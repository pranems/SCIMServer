import { GlobalSharedSecretAuthenticator } from './global-shared-secret.authenticator';
import type { AuthContext } from './resource-authenticator';

/**
 * GlobalSharedSecretAuthenticator unit spec (W2.1). Proves accept on match, the
 * WI-11 REJECT-STOP when the endpoint refuses the global secret, not-applicable
 * on mismatch, and fail-open on a lookup error.
 */
describe('GlobalSharedSecretAuthenticator (W2.1)', () => {
  let endpointService: { getEndpoint: jest.Mock };
  let logger: any;
  let auth: GlobalSharedSecretAuthenticator;

  const SECRET = 'the-global-secret';
  const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
    token: SECRET,
    request: {} as any,
    endpointId: null,
    expectedSecret: SECRET,
    ...over,
  });

  const endpoint = (settings: Record<string, unknown>) => ({ profile: { settings } });

  beforeEach(() => {
    endpointService = { getEndpoint: jest.fn().mockResolvedValue(endpoint({})) };
    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), enrichContext: jest.fn() };
    auth = new GlobalSharedSecretAuthenticator(endpointService as any, logger);
  });

  it('is ordered 30 with method shared_secret', () => {
    expect(auth.order).toBe(30);
    expect(auth.method).toBe('shared_secret');
  });

  it('accepts on a match for a global (non-endpoint) route and stamps authType=legacy', async () => {
    const r = await auth.tryAuthenticate(ctx({ endpointId: null }));
    expect(r.outcome).toBe('accept');
    const req: any = {};
    if (r.outcome === 'accept') r.apply?.(req);
    expect(req.authType).toBe('legacy');
  });

  it('accepts on a match for an endpoint that allows the global secret (default true)', async () => {
    endpointService.getEndpoint.mockResolvedValue(endpoint({}));
    const r = await auth.tryAuthenticate(ctx({ endpointId: 'ep-1' }));
    expect(r.outcome).toBe('accept');
  });

  it('REJECT-STOP when the endpoint sets SharedSecretBearerAuthEnabled=false (WI-11)', async () => {
    endpointService.getEndpoint.mockResolvedValue(endpoint({ SharedSecretBearerAuthEnabled: 'false' }));
    const r = await auth.tryAuthenticate(ctx({ endpointId: 'ep-1' }));
    expect(r.outcome).toBe('reject');
    if (r.outcome === 'reject') {
      expect(r.reasonCode).toBe('bearer_shared_secret_refused');
      expect(r.errorCode).toBe('invalid_token');
    }
  });

  it('not-applicable when the token does not match the global secret', async () => {
    const r = await auth.tryAuthenticate(ctx({ token: 'something-else' }));
    expect(r.outcome).toBe('not-applicable');
  });

  it('fails OPEN (accept) on a lookup error - the secret still had to match', async () => {
    endpointService.getEndpoint.mockRejectedValue(new Error('db down'));
    const r = await auth.tryAuthenticate(ctx({ endpointId: 'ep-1' }));
    expect(r.outcome).toBe('accept');
  });
});
