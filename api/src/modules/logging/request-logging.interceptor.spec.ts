import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor, REQUEST_LOGGING_META_KEY } from './request-logging.interceptor';

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

  it('should NOT call recordRequest on error (delegated to exception filters)', (done) => {
    const { context } = createMockContext({ method: 'GET', url: '/scim/endpoints/ep-err456/Users/bad' });
    const testError = new Error('not found');
    (testError as any).status = 404;
    const handler: CallHandler = { handle: () => throwError(() => testError) };

    interceptor.intercept(context, handler).subscribe({
      error: () => {
        expect(mockLoggingService.recordRequest).not.toHaveBeenCalled();
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

  it('should re-throw errors without calling recordRequest or logging', (done) => {
    const { context } = createMockContext({ method: 'POST', url: '/scim/Users' });
    const testError = new Error('Test error');
    const handler: CallHandler = { handle: () => throwError(() => testError) };

    interceptor.intercept(context, handler).subscribe({
      error: (err) => {
        expect(err).toBe(testError);
        // Error logging + DB persistence is now handled by exception filters
        expect(mockLoggingService.recordRequest).not.toHaveBeenCalled();
        done();
      },
    });
  });

  // ── Metadata stashing for exception filters ─────────────────────────

  describe('request metadata stashing', () => {
    it('should stash timing metadata on request for exception filters', (done) => {
      const { context, request } = createMockContext({
        method: 'POST',
        url: '/scim/endpoints/ep-meta/Users',
        body: { userName: 'test@example.com' },
      });
      const handler: CallHandler = { handle: () => of({ id: 'u1' }) };

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          const meta = request[REQUEST_LOGGING_META_KEY];
          expect(meta).toBeDefined();
          expect(meta.startedAt).toEqual(expect.any(Number));
          expect(meta.requestBody).toEqual({ userName: 'test@example.com' });
          expect(meta.endpointId).toBe('ep-meta');
          expect(meta.requestHeaders).toBeDefined();
          done();
        },
      });
    });

    it('should stash metadata even when request errors', (done) => {
      const { context, request } = createMockContext({
        method: 'POST',
        url: '/scim/endpoints/ep-err/Users',
        body: { userName: 'dupe@example.com' },
      });
      const handler: CallHandler = { handle: () => throwError(() => new Error('conflict')) };

      interceptor.intercept(context, handler).subscribe({
        error: () => {
          const meta = request[REQUEST_LOGGING_META_KEY];
          expect(meta).toBeDefined();
          expect(meta.startedAt).toEqual(expect.any(Number));
          expect(meta.requestBody).toEqual({ userName: 'dupe@example.com' });
          expect(meta.endpointId).toBe('ep-err');
          done();
        },
      });
    });

    it('should have undefined endpointId in metadata for non-endpoint URLs', (done) => {
      const { context, request } = createMockContext({ url: '/scim/ServiceProviderConfig' });
      const handler: CallHandler = { handle: () => of({}) };

      interceptor.intercept(context, handler).subscribe({
        complete: () => {
          const meta = request[REQUEST_LOGGING_META_KEY];
          expect(meta.endpointId).toBeUndefined();
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
});
