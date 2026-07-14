/**
 * ConnectionInfoService unit tests (WI-2).
 *
 * Covers: URL assembly across host permutations + API_PREFIX; per-method
 * enable/disable selection driven by the effective auth-enablement flags;
 * clientSecretState transitions; the WIF audience default + override; and the
 * hard invariant that NO secret value is ever present in the assembled shape.
 */
import { ConnectionInfoService, type ConnectionInfoEndpointInput } from './connection-info.service';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';

function endpoint(settings: Record<string, unknown>, over: Partial<ConnectionInfoEndpointInput> = {}): ConnectionInfoEndpointInput {
  return {
    id: '7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34',
    name: 'onboarding-isv-prov08',
    displayName: 'Onboarding-ISV-Prov08',
    profile: { settings },
    ...over,
  };
}

function cred(over: Partial<EndpointCredentialModel>): EndpointCredentialModel {
  return {
    id: 'cred-1',
    endpointId: '7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34',
    credentialType: 'bearer',
    credentialHash: 'bcrypt$xxx',
    label: null,
    metadata: null,
    secretEnvelope: null,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: null,
    ...over,
  };
}

describe('ConnectionInfoService', () => {
  let service: ConnectionInfoService;
  const ID = '7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34';

  beforeEach(() => {
    service = new ConnectionInfoService();
    delete process.env.API_PREFIX;
  });

  describe('buildUrls', () => {
    it('assembles the authoritative URL shapes (v2 leading base, bare token endpoint)', () => {
      const urls = service.buildUrls('https://scim.example.com', ID);
      expect(urls.scimBaseUrl).toBe(`https://scim.example.com/scim/v2/endpoints/${ID}`);
      expect(urls.scimBaseUrlBare).toBe(`https://scim.example.com/scim/endpoints/${ID}`);
      expect(urls.tokenEndpoint).toBe(`https://scim.example.com/scim/endpoints/${ID}/oauth/token`);
      expect(urls.serviceProviderConfig).toBe(`https://scim.example.com/scim/v2/endpoints/${ID}/ServiceProviderConfig`);
      expect(urls.oauthMetadata).toBe(`https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`);
    });

    it('honors a custom API_PREFIX', () => {
      process.env.API_PREFIX = 'api';
      const urls = service.buildUrls('https://scim.example.com', ID);
      expect(urls.scimBaseUrl).toBe(`https://scim.example.com/api/v2/endpoints/${ID}`);
      expect(urls.tokenEndpoint).toBe(`https://scim.example.com/api/endpoints/${ID}/oauth/token`);
    });

    it('strips a trailing slash from the base URL', () => {
      const urls = service.buildUrls('https://scim.example.com/', ID);
      expect(urls.scimBaseUrl).toBe(`https://scim.example.com/scim/v2/endpoints/${ID}`);
    });

    it('works with a port + http scheme (local dev)', () => {
      const urls = service.buildUrls('http://localhost:6000', ID);
      expect(urls.scimBaseUrl).toBe(`http://localhost:6000/scim/v2/endpoints/${ID}`);
      expect(urls.tokenEndpoint).toBe(`http://localhost:6000/scim/endpoints/${ID}/oauth/token`);
    });
  });

  describe('assemble - method selection', () => {
    it('enables oauth_client + wif and disables bearer when only those flags are on', () => {
      const info = service.assemble(
        endpoint({ OAuthClientCredentialsAuthEnabled: 'True', WifCredentialsEnabled: 'True', SharedSecretBearerAuthEnabled: 'False' }),
        [],
        'https://scim.example.com',
      );
      const enabled = info.enabledMethods.map((m) => m.method).sort();
      expect(enabled).toEqual(['oauth_client', 'wif']);
      const disabled = info.disabledMethods.map((m) => m.method).sort();
      expect(disabled).toEqual(['bearer', 'shared_secret']);
    });

    it('shared_secret defaults ON (back-compat) when no flag is set', () => {
      const info = service.assemble(endpoint({}), [], 'https://scim.example.com');
      expect(info.enabledMethods.some((m) => m.method === 'shared_secret')).toBe(true);
    });

    it('per-endpoint bearer falls back to the legacy PerEndpointCredentialsEnabled', () => {
      const info = service.assemble(
        endpoint({ PerEndpointCredentialsEnabled: 'True' }),
        [],
        'https://scim.example.com',
      );
      expect(info.enabledMethods.some((m) => m.method === 'bearer')).toBe(true);
      expect(info.enabledMethods.some((m) => m.method === 'oauth_client')).toBe(true);
    });

    it('a disabled method carries a reason + enableHint', () => {
      const info = service.assemble(endpoint({ WifCredentialsEnabled: 'False' }), [], 'https://scim.example.com');
      const wif = info.disabledMethods.find((m) => m.method === 'wif');
      expect(wif).toBeDefined();
      expect(wif?.reason).toContain('WifCredentialsEnabled');
      expect(wif?.enableHint).toContain('WifCredentialsEnabled=True');
    });
  });

  describe('assemble - clientSecretState', () => {
    it('oauth_client is create-required with no credential, set-shown-once with one', () => {
      const noCred = service.assemble(endpoint({ OAuthClientCredentialsAuthEnabled: 'True' }), [], 'https://x');
      expect(noCred.enabledMethods.find((m) => m.method === 'oauth_client')?.clientSecretState).toBe('create-required');

      const withCred = service.assemble(
        endpoint({ OAuthClientCredentialsAuthEnabled: 'True' }),
        [cred({ credentialType: 'oauth_client', metadata: { clientId: 'epc_abc123' } })],
        'https://x',
      );
      const oc = withCred.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(oc?.clientSecretState).toBe('set-shown-once');
      expect(oc?.entraFields.clientIdentifier).toBe('epc_abc123');
    });

    it('ignores an INACTIVE credential when deciding clientSecretState', () => {
      const info = service.assemble(
        endpoint({ OAuthClientCredentialsAuthEnabled: 'True' }),
        [cred({ credentialType: 'oauth_client', active: false, metadata: { clientId: 'epc_dead' } })],
        'https://x',
      );
      const oc = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(oc?.clientSecretState).toBe('create-required');
      expect(oc?.entraFields.clientIdentifier).toBeNull();
    });

    it('wif + shared_secret always report clientSecretState none', () => {
      const info = service.assemble(
        endpoint({ WifCredentialsEnabled: 'True', SharedSecretBearerAuthEnabled: 'True' }),
        [],
        'https://x',
      );
      expect(info.enabledMethods.find((m) => m.method === 'wif')?.clientSecretState).toBe('none');
      expect(info.enabledMethods.find((m) => m.method === 'shared_secret')?.clientSecretState).toBe('none');
    });
  });

  describe('assemble - credentialId + secretRetained (R3)', () => {
    it('surfaces the active oauth_client credentialId + secretRetained when an envelope was kept', () => {
      const info = service.assemble(
        endpoint({ OAuthClientCredentialsAuthEnabled: 'True' }),
        [cred({ id: 'oc-1', credentialType: 'oauth_client', metadata: { clientId: 'client-id-x' }, secretEnvelope: 'v1.aa.bb.cc' })],
        'https://x',
      );
      const oc = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(oc?.credentialId).toBe('oc-1');
      expect(oc?.secretRetained).toBe(true);
    });

    it('reports secretRetained false when the oauth_client credential kept no envelope', () => {
      const info = service.assemble(
        endpoint({ OAuthClientCredentialsAuthEnabled: 'True' }),
        [cred({ id: 'oc-2', credentialType: 'oauth_client', metadata: { clientId: 'client-id-y' }, secretEnvelope: null })],
        'https://x',
      );
      const oc = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(oc?.credentialId).toBe('oc-2');
      expect(oc?.secretRetained).toBe(false);
    });

    it('surfaces the bearer credentialId + secretRetained from its envelope', () => {
      const info = service.assemble(
        endpoint({ SecretTokenBearerAuthEnabled: 'True' }),
        [cred({ id: 'br-1', credentialType: 'bearer', secretEnvelope: 'v1.dd.ee.ff' })],
        'https://x',
      );
      const br = info.enabledMethods.find((m) => m.method === 'bearer');
      expect(br?.credentialId).toBe('br-1');
      expect(br?.secretRetained).toBe(true);
    });

    it('has null credentialId + secretRetained false when no per-endpoint credential exists', () => {
      const info = service.assemble(
        endpoint({ SecretTokenBearerAuthEnabled: 'True', OAuthClientCredentialsAuthEnabled: 'True' }),
        [],
        'https://x',
      );
      const br = info.enabledMethods.find((m) => m.method === 'bearer');
      const oc = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(br?.credentialId ?? null).toBeNull();
      expect(br?.secretRetained).toBe(false);
      expect(oc?.credentialId ?? null).toBeNull();
      expect(oc?.secretRetained).toBe(false);
    });
  });

  describe('assemble - wif audience', () => {
    it('defaults the wif expectedAudience to the endpointId', () => {
      const info = service.assemble(endpoint({ WifCredentialsEnabled: 'True' }), [], 'https://x');
      expect(info.enabledMethods.find((m) => m.method === 'wif')?.expectedAudience).toBe(ID);
    });

    it('uses the wif credential expectedAudience when present', () => {
      const info = service.assemble(
        endpoint({ WifCredentialsEnabled: 'True' }),
        [cred({ credentialType: 'wif', metadata: { expectedAudience: 'api://scimserver-live' } })],
        'https://x',
      );
      expect(info.enabledMethods.find((m) => m.method === 'wif')?.expectedAudience).toBe('api://scimserver-live');
    });

    it('labels the wif method with the Entra "Workload Identity based authentication" auth method (not OAuth2 client credentials)', () => {
      const info = service.assemble(endpoint({ WifCredentialsEnabled: 'True' }), [], 'https://x');
      const wif = info.enabledMethods.find((m) => m.method === 'wif');
      expect(wif?.entraAuthenticationMethod).toBe('Workload Identity based authentication');
    });

    it('maps the wif expectedSubject to Entra\'s Client identifier field (sub claim)', () => {
      const info = service.assemble(
        endpoint({ WifCredentialsEnabled: 'True' }),
        [cred({ credentialType: 'wif', metadata: { expectedSubject: 'sp-object-id-abc', expectedAudience: 'aud' } })],
        'https://x',
      );
      const wif = info.enabledMethods.find((m) => m.method === 'wif');
      expect(wif?.entraFields.clientIdentifier).toBe('sp-object-id-abc');
      // The audience stays a separate row.
      expect(wif?.expectedAudience).toBe('aud');
    });

    it('leaves the wif clientIdentifier null when no subject is configured', () => {
      const info = service.assemble(endpoint({ WifCredentialsEnabled: 'True' }), [], 'https://x');
      const wif = info.enabledMethods.find((m) => m.method === 'wif');
      expect(wif?.entraFields.clientIdentifier).toBeNull();
    });
  });

  describe('assemble - display + no-secret invariant', () => {
    it('falls back to name when displayName is absent', () => {
      const info = service.assemble(endpoint({}, { displayName: undefined }), [], 'https://x');
      expect(info.displayName).toBe('onboarding-isv-prov08');
    });

    it('never emits a non-null secret value when NO secrets are passed (default withhold)', () => {
      const info = service.assemble(
        endpoint({ SecretTokenBearerAuthEnabled: 'True', OAuthClientCredentialsAuthEnabled: 'True', WifCredentialsEnabled: 'True', SharedSecretBearerAuthEnabled: 'True' }),
        [
          cred({ credentialType: 'bearer' }),
          cred({ id: 'c2', credentialType: 'oauth_client', metadata: { clientId: 'epc_abc' } }),
          cred({ id: 'c3', credentialType: 'wif', metadata: { expectedAudience: 'aud' } }),
        ],
        'https://scim.example.com',
      );
      const serialized = JSON.stringify(info);
      // No bcrypt hash, no plaintext-ish secret keys with a value.
      expect(serialized).not.toContain('bcrypt$');
      for (const m of info.enabledMethods) {
        if ('secretToken' in m.entraFields) expect(m.entraFields.secretToken).toBeNull();
        if ('clientSecret' in m.entraFields) expect(m.entraFields.clientSecret).toBeNull();
        expect(m.secretRevealed ?? false).toBe(false);
      }
    });

    it('inlines the secrets + sets secretRevealed when secrets ARE passed (visibility=always)', () => {
      const info = service.assemble(
        endpoint({ SecretTokenBearerAuthEnabled: 'True', OAuthClientCredentialsAuthEnabled: 'True', SharedSecretBearerAuthEnabled: 'True' }),
        [
          cred({ credentialType: 'bearer', secretEnvelope: 'env-b' }),
          cred({ id: 'c2', credentialType: 'oauth_client', metadata: { clientId: 'epc_abc' }, secretEnvelope: 'env-o' }),
        ],
        'https://scim.example.com',
        { sharedSecret: 'shared-xyz', bearerToken: 'tok-123', oauthClientSecret: 'sec-456' },
      );
      const bearer = info.enabledMethods.find((m) => m.method === 'bearer');
      expect(bearer?.entraFields.secretToken).toBe('tok-123');
      expect(bearer?.secretRevealed).toBe(true);
      const oauth = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(oauth?.entraFields.clientSecret).toBe('sec-456');
      expect(oauth?.secretRevealed).toBe(true);
      const shared = info.enabledMethods.find((m) => m.method === 'shared_secret');
      expect(shared?.entraFields.secretToken).toBe('shared-xyz');
      expect(shared?.secretRevealed).toBe(true);
      expect(shared?.clientSecretState).toBe('set-shown-once');
    });

    it('does NOT inline a per-endpoint secret when there is no credential even if a value is passed', () => {
      const info = service.assemble(
        endpoint({ SecretTokenBearerAuthEnabled: 'True' }),
        [],
        'https://scim.example.com',
        { bearerToken: 'tok-123' },
      );
      const bearer = info.enabledMethods.find((m) => m.method === 'bearer');
      expect(bearer?.entraFields.secretToken).toBeNull();
      expect(bearer?.secretRevealed).toBe(false);
    });
  });

  // WI-D8 - per-method authHealth attachment + the buildAuthHealth mapper.
  describe('authHealth (WI-D8)', () => {
    it('attaches the authHealth block to the matching enabled method only', () => {
      const info = service.assemble(
        endpoint({ WifCredentialsEnabled: 'True', OAuthClientCredentialsAuthEnabled: 'True' }),
        [],
        'https://scim.example.com',
        undefined,
        {
          wif: { lastOutcome: 'reject', lastReasonCode: 'wif_audience_mismatch', lastAttemptAt: '2026-07-14T00:00:00Z', lastCorrelationId: 'req-9' },
        },
      );
      const wif = info.enabledMethods.find((m) => m.method === 'wif');
      const oauth = info.enabledMethods.find((m) => m.method === 'oauth_client');
      expect(wif?.authHealth?.lastOutcome).toBe('reject');
      expect(wif?.authHealth?.lastReasonCode).toBe('wif_audience_mismatch');
      // oauth_client had no entry in the map -> no authHealth attached.
      expect(oauth?.authHealth).toBeUndefined();
    });

    it('omits authHealth entirely when no map is passed (back-compat)', () => {
      const info = service.assemble(
        endpoint({ WifCredentialsEnabled: 'True' }),
        [],
        'https://scim.example.com',
      );
      expect(info.enabledMethods.every((m) => m.authHealth === undefined)).toBe(true);
    });

    it('buildAuthHealth maps trace-method keys onto ConnectionMethod (bearer_jwt -> bearer)', () => {
      const map = ConnectionInfoService.buildAuthHealth({
        wif: { outcome: 'accept', recordedAt: '2026-07-14T00:00:00Z', correlationId: 'a' },
        bearer_jwt: { outcome: 'reject', reasonCode: 'bearer_missing', recordedAt: '2026-07-14T00:01:00Z' },
      });
      expect(map.wif?.lastOutcome).toBe('accept');
      expect(map.bearer?.lastOutcome).toBe('reject');
      expect(map.bearer?.lastReasonCode).toBe('bearer_missing');
      // bearer_jwt should not leak through as its own key.
      expect((map as Record<string, unknown>).bearer_jwt).toBeUndefined();
    });
  });
});
