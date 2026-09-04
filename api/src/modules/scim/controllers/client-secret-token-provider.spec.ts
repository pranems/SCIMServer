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

  // ── P6: parallel credentials during a migration ────────────────────────────
  //
  // Every oauth_client credential on an endpoint shares one clientId
  // (`client-id-<endpointId>`), so selecting the candidate with `.find()` meant
  // only ONE could ever authenticate. The P2 caps allow five, and a live estate
  // already had two active - so the second was dead weight that looked healthy
  // in the UI, and `findActiveByEndpoint` has no `orderBy`, leaving which one
  // wins unspecified on Postgres.
  //
  // This blocks the only zero-downtime migration path there is: issue the new
  // keyed secret alongside the old one, let the integration owner switch at
  // their convenience, then retire the old.
  describe('P6 - more than one credential under the same clientId', () => {
    const CID = 'client-id-11111111-1111-1111-1111-111111111111';

    it('P6-T1: a legacy secret still authenticates when a KEYED credential was added alongside it', async () => {
      const bcrypt = require('bcrypt');
      const { mintOAuthClientSecret } = require('../../../security/credential-token');
      const minted = mintOAuthClientSecret();
      const legacyHash = await bcrypt.hash('client-secret-legacy-uuid', 4);

      // Keyed row FIRST, so `.find()` would select it and never try the legacy one.
      const { provider } = makeProvider([
        {
          credentialType: 'oauth_client',
          credentialHash: 'p1-keyed-see-secretHash',
          hashAlgo: 'hmac-sha256-v1',
          lookupKey: minted.lookupKey,
          secretHash: minted.secretHash,
          metadata: { clientId: CID },
        },
        { credentialType: 'oauth_client', credentialHash: legacyHash, metadata: { clientId: CID } },
      ]);

      const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
        clientId: CID,
        clientSecret: 'client-secret-legacy-uuid',
        credentialLocation: 'client_secret_post',
      });

      expect(res.outcome).toBe('accept');
    });

    it('P6-T2: the NEW keyed secret authenticates when the legacy row is listed first', async () => {
      const bcrypt = require('bcrypt');
      const { mintOAuthClientSecret } = require('../../../security/credential-token');
      const minted = mintOAuthClientSecret();
      const legacyHash = await bcrypt.hash('client-secret-legacy-uuid', 4);

      const { provider } = makeProvider([
        { credentialType: 'oauth_client', credentialHash: legacyHash, metadata: { clientId: CID } },
        {
          credentialType: 'oauth_client',
          credentialHash: 'p1-keyed-see-secretHash',
          hashAlgo: 'hmac-sha256-v1',
          lookupKey: minted.lookupKey,
          secretHash: minted.secretHash,
          metadata: { clientId: CID },
        },
      ]);

      const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
        clientId: CID,
        clientSecret: minted.token,
        credentialLocation: 'client_secret_post',
      });

      expect(res.outcome).toBe('accept');
    });

    it('P6-T3: NEGATIVE CONTROL - a wrong secret is still refused with several credentials present', async () => {
      const bcrypt = require('bcrypt');
      const { mintOAuthClientSecret } = require('../../../security/credential-token');
      const minted = mintOAuthClientSecret();
      const { provider } = makeProvider([
        { credentialType: 'oauth_client', credentialHash: await bcrypt.hash('one', 4), metadata: { clientId: CID } },
        { credentialType: 'oauth_client', credentialHash: await bcrypt.hash('two', 4), metadata: { clientId: CID } },
        {
          credentialType: 'oauth_client',
          credentialHash: 'p1-keyed-see-secretHash',
          hashAlgo: 'hmac-sha256-v1',
          lookupKey: minted.lookupKey,
          secretHash: minted.secretHash,
          metadata: { clientId: CID },
        },
      ]);

      const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
        clientId: CID,
        clientSecret: 'not-any-of-them',
        credentialLocation: 'client_secret_post',
      });

      expect(res.outcome).toBe('reject');
    });

    it('P6-T4: a keyed secret is matched by its OWN lookupKey, not by position', async () => {
      const { mintOAuthClientSecret } = require('../../../security/credential-token');
      const a = mintOAuthClientSecret();
      const b = mintOAuthClientSecret();
      const row = (m: { lookupKey: string; secretHash: string }) => ({
        credentialType: 'oauth_client',
        credentialHash: 'p1-keyed-see-secretHash',
        hashAlgo: 'hmac-sha256-v1',
        lookupKey: m.lookupKey,
        secretHash: m.secretHash,
        metadata: { clientId: CID },
      });
      const { provider } = makeProvider([row(a), row(b)]);

      // b is second; a positional match would fail it.
      const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
        clientId: CID,
        clientSecret: b.token,
        credentialLocation: 'client_secret_post',
      });

      expect(res.outcome).toBe('accept');
    });

    it('P6-T5: a credential for a DIFFERENT clientId is never considered', async () => {
      const bcrypt = require('bcrypt');
      const { provider } = makeProvider([
        { credentialType: 'oauth_client', credentialHash: await bcrypt.hash('right', 4), metadata: { clientId: 'other-client' } },
      ]);

      const res = await provider.mintFromClientSecret(ENDPOINT_ID, {
        clientId: CID,
        clientSecret: 'right',
        credentialLocation: 'client_secret_post',
      });

      expect(res.outcome).toBe('reject');
    });
  });
});
