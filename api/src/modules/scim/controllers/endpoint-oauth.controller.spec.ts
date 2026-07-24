import { HttpException } from '@nestjs/common';
import { EndpointOAuthController } from './endpoint-oauth.controller';
import { ClientSecretTokenProvider } from './client-secret-token-provider';

/**
 * A3 - per-endpoint token-endpoint routing cascade unit tests.
 *
 * The token endpoint self-describes the credential by request shape:
 *  - `client_assertion` present -> dispatch to the assertion provider (WIF), NOT
 *    the client_secret path.
 *  - both `client_assertion` and `client_secret` -> invalid_request (ambiguous).
 *  - `client_assertion_type` must be the jwt-bearer URN.
 */
const ENDPOINT_ID = '11111111-1111-1111-1111-111111111111';
const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

const logger: any = { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn(), trace: jest.fn() };

function makeController(opts: {
  assertionProvider?: { mintFromAssertion: jest.Mock };
  credentials?: any[];
  decisionStore?: any;
  endpointService?: any;
} = {}) {
  const oauthService: any = {
    generateEndpointAccessToken: jest.fn().mockResolvedValue({ accessToken: 'secret-path-token', expiresIn: 3600, scope: 'scim.read' }),
  };
  const credentialRepo: any = {
    findActiveByEndpoint: jest.fn().mockResolvedValue(opts.credentials ?? []),
  };
  // W2.3 - the controller delegates the client_secret mint to the real provider,
  // constructed here with the mock repo + oauthService so the existing setup
  // (credentials + secrets) still drives the mint through the extracted logic.
  const clientSecretProvider = new ClientSecretTokenProvider(credentialRepo, oauthService);
  const controller = new EndpointOAuthController(
    clientSecretProvider,
    logger,
    opts.assertionProvider ?? null,
    opts.decisionStore ?? null,
    opts.endpointService ?? null,
  );
  return { controller, oauthService, credentialRepo };
}

async function expectStatus(promise: Promise<unknown>, status: number, error?: string) {
  try {
    await promise;
    throw new Error('expected an HttpException');
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const ex = e as HttpException;
    expect(ex.getStatus()).toBe(status);
    if (error) expect((ex.getResponse() as { error: string }).error).toBe(error);
  }
}

