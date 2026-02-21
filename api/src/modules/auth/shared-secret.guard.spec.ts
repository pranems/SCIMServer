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

  function createMockContext(authHeader?: string, isPublic = false) {
    const mockResponse = {
      setHeader: jest.fn(),
    };
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
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

    guard = new SharedSecretGuard(
      mockConfigService,
      mockOAuthService,
      mockReflector,
      mockLogger,
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
      guard = new SharedSecretGuard(mockConfigService, mockOAuthService, mockReflector, mockLogger);

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
});
