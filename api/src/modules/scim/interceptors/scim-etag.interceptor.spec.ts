import { ScimEtagInterceptor, assertIfMatch } from './scim-etag.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('ScimEtagInterceptor', () => {
  let interceptor: ScimEtagInterceptor;
  let mockEndpointContext: { getProfile: jest.Mock };

  beforeEach(() => {
    mockEndpointContext = { getProfile: jest.fn().mockReturnValue(undefined) };
    interceptor = new ScimEtagInterceptor(mockEndpointContext as any);
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  // ─── Gap 10: etag.supported gating ──────────────────────────────────────────

  describe('etag.supported gating (Gap 10)', () => {
    function ctx(method: string, headers: Record<string, unknown> = {}) {
      const mockSetHeader = jest.fn();
      const mockStatus = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: mockStatus };
      const mockRequest = { method, headers };
      const context = {
        switchToHttp: () => ({ getRequest: () => mockRequest, getResponse: () => mockResponse }),
      } as unknown as ExecutionContext;
      return { context, mockSetHeader, mockStatus };
    }

    it('does NOT set ETag header when etag.supported is false', (done) => {
      mockEndpointContext.getProfile.mockReturnValue({ serviceProviderConfig: { etag: { supported: false } } });
      const { context, mockSetHeader } = ctx('GET');
      const body = { id: 'u1', meta: { version: 'W/"v1"' } };
      interceptor.intercept(context, { handle: () => of(body) } as CallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).not.toHaveBeenCalled();
          done();
        },
      });
    });

    it('DOES set ETag header when etag.supported is true', (done) => {
      mockEndpointContext.getProfile.mockReturnValue({ serviceProviderConfig: { etag: { supported: true } } });
      const { context, mockSetHeader } = ctx('GET');
      const body = { id: 'u1', meta: { version: 'W/"v1"' } };
      interceptor.intercept(context, { handle: () => of(body) } as CallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledWith('ETag', 'W/"v1"');
          done();
        },
      });
    });
  });

  // ─── ETag Header ───────────────────────────────────────────────────────────

  describe('ETag header on responses', () => {
    it('should set ETag header from meta.version', (done) => {
      const mockSetHeader = jest.fn();
      const mockStatus = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: mockStatus };
      const mockRequest = { method: 'GET', headers: {} };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const body = {
        id: 'user-123',
        meta: { version: 'W/"2025-06-01T12:00:00.000Z"' },
      };

      const mockCallHandler: CallHandler = { handle: () => of(body) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (data) => {
          expect(mockSetHeader).toHaveBeenCalledWith(
            'ETag',
            'W/"2025-06-01T12:00:00.000Z"'
          );
          expect(data).toEqual(body);
        },
        complete: () => done(),
      });
    });

    it('should not set ETag header when meta.version is absent', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: jest.fn() };
      const mockRequest = { method: 'GET', headers: {} };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const body = { id: 'user-123', meta: { resourceType: 'User' } };
      const mockCallHandler: CallHandler = { handle: () => of(body) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).not.toHaveBeenCalled();
        },
        complete: () => done(),
      });
    });

    it('should pass through non-object responses unchanged', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: jest.fn() };
      const mockRequest = { method: 'GET', headers: {} };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = { handle: () => of(null) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (data) => {
          expect(data).toBeNull();
          expect(mockSetHeader).not.toHaveBeenCalled();
        },
        complete: () => done(),
      });
    });
  });

  // ─── If-None-Match / 304 ──────────────────────────────────────────────────

  describe('If-None-Match (conditional GET)', () => {
    it('should return undefined and set 304 when ETag matches If-None-Match', (done) => {
      const etag = 'W/"2025-06-01T12:00:00.000Z"';
      const mockSetHeader = jest.fn();
      const mockStatus = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: mockStatus };
      const mockRequest = {
        method: 'GET',
        headers: { 'if-none-match': etag },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const body = { id: 'user-123', meta: { version: etag } };
      const mockCallHandler: CallHandler = { handle: () => of(body) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (data) => {
          expect(mockStatus).toHaveBeenCalledWith(304);
          expect(data).toBeUndefined();
        },
        complete: () => done(),
      });
    });

    it('should return data normally when ETag does not match If-None-Match', (done) => {
      const mockSetHeader = jest.fn();
      const mockStatus = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: mockStatus };
      const mockRequest = {
        method: 'GET',
        headers: { 'if-none-match': 'W/"old-version"' },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const body = {
        id: 'user-123',
        meta: { version: 'W/"2025-06-01T12:00:00.000Z"' },
      };
      const mockCallHandler: CallHandler = { handle: () => of(body) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (data) => {
          expect(mockStatus).not.toHaveBeenCalled();
          expect(data).toEqual(body);
        },
        complete: () => done(),
      });
    });

    it('should not trigger 304 for non-GET methods', (done) => {
      const etag = 'W/"2025-06-01T12:00:00.000Z"';
      const mockSetHeader = jest.fn();
      const mockStatus = jest.fn();
      const mockResponse = { setHeader: mockSetHeader, status: mockStatus };
      const mockRequest = {
        method: 'PUT',
        headers: { 'if-none-match': etag },
      };

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const body = { id: 'user-123', meta: { version: etag } };
      const mockCallHandler: CallHandler = { handle: () => of(body) };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (data) => {
          expect(mockStatus).not.toHaveBeenCalled();
          expect(data).toEqual(body);
        },
        complete: () => done(),
      });
    });
  });
});

// ─── assertIfMatch Tests ─────────────────────────────────────────────────────

describe('assertIfMatch', () => {
  it('should not throw when no If-Match header is provided', () => {
    expect(() => assertIfMatch('W/"v1"', undefined)).not.toThrow();
  });

  it('should not throw when resource has no version', () => {
    expect(() => assertIfMatch(undefined, 'W/"v1"')).not.toThrow();
  });

  it('should not throw when ETags match', () => {
    expect(() =>
      assertIfMatch('W/"2025-06-01T12:00:00.000Z"', 'W/"2025-06-01T12:00:00.000Z"')
    ).not.toThrow();
  });

  it('should not throw when If-Match is wildcard (*)', () => {
    expect(() => assertIfMatch('W/"v1"', '*')).not.toThrow();
  });

  it('should throw 412 when ETags do not match', () => {
    expect(() => assertIfMatch('W/"current"', 'W/"stale"')).toThrow();

    try {
      assertIfMatch('W/"current"', 'W/"stale"');
    } catch (error: any) {
      expect(error.getStatus()).toBe(412);
      expect(error.getResponse().scimType).toBe('versionMismatch');
    }
  });

  it('should include currentETag in diagnostics on 412', () => {
    try {
      assertIfMatch('W/"v5"', 'W/"v3"');
      fail('should have thrown');
    } catch (error: any) {
      const diag = error.getResponse()['urn:scimserver:api:messages:2.0:Diagnostics'];
      expect(diag).toBeDefined();
      expect(diag.currentETag).toBe('W/"v5"');
      expect(diag.errorCode).toBe('PRECONDITION_VERSION_MISMATCH');
    }
  });
});
