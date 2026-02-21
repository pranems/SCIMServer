import { UnauthorizedException } from '@nestjs/common';
import { ScimAuthGuard } from './scim-auth.guard';

describe('ScimAuthGuard', () => {
  let guard: ScimAuthGuard;
  let mockOAuthService: any;

  function createMockContext(authHeader?: string) {
    const mockRequest: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    const mockContext: any = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    };
    return { context: mockContext, request: mockRequest };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockOAuthService = {
      validateAccessToken: jest.fn(),
    };
    // Suppress console.log/error in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    guard = new ScimAuthGuard(mockOAuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('missing auth header', () => {
    it('should throw UnauthorizedException when no authorization header', async () => {
      const { context } = createMockContext(undefined);
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Authorization header is required');
    });
  });

  describe('invalid auth type', () => {
    it('should reject non-Bearer auth type', async () => {
      const { context } = createMockContext('Basic dXNlcjpwYXNz');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Bearer token is required');
    });

    it('should reject missing token after Bearer', async () => {
      const { context } = createMockContext('Bearer ');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('OAuth token validation', () => {
    it('should authenticate with valid OAuth token', async () => {
      const mockPayload = { sub: 'client', client_id: 'client-1', scope: 'scim.read' };
      mockOAuthService.validateAccessToken.mockResolvedValue(mockPayload);

      const { context, request } = createMockContext('Bearer valid-jwt-token');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('oauth');
      expect(request.oauth).toEqual(mockPayload);
    });

    it('should call validateAccessToken with the token', async () => {
      mockOAuthService.validateAccessToken.mockResolvedValue({ sub: 'c', client_id: 'c' });

      const { context } = createMockContext('Bearer my-jwt');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).toHaveBeenCalledWith('my-jwt');
    });
  });

  describe('legacy bearer token', () => {
    it('should authenticate with legacy bearer token', async () => {
      // The legacy token is hardcoded in the guard
      const { context, request } = createMockContext('Bearer S@g@r!2011');
      const result = await guard.canActivate(context);
      expect(result).toBe(true);
      expect(request.authType).toBe('legacy');
    });

    it('should not call OAuth validation for legacy token', async () => {
      const { context } = createMockContext('Bearer S@g@r!2011');
      await guard.canActivate(context);
      expect(mockOAuthService.validateAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('failed authentication', () => {
    it('should throw UnauthorizedException when OAuth validation fails', async () => {
      mockOAuthService.validateAccessToken.mockRejectedValue(new Error('token invalid'));

      const { context } = createMockContext('Bearer invalid-token');
      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow('Invalid or expired token');
    });
  });
});
