import { CallHandler, ExecutionContext, HttpException, NotFoundException, ConflictException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { SCIM_ERROR_SCHEMA } from '../scim/common/scim-constants';

describe('RequestLoggingInterceptor', () => {
  let interceptor: RequestLoggingInterceptor;
  let mockLoggingService: any;
  let mockScimLogger: any;

  beforeEach(() => {
    mockLoggingService = {
      recordRequest: jest.fn(),
    };

    mockScimLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      runWithContext: jest.fn((ctx: any, fn: () => void) => fn()),
      getConfig: jest.fn().mockReturnValue({ slowRequestThresholdMs: 2000 }),
    };

    interceptor = new RequestLoggingInterceptor(mockLoggingService, mockScimLogger);
  });

  function createMockContext(overrides: Partial<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: any;
    ip: string;
    statusCode: number;
  }> = {}) {
    const mockResponse: any = {
      statusCode: overrides.statusCode ?? 200,
      setHeader: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({}),
    };
    const mockRequest: any = {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? '/scim/Users',
      originalUrl: overrides.url ?? '/scim/Users',
      headers: overrides.headers ?? { 'user-agent': 'test-agent' },
      body: overrides.body ?? {},
      ip: overrides.ip ?? '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    };

    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext;

    return { context, request: mockRequest, response: mockResponse };
  }

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  it('should set X-Request-Id header on response', (done) => {
    const { context, response } = createMockContext();
    const handler: CallHandler = { handle: () => of({ id: 'test' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', expect.any(String));
        done();
      },
    });
  });

  it('should propagate existing x-request-id from request', (done) => {
    const { context, response } = createMockContext({
      headers: { 'x-request-id': 'existing-id', 'user-agent': 'test' },
    });
    const handler: CallHandler = { handle: () => of({ id: 'test' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'existing-id');
        done();
      },
    });
  });

  it('should log incoming request', (done) => {
    const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockScimLogger.debug).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('POST /scim/Users'),
          expect.any(Object),
        );
        done();
      },
    });
  });

  it('should log response with status code', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/Users' });
    const handler: CallHandler = { handle: () => of({ data: 'test' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        // Look for the response log (← prefix)
        const responseLogs = mockScimLogger.debug.mock.calls.filter(
          (c: any[]) => typeof c[1] === 'string' && c[1].includes('←'),
        );
        expect(responseLogs.length).toBeGreaterThan(0);
        done();
      },
    });
  });

  it('should record request to logging service', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/Users' });
    const handler: CallHandler = { handle: () => of({ result: 'ok' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockLoggingService.recordRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            url: '/scim/Users',
          }),
        );
        done();
      },
    });
  });

  // ── Step 1: endpointId persisted to RequestLog ──────────────────────

  it('should pass endpointId to recordRequest on success', (done) => {
    const { context } = createMockContext({ method: 'POST', url: '/scim/endpoints/ep-abc123/Users' });
    const handler: CallHandler = { handle: () => of({ id: 'u1' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockLoggingService.recordRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            url: '/scim/endpoints/ep-abc123/Users',
            endpointId: 'ep-abc123',
          }),
        );
        done();
      },
    });
  });

  it('should pass endpointId to recordRequest on error', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/endpoints/ep-err456/Users/bad' });
    const testError = new Error('not found');
    (testError as any).status = 404;
    const handler: CallHandler = { handle: () => throwError(() => testError) };

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(mockLoggingService.recordRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            url: '/scim/endpoints/ep-err456/Users/bad',
            endpointId: 'ep-err456',
          }),
        );
        done();
      },
    });
  });

  it('should pass undefined endpointId for non-endpoint URLs', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/Users' });
    const handler: CallHandler = { handle: () => of({ id: 'u1' }) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        const call = mockLoggingService.recordRequest.mock.calls[0][0];
        expect(call.endpointId).toBeUndefined();
        done();
      },
    });
  });

  it('should log errors and re-throw them', (done) => {
    const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
    const testError = new Error('Test error');
    const handler: CallHandler = { handle: () => throwError(() => testError) };

    interceptor.intercept(context, handler).subscribe({
      error: (err) => {
        expect(err).toBe(testError);
        expect(mockScimLogger.error).toHaveBeenCalled();
        expect(mockLoggingService.recordRequest).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            url: '/scim/Users',
            error: testError,
          }),
        );
        done();
      },
    });
  });

  describe('catchError log level should match status code (P9)', () => {
    function createHttpError(status: number): Error & { status: number; getStatus?: () => number } {
      const err = new Error(`HTTP ${status}`) as Error & { status: number; getStatus?: () => number };
      err.status = status;
      err.getStatus = () => status;
      return err;
    }

    it('should log 404 at DEBUG, not ERROR', (done) => {
      const { context } = createMockContext({ method: 'GET', url: '/scim/Users/nonexistent' });
      const handler: CallHandler = { handle: () => throwError(() => createHttpError(404)) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockScimLogger.debug).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('404'),
            expect.any(Object),
          );
          expect(mockScimLogger.error).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should log 401 at WARN, not ERROR', (done) => {
      const { context } = createMockContext({ method: 'GET', url: '/scim/Users' });
      const handler: CallHandler = { handle: () => throwError(() => createHttpError(401)) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockScimLogger.warn).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('401'),
            expect.any(Object),
          );
          expect(mockScimLogger.error).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should log 400 at INFO, not ERROR', (done) => {
      const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
      const handler: CallHandler = { handle: () => throwError(() => createHttpError(400)) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockScimLogger.info).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('400'),
            expect.any(Object),
          );
          expect(mockScimLogger.error).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('should log 500 at ERROR', (done) => {
      const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
      const handler: CallHandler = { handle: () => throwError(() => createHttpError(500)) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          expect(mockScimLogger.error).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining('500'),
            expect.any(Object),
            expect.any(Object),
          );
          done();
        },
      });
    });
  });

  it('should run within logger context with correlation data', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/endpoints/ep-1/Users' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        expect(mockScimLogger.runWithContext).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'GET',
            path: '/scim/endpoints/ep-1/Users',
            endpointId: 'ep-1',
          }),
          expect.any(Function),
        );
        done();
      },
    });
  });

  it('should extract endpoint ID from URL', (done) => {
    const { context } = createMockContext({ url: '/scim/endpoints/my-endpoint/Users' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        const contextArg = mockScimLogger.runWithContext.mock.calls[0][0];
        expect(contextArg.endpointId).toBe('my-endpoint');
        done();
      },
    });
  });

  it('should handle URLs without endpoint ID', (done) => {
    const { context } = createMockContext({ url: '/scim/ServiceProviderConfig' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(context, handler).subscribe({
      complete: () => {
        const contextArg = mockScimLogger.runWithContext.mock.calls[0][0];
        expect(contextArg.endpointId).toBeUndefined();
        done();
      },
    });
  });

  it('should pass through response body unchanged', (done) => {
    const { context } = createMockContext();
    const responseBody = { id: 'user-1', userName: 'test@example.com' };
    const handler: CallHandler = { handle: () => of(responseBody) };

    interceptor.intercept(context, handler).subscribe({
      next: (result) => {
        expect(result).toEqual(responseBody);
      },
      complete: () => done(),
    });
  });

  // ── Error response body capture ──────────────────────────────────────

  describe('error response body capture', () => {
    it('should include SCIM error responseBody for HttpException errors', (done) => {
      const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
      const err = new ConflictException({
        schemas: [SCIM_ERROR_SCHEMA],
        detail: 'User already exists',
        status: '409',
        scimType: 'uniqueness',
      });
      const handler: CallHandler = { handle: () => throwError(() => err) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          const call = mockLoggingService.recordRequest.mock.calls[0][0];
          expect(call.responseBody).toBeDefined();
          expect(call.responseBody.schemas).toContain(SCIM_ERROR_SCHEMA);
          expect(call.responseBody.detail).toBe('User already exists');
          expect(call.responseBody.status).toBe('409');
          done();
        },
      });
    });

    it('should build SCIM error responseBody for non-SCIM HttpException', (done) => {
      const { context } = createMockContext({ method: 'GET', url: '/scim/Users/nonexistent' });
      const err = new NotFoundException('Resource not found');
      const handler: CallHandler = { handle: () => throwError(() => err) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          const call = mockLoggingService.recordRequest.mock.calls[0][0];
          expect(call.responseBody).toBeDefined();
          expect(call.responseBody.schemas).toContain(SCIM_ERROR_SCHEMA);
          expect(call.responseBody.status).toBe('404');
          done();
        },
      });
    });

    it('should build generic error responseBody for non-HttpException errors', (done) => {
      const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
      const err = new Error('Database connection lost');
      const handler: CallHandler = { handle: () => throwError(() => err) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          const call = mockLoggingService.recordRequest.mock.calls[0][0];
          expect(call.responseBody).toBeDefined();
          expect(call.responseBody.schemas).toContain(SCIM_ERROR_SCHEMA);
          expect(call.responseBody.detail).toBe('Database connection lost');
          expect(call.responseBody.status).toBe('500');
          done();
        },
      });
    });
  });
});
