/**
 * Unit tests for AdminCredentialController (Phase 11).
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminCredentialController } from './admin-credential.controller';

// Mock bcrypt
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockhash'),
}));

describe('AdminCredentialController', () => {
  let controller: AdminCredentialController;
  let mockCredentialRepo: Record<string, jest.Mock>;
  let mockEndpointService: Record<string, jest.Mock>;

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

    controller = new AdminCredentialController(
      mockCredentialRepo as any,
      mockEndpointService as any,
    );
  });

  describe('createCredential', () => {
    it('should create a credential and return plaintext token', async () => {
      const result = await controller.createCredential(mockEndpoint.id, {
        label: 'My token',
      });

      expect(result.id).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.token.length).toBeGreaterThan(10);
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

      expect(result.token).toBeDefined();
      expect(mockCredentialRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ credentialType: 'oauth_client' }),
      );
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
});
