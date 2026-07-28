/**
 * W2.3 - ClientSecretTokenProvider unit tests.
 *
 * The provider owns the credential lookup + bcrypt verification + mint that was
 * inlined in the controller. These lock the three-outcome result + the per-check
 * trace (never the secret value) without a NestJS testing module.
 */
import { ClientSecretTokenProvider } from './client-secret-token-provider';

const ENDPOINT_ID = '11111111-1111-1111-1111-111111111111';

function makeProvider(credentials: unknown[] = []) {
  const oauthService: any = {
    generateEndpointAccessToken: jest
      .fn()
      .mockResolvedValue({ accessToken: 'tok', expiresIn: 3600, scope: 'scim.read' }),
  };
  const credentialRepo: any = {
    findActiveByEndpoint: jest.fn().mockResolvedValue(credentials),
  };
  return { provider: new ClientSecretTokenProvider(credentialRepo, oauthService), oauthService, credentialRepo };
}

describe('ClientSecretTokenProvider (W2.3)', () => {
  it('accepts a matching client_id + secret and mints a token', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right', 4);
    const { provider, oauthService } = makeProvider([
      { credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } },
    ]);

    const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
      clientId: 'epc_x',
      clientSecret: 'right',
      credentialLocation: 'client_secret_post',
      scope: 'scim.read',
    });

    expect(res.outcome).toBe('accept');
    if (res.outcome === 'accept') {
      expect(res.token.accessToken).toBe('tok');
      expect(res.checks.find((c) => c.id === 'secret_match')?.status).toBe('pass');
      expect(res.checks.find((c) => c.id === 'credential_location')?.received).toBe('client_secret_post');
    }
    expect(oauthService.generateEndpointAccessToken).toHaveBeenCalledWith(
      ENDPOINT_ID,
      'epc_x',
      'scim.read',
      // W3.8 - the mint is tagged with the profile that authorized it.
      expect.objectContaining({ authMethod: 'client_secret' }),
    );
  });

  it('rejects when no oauth_client credential matches the client_id', async () => {
    const { provider, oauthService } = makeProvider([]);
    const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
      clientId: 'epc_missing',
      clientSecret: 'x',
      credentialLocation: 'client_secret_basic',
    });
    expect(res.outcome).toBe('reject');
    if (res.outcome === 'reject') {
      expect(res.reasonCode).toBe('oauth_client_auth_failed');
      expect(res.checks.find((c) => c.id === 'client_found')?.status).toBe('fail');
    }
    expect(oauthService.generateEndpointAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret (client found, secret mismatch) and never echoes the secret', async () => {
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash('right', 4);
    const { provider } = makeProvider([
      { credentialType: 'oauth_client', credentialHash: hash, metadata: { clientId: 'epc_x' } },
    ]);
    const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
      clientId: 'epc_x',
      clientSecret: 'wrong-secret',
      credentialLocation: 'client_secret_post',
    });
    expect(res.outcome).toBe('reject');
    if (res.outcome === 'reject') {
      expect(res.checks.find((c) => c.id === 'client_found')?.status).toBe('pass');
      expect(res.checks.find((c) => c.id === 'secret_match')?.status).toBe('fail');
      expect(JSON.stringify(res.checks)).not.toContain('wrong-secret');
    }
  });
});
