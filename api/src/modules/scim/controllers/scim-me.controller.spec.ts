/**
 * Unit tests for ScimMeController (Phase 10 — RFC 7644 §3.11)
 *
 * Tests cover:
 *  - GET /Me: resolves authenticated user and delegates to Users service
 *  - PUT /Me: replace via resolved user id
 *  - PATCH /Me: partial update via resolved user id
 *  - DELETE /Me: delete via resolved user id
 *  - Identity resolution error cases (no OAuth, no sub, no matching User)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, ForbiddenException } from '@nestjs/common';
import { ScimMeController } from './scim-me.controller';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';

describe('ScimMeController', () => {
  let controller: ScimMeController;
  let usersService: Record<string, jest.Mock>;

  const mockEndpoint = {
    id: 'ep-1',
    name: 'test',
    displayName: 'Test',
    description: '',
    config: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserResource = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: 'scim-user-123',
    userName: 'alice',
    displayName: 'Alice',
    active: true,
    meta: {
      resourceType: 'User',
      created: '2024-01-01T00:00:00.000Z',
      lastModified: '2024-01-01T00:00:00.000Z',
      location: 'http://localhost:3000/endpoints/ep-1/Users/scim-user-123',
      version: 'W/"v1"',
    },
  };

  const buildReq = (overrides: Record<string, unknown> = {}) =>
    ({
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000'),
      originalUrl: '/scim/endpoints/ep-1/Me',
      headers: {},
      authType: 'oauth',
      oauth: { sub: 'alice', client_id: 'test-client' },
      ...overrides,
    }) as any;

  beforeEach(async () => {
    usersService = {
      listUsersForEndpoint: jest.fn(),
      getUserForEndpoint: jest.fn(),
      replaceUserForEndpoint: jest.fn(),
      patchUserForEndpoint: jest.fn(),
      deleteUserForEndpoint: jest.fn(),
      getRequestOnlyAttributes: jest.fn().mockReturnValue(new Set()),
    };

    const mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue(mockEndpoint),
    };

    const mockEndpointContext = {
      setContext: jest.fn(),
      getContext: jest.fn(),
      getEndpointId: jest.fn(),
      getBaseUrl: jest.fn(),
      getConfig: jest.fn().mockReturnValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScimMeController],
      providers: [
        { provide: EndpointService, useValue: mockEndpointService },
        { provide: EndpointContextStorage, useValue: mockEndpointContext },
        { provide: EndpointScimUsersService, useValue: usersService },
      ],
    }).compile();

    controller = module.get<ScimMeController>(ScimMeController);
  });

  // ─── Helper: setup identity resolution mock ─────────────────────

  const setupIdentityResolution = (scimId = 'scim-user-123') => {
    usersService.listUsersForEndpoint.mockResolvedValue({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [{ ...mockUserResource, id: scimId }],
    });
  };

  // ─── GET /Me ────────────────────────────────────────────────────

  describe('GET /Me', () => {
    it('should return the authenticated user resource', async () => {
      setupIdentityResolution();
      usersService.getUserForEndpoint.mockResolvedValue(mockUserResource);

      const result = await controller.getMe('ep-1', buildReq());

      expect(usersService.listUsersForEndpoint).toHaveBeenCalledWith(
        expect.objectContaining({ filter: 'userName eq "alice"' }),
        expect.any(String),
        'ep-1',
        expect.any(Object),
      );
      expect(usersService.getUserForEndpoint).toHaveBeenCalledWith(
        'scim-user-123',
        expect.any(String),
        'ep-1',
        expect.any(Object),
      );
      expect(result).toMatchObject({ id: 'scim-user-123', userName: 'alice' });
    });

    it('should support attributes query parameter', async () => {
      setupIdentityResolution();
      usersService.getUserForEndpoint.mockResolvedValue({
        ...mockUserResource,
        displayName: 'Alice',
        userName: 'alice',
      });

      const result = await controller.getMe('ep-1', buildReq(), 'userName');

      // With projection, only specified attributes + id/schemas/meta should be present
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('userName');
    });
  });

  // ─── PUT /Me ────────────────────────────────────────────────────

  describe('PUT /Me', () => {
    it('should replace the authenticated user resource', async () => {
      setupIdentityResolution();
      usersService.replaceUserForEndpoint.mockResolvedValue(mockUserResource);

      const dto = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'alice',
        displayName: 'Alice Updated',
      };

      const result = await controller.replaceMe('ep-1', dto as any, buildReq());

      expect(usersService.replaceUserForEndpoint).toHaveBeenCalledWith(
        'scim-user-123',
        dto,
        expect.any(String),
        'ep-1',
        expect.any(Object),
        undefined, // ifMatch
      );
      expect(result).toMatchObject({ id: 'scim-user-123' });
    });

    it('should pass If-Match header', async () => {
      setupIdentityResolution();
      usersService.replaceUserForEndpoint.mockResolvedValue(mockUserResource);

      const req = buildReq({ headers: { 'if-match': 'W/"v1"' } });
      await controller.replaceMe('ep-1', { schemas: [], userName: 'a' } as any, req);

      expect(usersService.replaceUserForEndpoint).toHaveBeenCalledWith(
        'scim-user-123',
        expect.any(Object),
        expect.any(String),
        'ep-1',
        expect.any(Object),
        'W/"v1"',
      );
    });
  });

  // ─── PATCH /Me ──────────────────────────────────────────────────

  describe('PATCH /Me', () => {
    it('should patch the authenticated user resource', async () => {
      setupIdentityResolution();
      usersService.patchUserForEndpoint.mockResolvedValue(mockUserResource);

      const dto = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Alice V2' }],
      };

      const result = await controller.patchMe('ep-1', dto as any, buildReq());

      expect(usersService.patchUserForEndpoint).toHaveBeenCalledWith(
        'scim-user-123',
        dto,
        expect.any(String),
        'ep-1',
        expect.any(Object),
        undefined,
      );
      expect(result).toMatchObject({ id: 'scim-user-123' });
    });
  });

  // ─── DELETE /Me ─────────────────────────────────────────────────

  describe('DELETE /Me', () => {
    it('should delete the authenticated user resource', async () => {
      setupIdentityResolution();
      usersService.deleteUserForEndpoint.mockResolvedValue(undefined);

      await controller.deleteMe('ep-1', buildReq());

      expect(usersService.deleteUserForEndpoint).toHaveBeenCalledWith(
        'scim-user-123',
        'ep-1',
        expect.any(Object),
        undefined,
      );
    });
  });

  // ─── Identity Resolution Errors ─────────────────────────────────

  describe('identity resolution errors', () => {
    it('should throw 404 when auth type is legacy (no OAuth)', async () => {
      const req = buildReq({ authType: 'legacy', oauth: undefined });

      await expect(controller.getMe('ep-1', req)).rejects.toThrow(HttpException);
      try {
        await controller.getMe('ep-1', req);
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
        expect(e.getResponse()).toMatchObject({
          detail: expect.stringContaining('OAuth authentication'),
        });
      }
    });

    it('should throw 404 when oauth is undefined', async () => {
      const req = buildReq({ authType: 'oauth', oauth: undefined });

      await expect(controller.getMe('ep-1', req)).rejects.toThrow(HttpException);
    });

    it('should throw 404 when sub claim is missing', async () => {
      const req = buildReq({ oauth: { client_id: 'test' } }); // no sub

      await expect(controller.getMe('ep-1', req)).rejects.toThrow(HttpException);
      try {
        await controller.getMe('ep-1', req);
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
        expect(e.getResponse()).toMatchObject({
          detail: expect.stringContaining('sub'),
        });
      }
    });

    it('should throw 404 when no User matches the sub claim', async () => {
      usersService.listUsersForEndpoint.mockResolvedValue({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 0,
        startIndex: 1,
        itemsPerPage: 0,
        Resources: [],
      });

      const req = buildReq({ oauth: { sub: 'unknown-user' } });

      await expect(controller.getMe('ep-1', req)).rejects.toThrow(HttpException);
      try {
        await controller.getMe('ep-1', req);
      } catch (e: any) {
        expect(e.getStatus()).toBe(404);
        expect(e.getResponse()).toMatchObject({
          detail: expect.stringContaining('unknown-user'),
        });
      }
    });

    it('should throw ForbiddenException when endpoint is inactive', async () => {
      // Override the endpoint service to return inactive
      const module: TestingModule = await Test.createTestingModule({
        controllers: [ScimMeController],
        providers: [
          {
            provide: EndpointService,
            useValue: { getEndpoint: jest.fn().mockResolvedValue({ ...mockEndpoint, active: false }) },
          },
          { provide: EndpointContextStorage, useValue: { setContext: jest.fn() } },
          { provide: EndpointScimUsersService, useValue: usersService },
        ],
      }).compile();

      const ctrl = module.get<ScimMeController>(ScimMeController);
      await expect(ctrl.getMe('ep-1', buildReq())).rejects.toThrow(ForbiddenException);
    });
  });
});
