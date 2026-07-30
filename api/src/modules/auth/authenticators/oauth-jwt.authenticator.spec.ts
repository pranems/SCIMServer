import { OAuthJwtAuthenticator, mapBearerJwtErrorToReason } from './oauth-jwt.authenticator';
import type { AuthContext } from './resource-authenticator';

/**
 * OAuthJwtAuthenticator unit spec (W2.1). Proves the three-outcome contract,
 * especially the REJECT-STOP for an endpoint-scoped token presented to the
 * wrong endpoint (the downgrade-confusion defense) - it must reject, never
 * fall through.
 */
describe('OAuthJwtAuthenticator (W2.1)', () => {
  let oauthService: { validateAccessToken: jest.Mock };
  let logger: any;
  let auth: OAuthJwtAuthenticator;

  const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
    token: 'a.b.c',
    request: {} as any,
    endpointId: 'ep-1',
    expectedSecret: 'the-secret',
    ...over,
  });

  beforeEach(() => {
    oauthService = { validateAccessToken: jest.fn() };
    logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), enrichContext: jest.fn() };
    auth = new OAuthJwtAuthenticator(oauthService as any, logger);
  });

  it('is ordered 20 with method bearer_jwt', () => {
    expect(auth.order).toBe(20);
    expect(auth.method).toBe('bearer_jwt');
  });

  it('not-applicable when the token IS the global secret (legacy acceptor handles it)', async () => {
    const r = await auth.tryAuthenticate(ctx({ token: 'the-secret' }));
    expect(r.outcome).toBe('not-applicable');
    expect(oauthService.validateAccessToken).not.toHaveBeenCalled();
  });

  it('not-applicable + fallthroughReason when the JWT is expired', async () => {
    oauthService.validateAccessToken.mockRejectedValue({ code: 'ERR_JWT_EXPIRED' });
    const r = await auth.tryAuthenticate(ctx());
    expect(r.outcome).toBe('not-applicable');
    if (r.outcome === 'not-applicable') expect(r.fallthroughReason).toBe('bearer_oauth_expired');
  });

  it('REJECT-STOP when a valid token is scoped to a DIFFERENT endpoint (downgrade defense)', async () => {
    oauthService.validateAccessToken.mockResolvedValue({ endpoint_id: 'ep-OTHER', client_id: 'c' });
    const r = await auth.tryAuthenticate(ctx({ endpointId: 'ep-1' }));
    expect(r.outcome).toBe('reject');
    if (r.outcome === 'reject') {
      expect(r.reasonCode).toBe('bearer_token_scoped_other_endpoint');
      expect(r.errorCode).toBe('invalid_token');
    }
  });

  it('accepts a valid endpoint-scoped token and stamps the request via apply', async () => {
    oauthService.validateAccessToken.mockResolvedValue({ endpoint_id: 'ep-1', client_id: 'client-x' });
    const r = await auth.tryAuthenticate(ctx({ endpointId: 'ep-1' }));
    expect(r.outcome).toBe('accept');
    const req: any = {};
    if (r.outcome === 'accept') r.apply?.(req);
    expect(req.authType).toBe('oauth');
    expect(req.oauth.client_id).toBe('client-x');
  });

  it('accepts a valid GLOBAL token (no endpoint_id claim)', async () => {
    oauthService.validateAccessToken.mockResolvedValue({ client_id: 'client-g' });
    const r = await auth.tryAuthenticate(ctx({ endpointId: null }));
    expect(r.outcome).toBe('accept');
  });

  describe('mapBearerJwtErrorToReason', () => {
    it('maps expiry + signature codes, undefined otherwise', () => {
      expect(mapBearerJwtErrorToReason({ code: 'ERR_JWT_EXPIRED' })).toBe('bearer_oauth_expired');
      expect(mapBearerJwtErrorToReason({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })).toBe('bearer_oauth_signature_invalid');
      expect(mapBearerJwtErrorToReason({ code: 'ERR_JWKS_NO_MATCHING_KEY' })).toBe('bearer_oauth_signature_invalid');
      expect(mapBearerJwtErrorToReason(new Error('random'))).toBeUndefined();
    });
  });
});
