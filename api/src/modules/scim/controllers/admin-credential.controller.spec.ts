/**
 * Unit tests for AdminCredentialController (Phase 11).
 *
 * Phase J (v0.48.1) additions:
 *   - The controller now emits SCIM_EVENTS.CREDENTIAL_CREATED /
 *     CREDENTIAL_REVOKED via EventEmitter2 on the success path so the
 *     ScimEventSseBridge can forward them onto the SSE wire for
 *     cross-tab CredentialsTab refresh. The controller test verifies
 *     emit-after-commit (call ordering relative to the persisted
 *     write).
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminCredentialController } from './admin-credential.controller';
import { ScimLogger } from '../../logging/scim-logger.service';
import { SCIM_EVENTS } from '../../stats/scim-events';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockhash'),
}));

describe('AdminCredentialController', () => {
  let controller: AdminCredentialController;
  let mockCredentialRepo: Record<string, jest.Mock>;
  let mockEndpointService: Record<string, jest.Mock>;
  let mockEventEmitter: { emit: jest.Mock };

  const mockEndpoint = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'test-endpoint',
    profile: { settings: { PerEndpointCredentialsEnabled: true } },
    active: true,
    scimBasePath: '/scim/endpoints/11111111-1111-1111-1111-111111111111',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _links: {
      self: '/admin/endpoints/11111111-1111-1111-1111-111111111111',
      stats: '/admin/endpoints/11111111-1111-1111-1111-111111111111/stats',
      credentials: '/admin/endpoints/11111111-1111-1111-1111-111111111111/credentials',
      scim: '/scim/endpoints/11111111-1111-1111-1111-111111111111',
    },
  };

  const mockCredential = {
    id: 'cred-1111',
    endpointId: mockEndpoint.id,
    credentialType: 'bearer',
    credentialHash: '$2b$12$hash',
    label: 'Test credential',
    metadata: null,
    active: true,
    createdAt: new Date(),
    expiresAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCredentialRepo = {
      create: jest.fn().mockResolvedValue(mockCredential),
      findByEndpoint: jest.fn().mockResolvedValue([mockCredential]),
      findById: jest.fn().mockResolvedValue(mockCredential),
      findActiveByEndpoint: jest.fn().mockResolvedValue([mockCredential]),
      deactivate: jest.fn().mockResolvedValue({ ...mockCredential, active: false }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
    };

    const mockScimLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
      getConfig: jest.fn().mockReturnValue({}),
      runWithContext: jest.fn((ctx, fn) => fn()),
      getContext: jest.fn(),
      enrichContext: jest.fn(),
    } as unknown as ScimLogger;

    controller = new AdminCredentialController(
      mockCredentialRepo as any,
      mockEndpointService as any,
      mockScimLogger,
      (mockEventEmitter = { emit: jest.fn() }) as unknown as EventEmitter2,
    );
  });

  describe('createCredential', () => {
    it('should create a credential and return plaintext token', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        label: 'My token',
      });

      expect(result.id).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.token!.length).toBeGreaterThan(10);
      expect(result.endpointId).toBe(mockEndpoint.id);
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialType: 'bearer',
          label: 'My token',
        }),
      );
    });

    it('should reject when PerEndpointCredentialsEnabled is false', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject when config is empty', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: {} },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject invalid credentialType', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid expiresAt format', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, { expiresAt: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject expiresAt in the past', async () => {
      await expect(
        controller.createCredential(mockEndpoint.id, {
          expiresAt: '2020-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept valid expiresAt in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day
      const result = await controller.createCredential(mockEndpoint.id, {
        expiresAt: futureDate,
      });

      expect(result.token).toBeDefined();
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('should accept oauth_client credential type', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });

      // Q1: oauth_client returns a client_id + client_secret pair, NOT a bearer token.
      expect(result.token).toBeUndefined();
      expect(result.clientId).toBeDefined();
      expect(typeof result.clientId).toBe('string');
      expect(result.clientSecret).toBeDefined();
      expect(typeof result.clientSecret).toBe('string');
      expect(result.clientSecret!.length).toBeGreaterThan(10);
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialType: 'oauth_client',
          metadata: expect.objectContaining({ clientId: result.clientId }),
        }),
      );
    });

    it('Q1: oauth_client stores only the bcrypt hash of the secret, never the plaintext', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'oauth_client',
      });
      const createArg = mockCredentialRepo.create.mock.calls[0][0];
      // The stored hash must not equal the returned plaintext secret.
      expect(createArg.credentialHash).toBeDefined();
      expect(createArg.credentialHash).not.toBe(result.clientSecret);
      // The plaintext secret must not be persisted anywhere in the create input.
      expect(JSON.stringify(createArg)).not.toContain(result.clientSecret);
    });

    it('should throw NotFoundException for non-existent endpoint', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(
        new NotFoundException('Endpoint not found'),
      );

      await expect(
        controller.createCredential('bad-id', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('orthogonal create gate (A1)', () => {
    it('allows a wif credential when only WifCredentialsEnabled is on', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true, PerEndpointCredentialsEnabled: false } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });

      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: 'https://login.microsoftonline.com/tid/v2.0',
          expectedAudience: 'appid',
          expectedSubject: 'sub',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          allowedTenantId: 'tid',
        },
      } as never);

      expect(result.credentialType).toBe('wif');
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ credentialType: 'wif' }),
      );
    });

    it('rejects a wif credential when WifCredentialsEnabled is off', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: false, PerEndpointCredentialsEnabled: true } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'wif' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still requires PerEndpointCredentialsEnabled for a bearer credential', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true, PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, { credentialType: 'bearer' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('the wif response carries NO secret/hash field', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { WifCredentialsEnabled: true } },
      });
      mockCredentialRepo.create.mockResolvedValue({ ...mockCredential, credentialType: 'wif', credentialHash: '' });

      const result = await controller.createCredential(mockEndpoint.id, {
        credentialType: 'wif',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: 'https://idp/v2.0',
          expectedAudience: 'appid',
          expectedSubject: 'sub',
          jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
          allowedTenantId: 'tid',
        },
      } as never);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/token|clientSecret|credentialHash|secret/i);
    });
  });

  describe('listCredentials', () => {
    it('should list credentials without hashes', async () => {
      const result = await controller.listCredentials(mockEndpoint.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockCredential.id);
      expect(result[0]).not.toHaveProperty('credentialHash');
      expect(result[0]).not.toHaveProperty('token');
    });

    it('should return empty array when no credentials exist', async () => {
      mockCredentialRepo.findByEndpoint.mockResolvedValue([]);
      const result = await controller.listCredentials(mockEndpoint.id);
      expect(result).toEqual([]);
    });
  });

  describe('revokeCredential', () => {
    it('should deactivate a credential', async () => {
      await controller.revokeCredential(mockEndpoint.id, mockCredential.id);
      expect(mockCredentialRepo.deactivate).toHaveBeenCalledWith(mockCredential.id);
    });

    it('should throw NotFoundException when credential does not exist', async () => {
      mockCredentialRepo.findById.mockResolvedValue(null);

      await expect(
        controller.revokeCredential(mockEndpoint.id, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when credential belongs to different endpoint', async () => {
      mockCredentialRepo.findById.mockResolvedValue({
        ...mockCredential,
        endpointId: 'different-endpoint-id',
      });

      await expect(
        controller.revokeCredential(mockEndpoint.id, mockCredential.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Phase J (v0.48.1) - SSE event emission ────────────────────────
  describe('Phase J - SCIM event emission for SSE bridge', () => {
    it('emits SCIM_EVENTS.CREDENTIAL_CREATED after a successful create', async () => {
      await controller.createCredential(mockEndpoint.id, { label: 'Phase J' });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_CREATED,
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialId: mockCredential.id,
          credentialType: mockCredential.credentialType,
        }),
      );
    });

    it('emits CREDENTIAL_CREATED AFTER the persisted write (event payload uses repo-returned id)', async () => {
      await controller.createCredential(mockEndpoint.id, {});

      // Order check: the create call must come first; if the emit
      // happened before the repo resolved, the payload would not have
      // the persisted id.
      const createCallOrder = mockCredentialRepo.create.mock.invocationCallOrder[0];
      const emitCallOrder = mockEventEmitter.emit.mock.invocationCallOrder[0];
      expect(createCallOrder).toBeLessThan(emitCallOrder);
    });

    it('does NOT emit CREDENTIAL_CREATED when the endpoint config rejects the operation', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        ...mockEndpoint,
        profile: { settings: { PerEndpointCredentialsEnabled: false } },
      });

      await expect(
        controller.createCredential(mockEndpoint.id, {}),
      ).rejects.toThrow(ForbiddenException);

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_CREATED,
        expect.anything(),
      );
    });

    it('emits SCIM_EVENTS.CREDENTIAL_REVOKED after a successful revoke', async () => {
      await controller.revokeCredential(mockEndpoint.id, mockCredential.id);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_REVOKED,
        expect.objectContaining({
          endpointId: mockEndpoint.id,
          credentialId: mockCredential.id,
        }),
      );
    });

    it('does NOT emit CREDENTIAL_REVOKED when the credential is not found', async () => {
      mockCredentialRepo.findById.mockResolvedValue(null);

      await expect(
        controller.revokeCredential(mockEndpoint.id, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);

      expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
        SCIM_EVENTS.CREDENTIAL_REVOKED,
        expect.anything(),
      );
    });

    it('NEVER includes the credential hash or plaintext token in the emitted payload (PII boundary)', async () => {
      await controller.createCredential(mockEndpoint.id, { label: 'PII test' });

      const [, payload] = mockEventEmitter.emit.mock.calls.find(
        (c) => c[0] === SCIM_EVENTS.CREDENTIAL_CREATED,
      ) as [string, Record<string, unknown>];
      expect(payload).not.toHaveProperty('credentialHash');
      expect(payload).not.toHaveProperty('token');
      expect(payload).not.toHaveProperty('hash');
    });
  });
});
