import { parseBulkPath, BulkProcessorService } from './bulk-processor.service';
import { HttpException } from '@nestjs/common';
import { EndpointScimUsersService } from './endpoint-scim-users.service';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import type { BulkOperationDto } from '../dto/bulk-request.dto';

describe('parseBulkPath', () => {
  it('should parse collection path "/Users"', () => {
    expect(parseBulkPath('/Users')).toEqual({ resourceType: 'Users' });
  });

  it('should parse resource path "/Users/abc-123"', () => {
    expect(parseBulkPath('/Users/abc-123')).toEqual({ resourceType: 'Users', resourceId: 'abc-123' });
  });

  it('should parse collection path "/Groups"', () => {
    expect(parseBulkPath('/Groups')).toEqual({ resourceType: 'Groups' });
  });

  it('should parse resource path "/Groups/xyz"', () => {
    expect(parseBulkPath('/Groups/xyz')).toEqual({ resourceType: 'Groups', resourceId: 'xyz' });
  });

  it('should handle path without leading slash', () => {
    expect(parseBulkPath('Users')).toEqual({ resourceType: 'Users' });
  });

  it('should handle resource ID containing slashes', () => {
    // Resource IDs should not contain slashes, but path parsing should be safe
    expect(parseBulkPath('/Users/abc/extra')).toEqual({ resourceType: 'Users', resourceId: 'abc/extra' });
  });
});