describe('EndpointOAuthController routing cascade (A3)', () => {
  it('dispatches a client_assertion request to the assertion provider, NOT the secret path', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn().mockResolvedValue({ accessToken: 'wif-token', expiresIn: 3600, scope: 'scim.read' }) };
    const { controller, oauthService } = makeController({ assertionProvider });

    const res = await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_assertion: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
      client_assertion_type: JWT_BEARER,
    });

    expect(assertionProvider.mintFromAssertion).toHaveBeenCalledWith(ENDPOINT_ID, 'eyJhbGciOiJSUzI1NiJ9.payload.sig', undefined);
    expect(oauthService.generateEndpointAccessToken).not.toHaveBeenCalled();
    expect(res.access_token).toBe('wif-token');
  });

  it('W3.4: threads the RFC 8707 resource form parameter to the assertion provider', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn().mockResolvedValue({ accessToken: 'wif-token', expiresIn: 3600, scope: 'scim.read' }) };
    const { controller } = makeController({ assertionProvider });

    await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_assertion: 'eyJhbGciOiJSUzI1NiJ9.payload.sig',
      client_assertion_type: JWT_BEARER,
      resource: 'https://api.successfactors.com',
    });

    expect(assertionProvider.mintFromAssertion).toHaveBeenCalledWith(
      ENDPOINT_ID,
      'eyJhbGciOiJSUzI1NiJ9.payload.sig',
      'https://api.successfactors.com',
    );
  });

  it('rejects a body carrying BOTH client_assertion and client_secret with invalid_request', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn() };
    const { controller, oauthService } = makeController({ assertionProvider });

    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_id: 'epc_x',
        client_secret: 's',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
      }),
      400,
      'invalid_request',
    );
    expect(assertionProvider.mintFromAssertion).not.toHaveBeenCalled();
    expect(oauthService.generateEndpointAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a wrong client_assertion_type with invalid_request', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn() };
    const { controller } = makeController({ assertionProvider });

    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: 'urn:bogus',
      }),
      400,
      'invalid_request',
    );
    expect(assertionProvider.mintFromAssertion).not.toHaveBeenCalled();
  });

  it('returns invalid_client when no assertion provider is wired (A3 default until Q6)', async () => {
    const { controller } = makeController({ assertionProvider: undefined });
    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
      }),
      401,
      'invalid_client',
    );
  });

  it('returns invalid_client (mine-but-invalid-stop) when the provider throws', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn().mockRejectedValue(new Error('bad sig')) };
    const { controller } = makeController({ assertionProvider });
    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
      }),
      401,
      'invalid_client',
    );
  });

  it('returns invalid_client (not-mine-continue with no other credential) when the provider returns null', async () => {
    const assertionProvider = { mintFromAssertion: jest.fn().mockResolvedValue(null) };
    const { controller } = makeController({ assertionProvider });
    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_assertion: 'a.b.c',
        client_assertion_type: JWT_BEARER,
      }),
      401,
      'invalid_client',
    );
  });

  it('still routes a client_secret request down the oauth_client (secret) path', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right-secret', 4);
    const { controller, oauthService } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } }],
    });

    const res = await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_id: 'epc_x',
      client_secret: 'right-secret',
    });
    expect(oauthService.generateEndpointAccessToken).toHaveBeenCalledWith(ENDPOINT_ID, 'epc_x', undefined);
    expect(res.access_token).toBe('secret-path-token');
  });

  // W2.5 - mint plane consults the unified per-method enablement source in SHADOW.
  it('W2.5 shadow: still MINTS when oauth_client is disabled (non-blocking) and warns', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right-secret', 4);
    logger.warn.mockClear();
    // Endpoint whose oauth_client method is explicitly disabled (disabled-with-credential).
    const endpointService: any = {
      getEndpoint: jest.fn().mockResolvedValue({
        id: ENDPOINT_ID,
        profile: { settings: {}, authentication: { methods: [{ type: 'oauth-client', enabled: false }] } },
      }),
    };
    const { controller, oauthService } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } }],
      endpointService,
    });
    const res = await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_id: 'epc_x',
      client_secret: 'right-secret',
    });
    // Shadow does NOT block: the token is still minted.
    expect(oauthService.generateEndpointAccessToken).toHaveBeenCalled();
    expect(res.access_token).toBe('secret-path-token');
    // A shadow warning was logged (message is the 2nd arg to logger.warn).
    expect(
      logger.warn.mock.calls.some((c: unknown[]) => String(c[1]).includes('W2.5 shadow')),
    ).toBe(true);
    expect(endpointService.getEndpoint).toHaveBeenCalledWith(ENDPOINT_ID);
  });

  it('W2.5 shadow: an endpoint lookup error never blocks a mint (fails open)', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right-secret', 4);
    const endpointService: any = {
      getEndpoint: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const { controller, oauthService } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } }],
      endpointService,
    });
    const res = await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_id: 'epc_x',
      client_secret: 'right-secret',
    });
    expect(res.access_token).toBe('secret-path-token');
    expect(oauthService.generateEndpointAccessToken).toHaveBeenCalled();
  });

  it('WI-D4: emits exactly one AUTH decision event (accept) on a successful oauth_client mint', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right-secret', 4);
    logger.info.mockClear();
    const { controller } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } }],
    });
    await controller.getToken(ENDPOINT_ID, {
      grant_type: 'client_credentials',
      client_id: 'epc_x',
      client_secret: 'right-secret',
    });
    const events = logger.info.mock.calls.filter((c: unknown[]) => c[1] === 'Auth decision');
    expect(events).toHaveLength(1);
    expect(events[0][2]).toEqual(
      expect.objectContaining({ outcome: 'accept', method: 'oauth_client', endpointId: ENDPOINT_ID }),
    );
    // Phase 1: the accept decision now carries per-step checks (grant_type,
    // credential_location, client_id_present, client_found, secret_match,
    // token_ttl), not an empty checks array.
    expect((events[0][2] as { checkCount: number }).checkCount).toBeGreaterThanOrEqual(6);
  });

  it('WI-D4: emits exactly one AUTH decision event (reject, merged reason) on a wrong secret', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right-secret', 4);
    logger.warn.mockClear();
    const { controller } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } }],
    });
    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_id: 'epc_x',
        client_secret: 'wrong-secret',
      }),
      401,
      'invalid_client',
    );
    const events = logger.warn.mock.calls.filter((c: unknown[]) => c[1] === 'Auth decision');
    expect(events).toHaveLength(1);
    expect(events[0][2]).toEqual(
      expect.objectContaining({ outcome: 'reject', method: 'oauth_client', reasonCode: 'oauth_client_auth_failed' }),
    );
    // Phase 1: the reject decision names WHICH check failed (secret_match) so
    // the diagnostics table + failedChecks explain the "why", not just a code.
    expect((events[0][2] as { failedChecks: string[] }).failedChecks).toContain('secret_match');
  });

  it('Phase 1: an UNKNOWN client_id reject names client_found as the failed check', async () => {
    logger.warn.mockClear();
    const { controller } = makeController({
      credentials: [{ credentialType: 'oauth_client', credentialHash: 'x', metadata: { clientId: 'epc_real' } }],
    });
    await expectStatus(
      controller.getToken(ENDPOINT_ID, {
        grant_type: 'client_credentials',
        client_id: 'epc_does_not_exist',
        client_secret: 'whatever',
      }),
      401,
      'invalid_client',
    );
    const events = logger.warn.mock.calls.filter((c: unknown[]) => c[1] === 'Auth decision');
    expect(events).toHaveLength(1);
    const failed = (events[0][2] as { failedChecks: string[] }).failedChecks;
    expect(failed).toContain('client_found');
    expect(failed).toContain('secret_match');
  });
});
