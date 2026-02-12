import { HttpException, HttpStatus } from '@nestjs/common';
import { ScimExceptionFilter } from './scim-exception.filter';
import { createScimError } from '../common/scim-errors';
import { SCIM_ERROR_SCHEMA } from '../common/scim-constants';
import { ScimLogger } from '../../logging/scim-logger.service';

describe('ScimExceptionFilter', () => {
  let filter: ScimExceptionFilter;
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
    filter = new ScimExceptionFilter(mockScimLogger as unknown as ScimLogger);
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    };
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
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
});