describe('BulkProcessorService', () => {
  let service: BulkProcessorService;
  let mockUsersService: Record<string, jest.Mock>;
  let mockGroupsService: Record<string, jest.Mock>;
  let mockLogger: any;
  const config: EndpointConfig = {};
  const baseUrl = 'http://localhost:3000/scim/endpoints/ep1';
  const endpointId = 'ep1';

  beforeEach(() => {
    mockUsersService = {
      createUserForEndpoint: jest.fn(),
      getUserForEndpoint: jest.fn(),
      replaceUserForEndpoint: jest.fn(),
      patchUserForEndpoint: jest.fn(),
      deleteUserForEndpoint: jest.fn(),
    };

    mockGroupsService = {
      createGroupForEndpoint: jest.fn(),
      getGroupForEndpoint: jest.fn(),
      replaceGroupForEndpoint: jest.fn(),
      patchGroupForEndpoint: jest.fn(),
      deleteGroupForEndpoint: jest.fn(),
    };

    mockLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      enrichContext: jest.fn(),
      isEnabled: jest.fn().mockReturnValue(true),
    };

    service = new BulkProcessorService(
      mockUsersService as unknown as EndpointScimUsersService,
      mockGroupsService as unknown as EndpointScimGroupsService,
      mockLogger,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── User POST ────────────────────────────────────────────────────────────

  describe('POST /Users', () => {
    it('should create a user and return 201', async () => {
      const mockResult = { id: 'u-001', userName: 'alice', meta: { version: 'W/"v1"' } };
      mockUsersService.createUserForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'user1', data: { userName: 'alice' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);

      expect(result.Operations).toHaveLength(1);
      expect(result.Operations[0]).toEqual({
        method: 'POST',
        bulkId: 'user1',
        version: 'W/"v1"',
        location: `${baseUrl}/Users/u-001`,
        status: '201',
      });
    });

    it('should fail if POST has no data', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'user1' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('data');
    });

    it('should reject POST with resource ID in path', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users/some-id', bulkId: 'user1', data: { userName: 'x' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('collection path');
    });
  });

  // ─── User PUT ─────────────────────────────────────────────────────────────

  describe('PUT /Users/:id', () => {
    it('should replace a user and return 200', async () => {
      const mockResult = { id: 'u-001', userName: 'alice-updated', meta: { version: 'W/"v2"' } };
      mockUsersService.replaceUserForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'PUT', path: '/Users/u-001', data: { userName: 'alice-updated' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('200');
      expect(result.Operations[0].location).toBe(`${baseUrl}/Users/u-001`);
    });

    it('should reject PUT without resource ID', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'PUT', path: '/Users', data: { userName: 'x' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('specific resource');
    });

    it('should reject PUT without data', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'PUT', path: '/Users/u-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('data');
    });
  });

  // ─── User PATCH ───────────────────────────────────────────────────────────

  describe('PATCH /Users/:id', () => {
    it('should patch a user and return 200', async () => {
      const mockResult = { id: 'u-001', userName: 'alice', meta: { version: 'W/"v3"' } };
      mockUsersService.patchUserForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        {
          method: 'PATCH',
          path: '/Users/u-001',
          data: { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] },
        },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('200');
      expect(result.Operations[0].version).toBe('W/"v3"');
    });
  });

  // ─── User DELETE ──────────────────────────────────────────────────────────

  describe('DELETE /Users/:id', () => {
    it('should delete a user and return 204', async () => {
      mockUsersService.deleteUserForEndpoint!.mockResolvedValue(undefined);

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users/u-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0]).toEqual({
        method: 'DELETE',
        bulkId: undefined,
        location: `${baseUrl}/Users/u-001`,
        status: '204',
      });
    });

    it('should reject DELETE without resource ID', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
    });
  });

  // ─── Group operations ────────────────────────────────────────────────────

  describe('Group operations', () => {
    it('should POST a group', async () => {
      const mockResult = { id: 'g-001', displayName: 'Devs', meta: { version: 'W/"v1"' } };
      mockGroupsService.createGroupForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Groups', bulkId: 'grp1', data: { displayName: 'Devs' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('201');
      expect(result.Operations[0].location).toBe(`${baseUrl}/Groups/g-001`);
    });

    it('should PUT a group', async () => {
      const mockResult = { id: 'g-001', displayName: 'Engineers', meta: { version: 'W/"v2"' } };
      mockGroupsService.replaceGroupForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'PUT', path: '/Groups/g-001', data: { displayName: 'Engineers' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('200');
    });

    it('should PATCH a group', async () => {
      const mockResult = { id: 'g-001', displayName: 'Engineers', meta: { version: 'W/"v3"' } };
      mockGroupsService.patchGroupForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'PATCH', path: '/Groups/g-001', data: { Operations: [{ op: 'replace', path: 'displayName', value: 'Engineers' }] } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('200');
    });

    it('should DELETE a group', async () => {
      mockGroupsService.deleteGroupForEndpoint!.mockResolvedValue(undefined);

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Groups/g-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('204');
    });
  });

  // ─── Unsupported resource type ────────────────────────────────────────────

  describe('Unsupported resource type', () => {
    it('should return error for unsupported resource type', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Widgets', bulkId: 'w1', data: { name: 'Widget1' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('Unsupported resource type');
    });
  });

  // ─── BulkId cross-referencing ─────────────────────────────────────────────

  describe('bulkId cross-referencing', () => {
    it('should resolve bulkId in subsequent operation path', async () => {
      const mockCreateResult = { id: 'real-user-id', userName: 'alice', meta: { version: 'W/"v1"' } };
      const mockPatchResult = { id: 'real-user-id', userName: 'alice', active: false, meta: { version: 'W/"v2"' } };

      mockUsersService.createUserForEndpoint!.mockResolvedValue(mockCreateResult as any);
      mockUsersService.patchUserForEndpoint!.mockResolvedValue(mockPatchResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
        { method: 'PATCH', path: '/Users/bulkId:u1', data: { Operations: [{ op: 'replace', path: 'active', value: false }] } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);

      expect(result.Operations).toHaveLength(2);
      expect(result.Operations[0].status).toBe('201');
      expect(result.Operations[1].status).toBe('200');
      // Verify the PATCH was called with the resolved ID
      expect(mockUsersService.patchUserForEndpoint).toHaveBeenCalledWith(
        'real-user-id',
        expect.anything(),
        baseUrl,
        endpointId,
        config,
        undefined,
      );
    });

    it('should resolve bulkId in data (group member value)', async () => {
      const mockUserResult = { id: 'real-user-id', userName: 'alice', meta: { version: 'W/"v1"' } };
      const mockGroupResult = { id: 'real-group-id', displayName: 'Devs', meta: { version: 'W/"v1"' } };

      mockUsersService.createUserForEndpoint!.mockResolvedValue(mockUserResult as any);
      mockGroupsService.createGroupForEndpoint!.mockResolvedValue(mockGroupResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
        {
          method: 'POST',
          path: '/Groups',
          bulkId: 'g1',
          data: {
            displayName: 'Devs',
            members: [{ value: 'bulkId:u1', display: 'alice' }],
          },
        },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations).toHaveLength(2);
      expect(result.Operations[0].status).toBe('201');
      expect(result.Operations[1].status).toBe('201');

      // Verify group creation was called with resolved user ID
      const groupData = mockGroupsService.createGroupForEndpoint!.mock.calls[0][0];
      expect((groupData as any).members[0].value).toBe('real-user-id');
    });

    it('should error on unresolved bulkId reference', async () => {
      const ops: BulkOperationDto[] = [
        { method: 'PATCH', path: '/Users/bulkId:nonexistent', data: { Operations: [] } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('400');
      expect(result.Operations[0].response?.detail).toContain('Unresolved bulkId');
    });
  });

  // ─── failOnErrors ─────────────────────────────────────────────────────────

  describe('failOnErrors', () => {
    it('should stop processing after failOnErrors threshold', async () => {
      // First op fails, second op should not execute
      mockUsersService.createUserForEndpoint!.mockRejectedValue(
        new HttpException({ status: 409, detail: 'Conflict' }, 409),
      );

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'dup' } },
        { method: 'POST', path: '/Users', bulkId: 'u2', data: { userName: 'ok' } },
        { method: 'POST', path: '/Users', bulkId: 'u3', data: { userName: 'also-ok' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config, 1);

      // Only 1 operation should be in results (the error) - rest skipped
      expect(result.Operations).toHaveLength(1);
      expect(result.Operations[0].status).toBe('409');
    });

    it('should process all operations when failOnErrors is 0', async () => {
      const mockResult = { id: 'u-001', userName: 'ok', meta: { version: 'W/"v1"' } };
      mockUsersService.createUserForEndpoint!
        .mockRejectedValueOnce(new HttpException({ status: 409, detail: 'Conflict' }, 409))
        .mockResolvedValueOnce(mockResult as any)
        .mockResolvedValueOnce(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'dup' } },
        { method: 'POST', path: '/Users', bulkId: 'u2', data: { userName: 'ok1' } },
        { method: 'POST', path: '/Users', bulkId: 'u3', data: { userName: 'ok2' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config, 0);

      expect(result.Operations).toHaveLength(3);
      expect(result.Operations[0].status).toBe('409');
      expect(result.Operations[1].status).toBe('201');
      expect(result.Operations[2].status).toBe('201');
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should capture HttpException details in error result', async () => {
      mockUsersService.createUserForEndpoint!.mockRejectedValue(
        new HttpException(
          { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], scimType: 'uniqueness', detail: 'userName already taken', status: '409' },
          409,
        ),
      );

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'dup' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0]).toMatchObject({
        method: 'POST',
        bulkId: 'u1',
        status: '409',
        response: {
          scimType: 'uniqueness',
          detail: 'userName already taken',
          status: '409',
        },
      });
    });

    it('should capture generic Error as 500 with generic detail (no leak)', async () => {
      mockUsersService.deleteUserForEndpoint!.mockRejectedValue(new Error('Database timeout'));

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users/u-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('500');
      // Must NOT leak raw error message - use generic detail
      expect(result.Operations[0].response?.detail).toBe('Internal server error');
    });

    it('should handle unknown error types', async () => {
      mockUsersService.deleteUserForEndpoint!.mockRejectedValue('some string error');

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users/u-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations[0].status).toBe('500');
    });
  });

  // ─── Version (If-Match) pass-through ──────────────────────────────────────

  describe('version (If-Match) pass-through', () => {
    it('should pass version as ifMatch for PUT operation', async () => {
      const mockResult = { id: 'u-001', userName: 'alice', meta: { version: 'W/"v2"' } };
      mockUsersService.replaceUserForEndpoint!.mockResolvedValue(mockResult as any);

      const ops: BulkOperationDto[] = [
        { method: 'PUT', path: '/Users/u-001', version: 'W/"v1"', data: { userName: 'alice' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(mockUsersService.replaceUserForEndpoint).toHaveBeenCalledWith(
        'u-001',
        expect.anything(),
        baseUrl,
        endpointId,
        config,
        'W/"v1"',
      );
    });

    it('should pass version as ifMatch for DELETE operation', async () => {
      mockUsersService.deleteUserForEndpoint!.mockResolvedValue(undefined);

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users/u-001', version: 'W/"v3"' },
      ];

      await service.process(endpointId, ops, baseUrl, config);
      expect(mockUsersService.deleteUserForEndpoint).toHaveBeenCalledWith(
        'u-001',
        endpointId,
        config,
        'W/"v3"',
      );
    });
  });

  // ─── Response schema ──────────────────────────────────────────────────────

  describe('response schema', () => {
    it('should include BulkResponse schema URN', async () => {
      mockUsersService.deleteUserForEndpoint!.mockResolvedValue(undefined);

      const ops: BulkOperationDto[] = [
        { method: 'DELETE', path: '/Users/u-001' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:BulkResponse']);
    });
  });

  // ─── Mixed operations ────────────────────────────────────────────────────

  describe('mixed operations', () => {
    it('should process multiple operations across Users and Groups', async () => {
      const mockUser = { id: 'u-001', userName: 'alice', meta: { version: 'W/"v1"' } };
      const mockGroup = { id: 'g-001', displayName: 'Devs', meta: { version: 'W/"v1"' } };

      mockUsersService.createUserForEndpoint!.mockResolvedValue(mockUser as any);
      mockGroupsService.createGroupForEndpoint!.mockResolvedValue(mockGroup as any);
      mockUsersService.deleteUserForEndpoint!.mockResolvedValue(undefined);

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
        { method: 'POST', path: '/Groups', bulkId: 'g1', data: { displayName: 'Devs' } },
        { method: 'DELETE', path: '/Users/old-user' },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      expect(result.Operations).toHaveLength(3);
      expect(result.Operations[0].status).toBe('201');
      expect(result.Operations[1].status).toBe('201');
      expect(result.Operations[2].status).toBe('204');
    });
  });

  // ─── Bulk Logging (Phase C Step 8) ──────────────────────────────────

  describe('bulk operation logging', () => {
    it('should log INFO at start and completion of bulk request', async () => {
      mockUsersService.createUserForEndpoint!.mockResolvedValue({ id: 'u1', meta: { version: 'W/"v1"' } });

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
      ];

      await service.process(endpointId, ops, baseUrl, config);

      // Should have 2 INFO calls: start + complete
      const infoCalls = mockLogger.info.mock.calls;
      const startCall = infoCalls.find((c: any[]) => c[1]?.includes('started'));
      const completeCall = infoCalls.find((c: any[]) => c[1]?.includes('completed'));

      expect(startCall).toBeDefined();
      expect(startCall[0]).toBe('scim.bulk');
      expect(startCall[2].opCount).toBe(1);

      expect(completeCall).toBeDefined();
      expect(completeCall[2].total).toBe(1);
      expect(completeCall[2].success).toBe(1);
      expect(completeCall[2].errors).toBe(0);
      expect(completeCall[2].stopped).toBe(false);
    });

    it('should log WARN for failed bulk operations with bulkIndex', async () => {
      mockUsersService.createUserForEndpoint!.mockRejectedValue(
        new HttpException({ detail: 'Conflict', scimType: 'uniqueness', status: '409', schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'] }, 409),
      );

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'dup' } },
      ];

      await service.process(endpointId, ops, baseUrl, config);

      const warnCalls = mockLogger.warn.mock.calls;
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
      const failCall = warnCalls.find((c: any[]) => c[1]?.includes('failed'));
      expect(failCall).toBeDefined();
      expect(failCall[0]).toBe('scim.bulk');
      expect(failCall[2].bulkIndex).toBe(0);
      expect(failCall[2].bulkId).toBe('u1');
      expect(failCall[2].status).toBe(409);
    });

    it('should enrichContext with bulkOperationIndex per operation', async () => {
      mockUsersService.createUserForEndpoint!.mockResolvedValue({ id: 'u1', meta: { version: 'W/"v1"' } });
      mockGroupsService.createGroupForEndpoint!.mockResolvedValue({ id: 'g1', meta: { version: 'W/"v1"' } });

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'alice' } },
        { method: 'POST', path: '/Groups', bulkId: 'g1', data: { displayName: 'Team' } },
      ];

      await service.process(endpointId, ops, baseUrl, config);

      const enrichCalls = mockLogger.enrichContext.mock.calls;
      expect(enrichCalls.length).toBeGreaterThanOrEqual(2);
      expect(enrichCalls[0][0].bulkOperationIndex).toBe(0);
      expect(enrichCalls[0][0].bulkId).toBe('u1');
      expect(enrichCalls[1][0].bulkOperationIndex).toBe(1);
      expect(enrichCalls[1][0].bulkId).toBe('g1');
    });

    it('should log stopped=true when failOnErrors threshold reached', async () => {
      mockUsersService.createUserForEndpoint!
        .mockRejectedValueOnce(new HttpException('Error', 400))
        .mockRejectedValueOnce(new HttpException('Error', 400));

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', data: { userName: 'a' } },
        { method: 'POST', path: '/Users', data: { userName: 'b' } },
        { method: 'POST', path: '/Users', data: { userName: 'c' } },
      ];

      await service.process(endpointId, ops, baseUrl, config, 2);

      const completeCall = mockLogger.info.mock.calls.find((c: any[]) => c[1]?.includes('completed'));
      expect(completeCall[2].stopped).toBe(true);
      expect(completeCall[2].errors).toBe(2);
      expect(completeCall[2].processed).toBeLessThan(3);
    });

    it('should include endpointId in start and complete logs', async () => {
      mockUsersService.createUserForEndpoint!.mockResolvedValue({ id: 'u1', meta: { version: 'W/"v1"' } });

      await service.process(endpointId, [{ method: 'POST', path: '/Users', data: { userName: 'a' } }], baseUrl, config);

      const startCall = mockLogger.info.mock.calls.find((c: any[]) => c[1]?.includes('started'));
      expect(startCall[2].endpointId).toBe('ep1');
    });

    it('should log status 500 for non-HttpException errors in bulk ops', async () => {
      mockUsersService.createUserForEndpoint!.mockRejectedValue(
        new TypeError('Cannot read properties of undefined'),
      );

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'fail' } },
      ];

      await service.process(endpointId, ops, baseUrl, config);

      const warnCalls = mockLogger.warn.mock.calls;
      const failCall = warnCalls.find((c: any[]) => c[1]?.includes('failed'));
      expect(failCall).toBeDefined();
      expect(failCall[2].status).toBe(500); // fallback for non-HttpException
    });

    it('should NOT leak internal error messages for non-HttpException in bulk response', async () => {
      mockUsersService.createUserForEndpoint!.mockRejectedValue(
        new TypeError('Cannot read properties of undefined (reading "scimId")'),
      );

      const ops: BulkOperationDto[] = [
        { method: 'POST', path: '/Users', bulkId: 'u1', data: { userName: 'leak-test' } },
      ];

      const result = await service.process(endpointId, ops, baseUrl, config);
      const failedOp = result.Operations[0];

      expect(failedOp.status).toBe('500');
      // The detail must NOT leak internal error messages (e.g., "Cannot read properties of undefined")
      expect(failedOp.response?.detail).toBe('Internal server error');
      expect(failedOp.response?.detail).not.toContain('Cannot read');
      expect(failedOp.response?.detail).not.toContain('undefined');
    });
  });
});
