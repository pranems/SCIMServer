import { ScimEtagInterceptor, assertIfMatch } from './scim-etag.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('ScimEtagInterceptor', () => {
  let interceptor: ScimEtagInterceptor;

  beforeEach(() => {
    interceptor = new ScimEtagInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
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
});
