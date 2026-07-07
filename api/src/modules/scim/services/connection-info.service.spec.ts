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
  });

  describe('assemble - display + no-secret invariant', () => {
    it('falls back to name when displayName is absent', () => {
      const info = service.assemble(endpoint({}, { displayName: undefined }), [], 'https://x');
      expect(info.displayName).toBe('onboarding-isv-prov08');
    });

    it('never emits a non-null secret value anywhere in the shape', () => {
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
      }
    });
  });
});
