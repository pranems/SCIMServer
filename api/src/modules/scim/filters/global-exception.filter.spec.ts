import { HttpException, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';
import { ScimLogger } from '../../logging/scim-logger.service';
import * as scimLoggerModule from '../../logging/scim-logger.service';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: {
    status: jest.Mock;
    setHeader: jest.Mock;
    json: jest.Mock;
  };
  let mockHost: any;

  const mockScimLogger = {
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    isEnabled: jest.fn().mockReturnValue(true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new GlobalExceptionFilter(mockScimLogger as unknown as ScimLogger);
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  function createHost(url: string = '/scim/endpoints/ep-123/Users'): any {
    return {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ originalUrl: url, url, method: 'POST' }),
      }),
      getArgs: () => [],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({}),
      switchToWs: () => ({}),
      getType: () => 'http',
    };
  }

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  // ─── HttpException passthrough ────────────────────────────────────

  describe('HttpException passthrough', () => {
    it('should re-throw HttpException to let ScimExceptionFilter handle it', () => {
      const httpException = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      const host = createHost();

      expect(() => filter.catch(httpException, host)).toThrow(HttpException);
      expect(mockResponse.status).not.toHaveBeenCalled();
      expect(mockScimLogger.error).not.toHaveBeenCalled();
    });
  });

  // ─── SCIM routes: raw Error handling ──────────────────────────────

  describe('SCIM routes — raw Error', () => {
    it('should return SCIM-compliant 500 for raw Error on SCIM route', () => {
      const error = new Error('User with id xyz not found');
      const host = createHost('/scim/endpoints/ep-123/Users');

      filter.catch(error, host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/scim+json; charset=utf-8',
      );
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.detail).toBe('Internal server error');
      expect(body.status).toBe('500');
      expect(typeof body.status).toBe('string');
    });

    it('should log at ERROR level with error details', () => {
      const error = new Error('Connection timed out');
      const host = createHost('/scim/endpoints/ep-123/Users');

      filter.catch(error, host);

      expect(mockScimLogger.error).toHaveBeenCalledTimes(1);
      const [category, message, errorArg, data] = mockScimLogger.error.mock.calls[0];
      expect(category).toBe('http');
      expect(message).toContain('Unhandled');
      expect(message).toContain('Error');
      expect(message).toContain('POST');
      expect(errorArg).toBe(error);
      expect(data.status).toBe(500);
      expect(data.errorType).toBe('Error');
      expect(data.errorMessage).toBe('Connection timed out');
    });

    it('should handle TypeError (e.g., from PatchEngine)', () => {
      const error = new TypeError('Cannot read properties of undefined');
      const host = createHost('/scim/endpoints/ep-123/Users/usr-456');

      filter.catch(error, host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.detail).toBe('Internal server error');

      const [, message, , data] = mockScimLogger.error.mock.calls[0];
      expect(message).toContain('TypeError');
      expect(data.errorType).toBe('TypeError');
    });

    it('should not expose internal error message in response body', () => {
      const error = new Error('FATAL: password authentication failed for user "scim"');
      const host = createHost('/scim/v2/Users');

      filter.catch(error, host);

      const body = mockResponse.json.mock.calls[0][0];
      // Detail must be generic — NEVER leak internal error messages to clients
      expect(body.detail).toBe('Internal server error');
      expect(body.detail).not.toContain('password');
      expect(body.detail).not.toContain('FATAL');
    });
  });

  // ─── SCIM routes: non-Error values ────────────────────────────────

  describe('SCIM routes — non-Error thrown values', () => {
    it('should handle string thrown value', () => {
      const host = createHost('/scim/endpoints/ep-123/Groups');

      filter.catch('something went wrong', host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.detail).toBe('Internal server error');

      expect(mockScimLogger.error).toHaveBeenCalled();
      const [, , , data] = mockScimLogger.error.mock.calls[0];
      expect(data.errorType).toBe('string');
    });

    it('should handle null/undefined thrown value', () => {
      const host = createHost('/scim/endpoints/ep-123/Users');

      filter.catch(null, host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.status).toBe('500');
    });
  });

  // ─── Non-SCIM routes ─────────────────────────────────────────────

  describe('Non-SCIM routes', () => {
    it('should return NestJS-style JSON error for non-SCIM routes', () => {
      const error = new Error('Template not found');
      const host = createHost('/admin/dashboard');

      filter.catch(error, host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.setHeader).not.toHaveBeenCalled(); // No SCIM Content-Type
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('Template not found');
      // Non-SCIM should NOT have schemas array
      expect(body.schemas).toBeUndefined();
    });

    it('should still log at ERROR for non-SCIM route errors', () => {
      const error = new Error('Static file missing');
      const host = createHost('/admin/config');

      filter.catch(error, host);

      expect(mockScimLogger.error).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Error type identification ────────────────────────────────────

  describe('Error type identification in logs', () => {
    it('should identify PrismaClientKnownRequestError by constructor name', () => {
      // Simulate Prisma error (without importing Prisma)
      class PrismaClientKnownRequestError extends Error {
        code = 'P2025';
        constructor(msg: string) { super(msg); this.name = 'PrismaClientKnownRequestError'; }
      }
      const error = new PrismaClientKnownRequestError('Record to delete does not exist.');
      const host = createHost('/scim/endpoints/ep-123/Users/usr-456');

      filter.catch(error, host);

      const [, message, , data] = mockScimLogger.error.mock.calls[0];
      expect(message).toContain('PrismaClientKnownRequestError');
      expect(data.errorType).toBe('PrismaClientKnownRequestError');
      expect(data.errorMessage).toBe('Record to delete does not exist.');
    });
  });

  // ─── Edge cases (gap audit) ───────────────────────────────────────

  describe('edge cases', () => {
    it('should handle non-Error thrown on non-SCIM route with generic message', () => {
      const host = createHost('/admin/dashboard');

      filter.catch(42, host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const body = mockResponse.json.mock.calls[0][0];
      // Non-SCIM route: NestJS-style error, message falls back to 'Internal Server Error'
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe('Internal Server Error');
    });

    it('should handle request with missing originalUrl', () => {
      const host = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => ({ url: '/scim/fallback', method: 'GET' }),
        }),
        getArgs: () => [],
        getArgByIndex: () => undefined,
        switchToRpc: () => ({}),
        switchToWs: () => ({}),
        getType: () => 'http',
      } as any;

      filter.catch(new Error('test'), host);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      // Should not crash even without originalUrl
      expect(mockScimLogger.error).toHaveBeenCalled();
    });
  });

  // ─── P2: Diagnostics extension on 500 responses ──────────────────

  describe('Diagnostics extension on 500 (P2)', () => {
    let getCtxSpy: jest.SpyInstance;

    afterEach(() => {
      getCtxSpy?.mockRestore();
    });

    it('should include diagnostics extension with requestId and logsUrl when correlation context exists', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-500-abc',
        endpointId: 'ep-500-xyz',
      } as any);

      const error = new Error('Unexpected null reference');
      const host = createHost('/scim/endpoints/ep-500-xyz/Users');

      filter.catch(error, host);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].requestId).toBe('req-500-abc');
      expect(body[SCIM_DIAGNOSTICS_URN].endpointId).toBe('ep-500-xyz');
      expect(body[SCIM_DIAGNOSTICS_URN].logsUrl).toBe(
        '/scim/endpoints/ep-500-xyz/logs/recent?requestId=req-500-abc',
      );
    });

    it('should use admin logsUrl when no endpointId in context', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-no-ep',
      } as any);

      filter.catch(new Error('crash'), createHost('/scim/ServiceProviderConfig'));

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].logsUrl).toBe(
        '/scim/admin/log-config/recent?requestId=req-no-ep',
      );
    });

    it('should NOT include diagnostics when no correlation context', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue(undefined);

      filter.catch(new Error('early crash'), createHost('/scim/Users'));

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeUndefined();
    });
  });
});
