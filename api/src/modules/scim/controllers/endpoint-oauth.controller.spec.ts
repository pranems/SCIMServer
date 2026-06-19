import { HttpException } from '@nestjs/common';
import { EndpointOAuthController } from './endpoint-oauth.controller';

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
} = {}) {
  const oauthService: any = {
    generateEndpointAccessToken: jest.fn().mockResolvedValue({ accessToken: 'secret-path-token', expiresIn: 3600, scope: 'scim.read' }),
  };
  const credentialRepo: any = {
    findActiveByEndpoint: jest.fn().mockResolvedValue(opts.credentials ?? []),
  };
  const controller = new EndpointOAuthController(
    oauthService,
    credentialRepo,
    logger,
    opts.assertionProvider ?? null,
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

    expect(assertionProvider.mintFromAssertion).toHaveBeenCalledWith(ENDPOINT_ID, 'eyJhbGciOiJSUzI1NiJ9.payload.sig');
    expect(oauthService.generateEndpointAccessToken).not.toHaveBeenCalled();
    expect(res.access_token).toBe('wif-token');
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
});
