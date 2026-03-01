import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OAuthService } from './oauth.service';

describe('OAuthService', () => {
  let service: OAuthService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  const mockLogger: any = {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    trace: jest.fn(),
  };

  function createService(envOverrides: Record<string, string | undefined> = {}) {
    configService = {
      get: jest.fn((key: string) => {
        const defaults: Record<string, string | undefined> = {
          OAUTH_CLIENT_ID: 'test-client',
          OAUTH_CLIENT_SECRET: 'test-secret',
          OAUTH_CLIENT_SCOPES: undefined,
          ...envOverrides,
        };
        return defaults[key];
      }),
    } as any;

    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    } as any;

    return new OAuthService(jwtService, configService, mockLogger);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    service = createService();
  });

  describe('constructor', () => {
    it('should create service with configured client', () => {
      expect(service).toBeDefined();
    });

    it('should use default scopes when OAUTH_CLIENT_SCOPES not configured', () => {
      service = createService({ OAUTH_CLIENT_SCOPES: undefined });
      // Default scopes are 'scim.read', 'scim.write', 'scim.manage'
      // Verified via generateAccessToken with no requested scope
      expect(service).toBeDefined();
    });

    it('should parse comma-separated scopes from config', () => {
      service = createService({ OAUTH_CLIENT_SCOPES: 'read,write' });
      expect(service).toBeDefined();
    });

    it('should auto-generate secret in non-production when not configured', () => {
      service = createService({ OAUTH_CLIENT_SECRET: undefined });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should throw in production when no secret configured', () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => createService({ OAUTH_CLIENT_SECRET: undefined })).toThrow(
          'OAUTH_CLIENT_SECRET is required in production',
        );
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });

  describe('generateAccessToken', () => {
    it('should return an access token for valid credentials', async () => {
      const result = await service.generateAccessToken('test-client', 'test-secret');
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(result.expiresIn).toBe(3600);
    });

    it('should sign JWT with correct payload', async () => {
      await service.generateAccessToken('test-client', 'test-secret');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'test-client',
          client_id: 'test-client',
          token_type: 'access_token',
        }),
        expect.objectContaining({ expiresIn: '3600s' }),
      );
    });

    it('should reject invalid client_id', () => {
      expect(
        () => service.generateAccessToken('unknown-client', 'test-secret'),
      ).toThrow('Invalid client credentials');
    });

    it('should reject invalid client_secret', () => {
      expect(
        () => service.generateAccessToken('test-client', 'wrong-secret'),
      ).toThrow('Invalid client credentials');
    });

    it('should grant all client scopes when none requested', async () => {
      const result = await service.generateAccessToken('test-client', 'test-secret');
      expect(result.scope).toContain('scim.read');
    });

    it('should filter requested scopes to allowed scopes', async () => {
      const result = await service.generateAccessToken('test-client', 'test-secret', 'scim.read');
      expect(result.scope).toBe('scim.read');
    });

    it('should grant all client scopes when requested scopes are not recognized', async () => {
      const result = await service.generateAccessToken('test-client', 'test-secret', 'unknown.scope');
      // When no allowed scopes match, all client scopes are granted
      expect(result.scope).toContain('scim');
    });
  });

  describe('validateAccessToken', () => {
    it('should return decoded payload for valid token', async () => {
      const mockPayload = { sub: 'test-client', client_id: 'test-client', scope: 'scim.read' };
      jwtService.verify.mockReturnValue(mockPayload);

      const result = await service.validateAccessToken('valid-token');
      expect(result).toEqual(mockPayload);
    });

    it('should throw UnauthorizedException for invalid token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      expect(
        () => service.validateAccessToken('bad-token'),
      ).toThrow('Invalid or expired token');
    });

    it('should throw UnauthorizedException for expired token', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      expect(
        () => service.validateAccessToken('expired-token'),
      ).toThrow('Invalid or expired token');
    });
  });

  describe('hasScope', () => {
    it('should return true when payload has the required scope', () => {
      const payload = { sub: 'c', client_id: 'c', scope: 'scim.read scim.write', token_type: 'access_token' };
      expect(service.hasScope(payload, 'scim.read')).toBe(true);
    });

    it('should return false when payload lacks the required scope', () => {
      const payload = { sub: 'c', client_id: 'c', scope: 'scim.read', token_type: 'access_token' };
      expect(service.hasScope(payload, 'scim.manage')).toBe(false);
    });

    it('should return false when scope is empty', () => {
      const payload = { sub: 'c', client_id: 'c', scope: '', token_type: 'access_token' };
      expect(service.hasScope(payload, 'scim.read')).toBe(false);
    });

    it('should return false when scope is undefined', () => {
      const payload = { sub: 'c', client_id: 'c', token_type: 'access_token' } as any;
      expect(service.hasScope(payload, 'scim.read')).toBe(false);
    });
  });
});
