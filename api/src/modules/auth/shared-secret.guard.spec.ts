import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SharedSecretGuard } from './shared-secret.guard';

describe('SharedSecretGuard', () => {
  let guard: SharedSecretGuard;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockOAuthService: any;
  let mockReflector: jest.Mocked<Reflector>;
  let mockLogger: any;
  let mockCredentialRepo: any;
  let mockEndpointService: any;

  function createMockContext(authHeader?: string, isPublic = false) {
    const mockResponse = {
      setHeader: jest.fn(),
    };
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      url: '/some/path',
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    // Set up reflector to return isPublic value
    mockReflector.getAllAndOverride.mockReturnValue(isPublic);

    return { context: mockContext, request: mockRequest, response: mockResponse };
  }

  /** Helper: create a mock context with an endpoint-scoped URL */
  function createEndpointMockContext(endpointId: string, authHeader?: string) {
    const mockResponse = { setHeader: jest.fn() };
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
      url: `/endpoints/${endpointId}/Users`,
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };
    mockReflector.getAllAndOverride.mockReturnValue(false);
    return { context: mockContext, request: mockRequest, response: mockResponse };
  }

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigService = {
      get: jest.fn().mockReturnValue('test-shared-secret'),
    } as any;

    mockOAuthService = {
      validateAccessToken: jest.fn(),
    };

    mockReflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as any;

    mockLogger = {
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    };

    mockCredentialRepo = {
      findActiveByEndpoint: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      findById: jest.fn(),
      findByEndpoint: jest.fn(),
      deactivate: jest.fn(),
      delete: jest.fn(),
    };

    mockEndpointService = {
      getEndpoint: jest.fn().mockResolvedValue({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'test',
        config: {},
        active: true,
      }),
    };

    guard = new SharedSecretGuard(
      mockConfigService,
      mockOAuthService,
      mockReflector,
      mockLogger,
      mockCredentialRepo,
      mockEndpointService,
    );
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('public routes', () => {
    it('should allow access to public routes without auth', async () => {
      const { context } = createMockContext(undefined, true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });

    it('should allow access to public routes even with auth header', async () => {
      const { context } = createMockContext('Bearer some-token', true);
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
    });
  });

  describe('missing auth header', () => {
    it('should reject request without authorization header', async () => {
      const { context } = createMockContext(undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });

    it('should reject request with non-Bearer auth', async () => {
      const { context } = createMockContext('Basic dXNlcjpwYXNz');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('legacy bearer token', () => {
    it('should authenticate with valid shared secret', async () => {
      const { context, request } = createMockContext('Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should not call OAuth validation for matching shared secret', async () => {
      const { context } = createMockContext('Bearer test-shared-secret');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('OAuth token validation', () => {
    it('should authenticate with valid OAuth token', async () => {
      const mockPayload = { sub: 'client', client_id: 'client-1', scope: 'scim.read' };
      mockOAuthService.validateAccessToken.mockResolvedValue(mockPayload);

      const { context, request } = createMockContext('Bearer oauth-jwt-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
      expect(request.oauth).toEqual(mockPayload);
    });

    it('should try OAuth first when token does not match shared secret', async () => {
      const mockPayload = { sub: 'c', client_id: 'c', scope: 's' };
      mockOAuthService.validateAccessToken.mockResolvedValue(mockPayload);

      const { context } = createMockContext('Bearer some-jwt');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).toHaveBeenCalledWith('some-jwt');
    });

    it('should reject when both OAuth and legacy fail', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('invalid'));

      const { context } = createMockContext('Bearer wrong-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('auto-generated secret in dev mode', () => {
    it('should auto-generate secret when SCIM_SHARED_SECRET not configured', async () => {
      const origSecret = process.env.SCIM_SHARED_SECRET;
      delete process.env.SCIM_SHARED_SECRET;

      mockConfigService.get.mockReturnValue(undefined);
      guard = new SharedSecretGuard(mockConfigService, mockOAuthService, mockReflector, mockLogger, mockCredentialRepo, mockEndpointService);

      // First call triggers auto-generation and rejects (we don't know the secret yet)
      // but the secret is now in process.env.SCIM_SHARED_SECRET
      const { context: ctx1 } = createMockContext('Bearer dummy');
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('invalid'));
      try { await guard.canActivate(ctx1); } catch { /* expected rejection */ }

      // Secret should have been generated and stored in process.env
      const generatedSecret = process.env.SCIM_SHARED_SECRET as unknown as string;
      expect(generatedSecret).toBeDefined();
      expect(generatedSecret.length).toBeGreaterThan(10);

      // Update mock so ConfigService returns the generated secret on subsequent calls
      mockConfigService.get.mockReturnValue(generatedSecret);

      // Second call with the generated secret should succeed
      const { context: ctx2, request: req2 } = createMockContext(`Bearer ${generatedSecret}`);
      const result = await guard.canActivate(ctx2);
      expect(result).toBe(true);
      expect(req2.authType).toBe('legacy');

      // Restore
      if (origSecret) {
        process.env.SCIM_SHARED_SECRET = origSecret;
      } else {
        delete process.env.SCIM_SHARED_SECRET;
      }
    });
  });

  describe('per-endpoint credentials', () => {
    const endpointId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('should skip per-endpoint check when flag is disabled', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        config: { PerEndpointCredentialsEnabled: false },
        active: true,
      });

      // Use endpoint-scoped URL but with legacy token
      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should authenticate with valid per-endpoint credential', async () => {
      // bcrypt: mock module at top of test
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('my-endpoint-token', 10);

      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        config: { PerEndpointCredentialsEnabled: true },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        {
          id: 'cred-1',
          endpointId,
          credentialType: 'bearer',
          credentialHash: hash,
          label: 'Test',
          active: true,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer my-endpoint-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('endpoint_credential');
      expect(request.authCredentialId).toBe('cred-1');
    });

    it('should fall back to legacy when per-endpoint credential does not match', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        config: { PerEndpointCredentialsEnabled: true },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([
        {
          id: 'cred-1',
          endpointId,
          credentialType: 'bearer',
          credentialHash: '$2b$10$invalidhashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          label: 'Test',
          active: true,
          createdAt: new Date(),
          expiresAt: null,
        },
      ]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy'); // Fell back to global secret
    });

    it('should fall back to legacy when no active credentials exist', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        config: { PerEndpointCredentialsEnabled: true },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([]);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should fall back to OAuth when per-endpoint check fails and token is not legacy', async () => {
      mockEndpointService.getEndpoint.mockResolvedValue({
        id: endpointId,
        name: 'test',
        config: { PerEndpointCredentialsEnabled: true },
        active: true,
      });
      mockCredentialRepo.findActiveByEndpoint.mockResolvedValue([]);

      const oauthPayload = { sub: 'client', client_id: 'c', scope: 's' };
      mockOAuthService.validateAccessToken.mockResolvedValue(oauthPayload);

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer some-jwt');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
    });

    it('should not check per-endpoint credentials for non-endpoint URLs', async () => {
      // URL without /endpoints/:uuid/ pattern, using legacy secret
      const { context, request } = createMockContext('Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
      expect(mockEndpointService.getEndpoint).not.toHaveBeenCalled();
    });

    it('should handle endpoint service errors gracefully and fall back', async () => {
      mockEndpointService.getEndpoint.mockRejectedValue(new Error('DB error'));

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy'); // Graceful fallback
    });

    it('should work without credential repo (optional injection)', async () => {
      const guardNoRepo = new SharedSecretGuard(
        mockConfigService,
        mockOAuthService,
        mockReflector,
        mockLogger,
        null,  // no credential repo
        null,  // no endpoint service
      );

      const { context, request } = createEndpointMockContext(endpointId, 'Bearer test-shared-secret');
      const result = await guardNoRepo.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });
  });
});
