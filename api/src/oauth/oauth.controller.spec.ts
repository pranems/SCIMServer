import { HttpException, HttpStatus } from '@nestjs/common';
import { OAuthController, TokenRequest } from './oauth.controller';

describe('OAuthController', () => {
  let controller: OAuthController;
  let mockOAuthService: any;
  const mockLogger: any = {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  };

  beforeEach(() => {
    mockOAuthService = {
      generateAccessToken: jest.fn().mockResolvedValue({
        accessToken: 'generated-token',
        expiresIn: 3600,
        scope: 'scim.read scim.write',
      }),
    };

    controller = new OAuthController(mockOAuthService, mockLogger);
  });

  describe('testEndpoint', () => {
    it('should return a health check message', () => {
      const result = controller.testEndpoint();
      expect(result.message).toBe('OAuth controller is working!');
      expect(result.version).toBe('1.1');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getToken', () => {
    const validRequest: TokenRequest = {
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-secret',
      scope: 'scim.read',
    };

    it('should return a token response for valid credentials', async () => {
      const result = await controller.getToken(validRequest);
      expect(result.access_token).toBe('generated-token');
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(3600);
      expect(result.scope).toBe('scim.read scim.write');
    });

    it('should call OAuthService with correct parameters', async () => {
      await controller.getToken(validRequest);
      expect(mockOAuthService.generateAccessToken).toHaveBeenCalledWith(
        'test-client',
        'test-secret',
        'scim.read',
      );
    });

    it('should reject unsupported grant_type', async () => {
      const req: TokenRequest = { ...validRequest, grant_type: 'authorization_code' };
      await expect(controller.getToken(req)).rejects.toThrow(HttpException);

      try {
        await controller.getToken(req);
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const body = (err as HttpException).getResponse() as any;
        expect(body.error).toBe('unsupported_grant_type');
      }
    });

    it('should reject missing client_id', async () => {
      const req = { grant_type: 'client_credentials', client_secret: 'secret' } as TokenRequest;
      await expect(controller.getToken(req)).rejects.toThrow(HttpException);

      try {
        await controller.getToken(req);
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const body = (err as HttpException).getResponse() as any;
        expect(body.error).toBe('invalid_request');
      }
    });

    it('should reject missing client_secret', async () => {
      const req = { grant_type: 'client_credentials', client_id: 'client' } as TokenRequest;
      await expect(controller.getToken(req)).rejects.toThrow(HttpException);
    });

    it('should return 401 when OAuthService throws', async () => {
      mockOAuthService.generateAccessToken.mockRejectedValue(new Error('Invalid credentials'));

      await expect(controller.getToken(validRequest)).rejects.toThrow(HttpException);

      try {
        await controller.getToken(validRequest);
      } catch (err) {
        expect((err as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        const body = (err as HttpException).getResponse() as any;
        expect(body.error).toBe('invalid_client');
      }
    });

    it('should pass scope to generateAccessToken when provided', async () => {
      const req: TokenRequest = { ...validRequest, scope: 'scim.manage' };
      await controller.getToken(req);
      expect(mockOAuthService.generateAccessToken).toHaveBeenCalledWith(
        'test-client', 'test-secret', 'scim.manage',
      );
    });

    it('should pass undefined scope when not provided', async () => {
      const req: TokenRequest = { grant_type: 'client_credentials', client_id: 'c', client_secret: 's' };
      await controller.getToken(req);
      expect(mockOAuthService.generateAccessToken).toHaveBeenCalledWith('c', 's', undefined);
    });
  });
});
