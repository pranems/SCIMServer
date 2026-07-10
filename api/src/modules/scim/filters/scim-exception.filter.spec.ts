import { HttpException, HttpStatus } from '@nestjs/common';
import { ScimExceptionFilter } from './scim-exception.filter';
import { createScimError } from '../common/scim-errors';
import { SCIM_ERROR_SCHEMA, SCIM_DIAGNOSTICS_URN } from '../common/scim-constants';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LoggingService } from '../../logging/logging.service';
import { REQUEST_LOGGING_META_KEY } from '../../logging/request-logging.interceptor';
import * as scimLoggerModule from '../../logging/scim-logger.service';

describe('ScimExceptionFilter', () => {
  let filter: ScimExceptionFilter;
  let mockResponse: {
    status: jest.Mock;
    setHeader: jest.Mock;
    json: jest.Mock;
    getHeaders: jest.Mock;
  };
  let mockRequest: any;
  let mockHost: any;
  let mockLoggingService: { recordRequest: jest.Mock };

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
    mockLoggingService = { recordRequest: jest.fn() };
    filter = new ScimExceptionFilter(
      mockScimLogger as unknown as ScimLogger,
      mockLoggingService as unknown as LoggingService,
    );
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      getHeaders: jest.fn().mockReturnValue({}),
      getHeader: jest.fn().mockReturnValue('req-abc-123'),
    } as any;
    mockRequest = {
      originalUrl: '/scim/Users',
      url: '/scim/Users',
      method: 'POST',
      headers: { 'user-agent': 'test' },
      body: {},
      [REQUEST_LOGGING_META_KEY]: {
        startedAt: Date.now() - 50,
        requestHeaders: { 'user-agent': 'test' },
        requestBody: {},
        endpointId: undefined,
      },
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('WI-D1 OAuth token-endpoint error passthrough (RFC 6749)', () => {
    beforeEach(() => {
      mockRequest.originalUrl = '/scim/oauth/token';
      mockRequest.url = '/scim/oauth/token';
      mockRequest.method = 'POST';
    });

    it('returns a flat RFC-6749 error body (no SCIM schemas wrapper) as application/json', () => {
      const exception = new HttpException(
        { error: 'invalid_client', error_description: 'Client authentication failed.' },
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8',
      );
      const body = mockResponse.json.mock.calls[0][0];
      expect(body.error).toBe('invalid_client');
      expect(body.error_description).toBe('Client authentication failed.');
      expect(body.schemas).toBeUndefined();
      expect(body.scimType).toBeUndefined();
    });

    it('always enriches with correlation_id (from X-Request-Id) and timestamp', () => {
      const exception = new HttpException(
        { error: 'invalid_grant', error_description: 'The provided assertion is expired.' },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(typeof body.correlation_id).toBe('string');
      expect(body.correlation_id).toBe('req-abc-123');
      expect(typeof body.timestamp).toBe('string');
      expect(() => new Date(body.timestamp as string).toISOString()).not.toThrow();
    });

    it('fills error_description from the WI-D2 catalog when a known reason_code has no description', () => {
      const exception = new HttpException(
        { error: 'invalid_client', reason_code: 'wif_audience_mismatch' },
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.reason_code).toBe('wif_audience_mismatch');
      expect(body.error_description).toMatch(/audience/i);
    });

    it('passes through curated diagnostics fields (reason_code, error_uri) when present', () => {
      const exception = new HttpException(
        {
          error: 'invalid_client',
          error_description: 'JWKS host not on the allowlist.',
          reason_code: 'jwks_host_not_allowlisted',
          error_uri: 'https://example/docs/auth-errors#jwks_host_not_allowlisted',
        },
        HttpStatus.UNAUTHORIZED,
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.reason_code).toBe('jwks_host_not_allowlisted');
      expect(body.error_uri).toBe('https://example/docs/auth-errors#jwks_host_not_allowlisted');
    });

    it('does NOT touch a non-OAuth-error body on the token path (falls through to SCIM handling)', () => {
      const exception = createScimError({
        status: 500,
        scimType: undefined,
        detail: 'Unexpected token-endpoint failure.',
      });

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      // SCIM error shape retained because the body had no string `error` field.
      expect(body.schemas).toBeDefined();
    });
  });

  describe('SCIM error responses (via createScimError)', () => {
    it('should set Content-Type to application/scim+json for 404 errors', () => {
      const exception = createScimError({
        status: 404,
        scimType: 'noTarget',
        detail: 'Resource abc-123 not found.',
      });

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/scim+json; charset=utf-8'
      );
    });

    it('should return status as a string per RFC 7644 §3.12', () => {
      const exception = createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: 'A resource with userName "test" already exists.',
      });

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.status).toBe('409');
      expect(typeof body.status).toBe('string');
    });

    it('should preserve SCIM error body (schemas, detail, scimType)', () => {
      const exception = createScimError({
        status: 400,
        scimType: 'invalidValue',
        detail: 'Patch operation is not supported.',
      });

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.detail).toBe('Patch operation is not supported.');
      expect(body.scimType).toBe('invalidValue');
      expect(body.status).toBe('400');
    });

    it('should handle 409 Conflict (uniqueness) correctly', () => {
      const exception = createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: 'Duplicate userName.',
      });

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(mockResponse.status).toHaveBeenCalledWith(409);
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.status).toBe('409');
      expect(body.scimType).toBe('uniqueness');
    });

    it('should handle 500 Internal Server Error correctly', () => {
      const exception = createScimError({
        status: 500,
        detail: 'Failed to retrieve updated group.',
      });

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(body.status).toBe('500');
      expect(body.scimType).toBeUndefined();
    });
  });

  describe('Non-SCIM HttpExceptions', () => {
    it('should wrap generic HttpExceptions in SCIM error format', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.status).toBe('403');
      expect(body.detail).toBe('Forbidden');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/scim+json; charset=utf-8'
      );
    });

    it('should handle object-based HttpException responses', () => {
      const exception = new HttpException(
        { message: 'Validation failed', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
      expect(body.status).toBe('400');
      expect(body.detail).toBe('Validation failed');
    });

    it('should fallback to error field when message is not present', () => {
      const exception = new HttpException(
        { error: 'Not Acceptable' },
        HttpStatus.NOT_ACCEPTABLE
      );

      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body.detail).toBe('Not Acceptable');
    });
  });

  describe('Diagnostics enrichment (G.4)', () => {
    let getCtxSpy: jest.SpyInstance;

    afterEach(() => {
      getCtxSpy?.mockRestore();
    });

    it('should add diagnostics extension to non-createScimError HttpExceptions when correlation context exists', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-abc',
        endpointId: 'ep-123',
      } as any);

      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].requestId).toBe('req-abc');
      expect(body[SCIM_DIAGNOSTICS_URN].endpointId).toBe('ep-123');
      expect(body[SCIM_DIAGNOSTICS_URN].logsUrl).toBe('/scim/endpoints/ep-123/logs/recent?requestId=req-abc');
    });

    it('should use admin logsUrl when no endpointId in correlation context', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-xyz',
      } as any);

      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(body[SCIM_DIAGNOSTICS_URN].requestId).toBe('req-xyz');
      expect(body[SCIM_DIAGNOSTICS_URN].logsUrl).toBe('/scim/admin/log-config/recent?requestId=req-xyz');
    });

    it('should NOT add diagnostics when no correlation context', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue(undefined);

      const exception = new HttpException('Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      expect(body[SCIM_DIAGNOSTICS_URN]).toBeUndefined();
    });

    it('should NOT overwrite existing diagnostics from createScimError', () => {
      getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-222',
        endpointId: 'ep-333',
      } as any);

      const exception = createScimError({
        status: 400,
        detail: 'Schema validation failed',
        diagnostics: { triggeredBy: 'StrictSchemaValidation' },
      });
      filter.catch(exception, mockHost);

      const body = mockResponse.json.mock.calls[0][0];
      // Diagnostics should come from createScimError, not the filter
      expect(body[SCIM_DIAGNOSTICS_URN].triggeredBy).toBe('StrictSchemaValidation');
    });
  });

  // ── Error request log persistence ──────────────────────────────────

  describe('error request log persistence', () => {
    it('should call recordRequest with the exact SCIM error body', () => {
      const exception = createScimError({
        status: 409,
        scimType: 'uniqueness',
        detail: 'Duplicate userName.',
      });

      filter.catch(exception, mockHost);

      expect(mockLoggingService.recordRequest).toHaveBeenCalledTimes(1);
      const call = mockLoggingService.recordRequest.mock.calls[0][0];
      expect(call.status).toBe(409);
      expect(call.responseBody).toBeDefined();
      expect(call.responseBody.schemas).toContain(SCIM_ERROR_SCHEMA);
      expect(call.responseBody.detail).toBe('Duplicate userName.');
      expect(call.responseBody.scimType).toBe('uniqueness');
      expect(call.responseBody.status).toBe('409');
    });

    it('should include diagnostics URN in the stored responseBody', () => {
      const getCtxSpy = jest.spyOn(scimLoggerModule, 'getCorrelationContext').mockReturnValue({
        requestId: 'req-persist',
        endpointId: 'ep-persist',
      } as any);

      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
      filter.catch(exception, mockHost);

      const call = mockLoggingService.recordRequest.mock.calls[0][0];
      expect(call.responseBody[SCIM_DIAGNOSTICS_URN]).toBeDefined();
      expect(call.responseBody[SCIM_DIAGNOSTICS_URN].requestId).toBe('req-persist');

      getCtxSpy.mockRestore();
    });

    it('should read timing metadata from request and include durationMs', () => {
      mockRequest[REQUEST_LOGGING_META_KEY] = {
        startedAt: Date.now() - 100,
        requestHeaders: { authorization: 'Bearer test' },
        requestBody: { userName: 'test@test.com' },
        endpointId: 'ep-timing',
      };

      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      filter.catch(exception, mockHost);

      const call = mockLoggingService.recordRequest.mock.calls[0][0];
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
      expect(call.endpointId).toBe('ep-timing');
      expect(call.requestBody).toEqual({ userName: 'test@test.com' });
    });

    it('should NOT call recordRequest for non-SCIM routes', () => {
      const nonScimHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => ({ originalUrl: '/admin/dashboard', url: '/admin/dashboard', method: 'GET', headers: {} }),
        }),
      };

      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
      filter.catch(exception, nonScimHost as any);

      expect(mockLoggingService.recordRequest).not.toHaveBeenCalled();
    });

    it('should pass the error object to recordRequest', () => {
      const exception = createScimError({
        status: 500,
        detail: 'Internal failure',
      });

      filter.catch(exception, mockHost);

      const call = mockLoggingService.recordRequest.mock.calls[0][0];
      expect(call.error).toBe(exception);
    });
  });
});
