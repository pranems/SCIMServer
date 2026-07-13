import { ConnectionSecretResolverService } from './connection-secret-resolver.service';
import type { CredentialSecurityService } from '../../../security/credential-security.service';
import type { CredentialEncryptionService } from '../../../security/credential-encryption.service';
import type { ConfigService } from '@nestjs/config';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';

function cred(over: Partial<EndpointCredentialModel> = {}): EndpointCredentialModel {
  return {
    id: 'c1',
    endpointId: 'ep-1',
    credentialType: 'bearer',
    credentialHash: 'h',
    label: 'l',
    metadata: null,
    secretEnvelope: null,
    active: true,
    createdAt: new Date(),
    expiresAt: null,
    ...over,
  } as EndpointCredentialModel;
}

describe('ConnectionSecretResolverService', () => {
  let service: ConnectionSecretResolverService;
  let getServerVisibility: jest.Mock;
  let getEffectiveVisibility: jest.Mock;
  let decrypt: jest.Mock;
  let isReady: jest.Mock;
  let configGet: jest.Mock;

  beforeEach(() => {
    getServerVisibility = jest.fn().mockResolvedValue('always');
    getEffectiveVisibility = jest.fn().mockResolvedValue('always');
    decrypt = jest.fn((env: string) => `plain-of-${env}`);
    isReady = jest.fn().mockReturnValue(true);
    configGet = jest.fn((key: string) => {
      const map: Record<string, string> = {
        SCIM_SHARED_SECRET: 'shared-xyz',
        OAUTH_CLIENT_ID: 'global-client',
        OAUTH_CLIENT_SECRET: 'global-secret',
      };
      return map[key];
    });

    service = new ConnectionSecretResolverService(
      { getServerVisibility, getEffectiveVisibility } as unknown as CredentialSecurityService,
      { decrypt, isReady } as unknown as CredentialEncryptionService,
      { get: configGet } as unknown as ConfigService,
    );
  });

  describe('resolveForEndpoint', () => {
    it('inlines the decrypted bearer + oauth secrets + shared secret when always', async () => {
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: 'env-b' }),
        cred({ credentialType: 'oauth_client', secretEnvelope: 'env-o' }),
      ]);
      expect(res.bearerToken).toBe('plain-of-env-b');
      expect(res.oauthClientSecret).toBe('plain-of-env-o');
      expect(res.sharedSecret).toBe('shared-xyz');
      expect(res.anyEndpointSecretRevealed).toBe(true);
    });

    it('withholds per-endpoint secrets when EFFECTIVE visibility is once', async () => {
      getEffectiveVisibility.mockResolvedValue('once');
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: 'env-b' }),
      ]);
      expect(res.bearerToken).toBeNull();
      expect(res.oauthClientSecret).toBeNull();
      expect(res.anyEndpointSecretRevealed).toBe(false);
    });

    it('withholds the shared secret when SERVER visibility is once (even if endpoint is always)', async () => {
      getServerVisibility.mockResolvedValue('once');
      getEffectiveVisibility.mockResolvedValue('once'); // server ceiling forces once
      const res = await service.resolveForEndpoint({}, []);
      expect(res.sharedSecret).toBeNull();
    });

    it('returns null (not throw) when the envelope cannot be decrypted', async () => {
      decrypt.mockImplementation(() => {
        throw new Error('KEK changed');
      });
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: 'bad' }),
      ]);
      expect(res.bearerToken).toBeNull();
    });

    it('returns null when there is no envelope (pre-feature credential)', async () => {
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: null }),
      ]);
      expect(res.bearerToken).toBeNull();
    });

    it('returns null when encryption is not ready', async () => {
      isReady.mockReturnValue(false);
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: 'env-b' }),
      ]);
      expect(res.bearerToken).toBeNull();
    });

    it('ignores inactive credentials', async () => {
      const res = await service.resolveForEndpoint({}, [
        cred({ credentialType: 'bearer', secretEnvelope: 'env-b', active: false }),
      ]);
      expect(res.bearerToken).toBeNull();
    });
  });

  describe('resolveServerSecrets', () => {
    it('inlines the global shared secret + oauth client id/secret when server always', async () => {
      const res = await service.resolveServerSecrets();
      expect(res.revealed).toBe(true);
      expect(res.sharedSecret).toBe('shared-xyz');
      expect(res.oauthClientId).toBe('global-client');
      expect(res.oauthClientSecret).toBe('global-secret');
    });

    it('withholds all global secrets when server visibility is once', async () => {
      getServerVisibility.mockResolvedValue('once');
      const res = await service.resolveServerSecrets();
      expect(res.revealed).toBe(false);
      expect(res.sharedSecret).toBeNull();
      expect(res.oauthClientId).toBeNull();
      expect(res.oauthClientSecret).toBeNull();
    });

    it('defaults the oauth client id when unset but keeps secret null', async () => {
      configGet.mockImplementation((key: string) => (key === 'SCIM_SHARED_SECRET' ? 'shared-xyz' : undefined));
      // process.env fallback also empty for oauth
      const prevId = process.env.OAUTH_CLIENT_ID;
      const prevSecret = process.env.OAUTH_CLIENT_SECRET;
      delete process.env.OAUTH_CLIENT_ID;
      delete process.env.OAUTH_CLIENT_SECRET;
      const res = await service.resolveServerSecrets();
      expect(res.oauthClientId).toBe('scimserver-client');
      expect(res.oauthClientSecret).toBeNull();
      if (prevId !== undefined) process.env.OAUTH_CLIENT_ID = prevId;
      if (prevSecret !== undefined) process.env.OAUTH_CLIENT_SECRET = prevSecret;
    });
  });
});
