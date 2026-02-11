import { ScimContentTypeInterceptor } from './scim-content-type.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('ScimContentTypeInterceptor', () => {
  let interceptor: ScimContentTypeInterceptor;

  beforeEach(() => {
    interceptor = new ScimContentTypeInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('intercept', () => {
    it('should set Content-Type header to application/scim+json', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => of({ id: 'test-user', userName: 'test@example.com' }),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
        },
        complete: () => done(),
      });
    });

    it('should not set header if response already sent', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: true, // Headers already sent
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const mockCallHandler: CallHandler = {
        handle: () => of({ id: 'test-user' }),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).not.toHaveBeenCalled();
        },
        complete: () => done(),
      });
    });

    it('should pass through the response data unchanged', (done) => {
      const mockResponse = {
        headersSent: false,
        setHeader: jest.fn(),
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const expectedData = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-123',
        userName: 'test@example.com',
        active: true,
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(expectedData),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toEqual(expectedData);
        },
        complete: () => done(),
      });
    });

    it('should work with list responses', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const listResponse = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        totalResults: 2,
        startIndex: 1,
        itemsPerPage: 2,
        Resources: [
          { id: 'user-1', userName: 'user1@example.com' },
          { id: 'user-2', userName: 'user2@example.com' },
        ],
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(listResponse),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toEqual(listResponse);
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
        },
        complete: () => done(),
      });
    });

    it('should work with error responses', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const errorResponse = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '404',
        detail: 'User not found',
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(errorResponse),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: (result) => {
          expect(result).toEqual(errorResponse);
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
        },
        complete: () => done(),
      });
    });

    it('should set Location header on 201 Created with meta.location (RFC 7644 §3.1)', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        statusCode: 201,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const createdResource = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-123',
        userName: 'test@example.com',
        meta: {
          resourceType: 'User',
          location: 'http://localhost:3000/scim/endpoints/ep1/Users/user-123',
        },
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(createdResource),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Location',
            'http://localhost:3000/scim/endpoints/ep1/Users/user-123'
          );
        },
        complete: () => done(),
      });
    });

    it('should set Location header on 201 Created Group', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        statusCode: 201,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const createdGroup = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: 'group-456',
        displayName: 'Engineering',
        members: [],
        meta: {
          resourceType: 'Group',
          location: 'http://localhost:3000/scim/endpoints/ep1/Groups/group-456',
        },
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(createdGroup),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Location',
            'http://localhost:3000/scim/endpoints/ep1/Groups/group-456'
          );
        },
        complete: () => done(),
      });
    });

    it('should NOT set Location header on 200 OK responses', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        statusCode: 200,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const patchedResource = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-123',
        meta: {
          location: 'http://localhost:3000/scim/endpoints/ep1/Users/user-123',
        },
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(patchedResource),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
          expect(mockSetHeader).not.toHaveBeenCalledWith(
            'Location',
            expect.anything()
          );
        },
        complete: () => done(),
      });
    });

    it('should NOT set Location header on 201 without meta.location', (done) => {
      const mockSetHeader = jest.fn();
      const mockResponse = {
        headersSent: false,
        statusCode: 201,
        setHeader: mockSetHeader,
      };

      const mockContext = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ExecutionContext;

      const resourceWithoutMeta = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        id: 'user-123',
      };

      const mockCallHandler: CallHandler = {
        handle: () => of(resourceWithoutMeta),
      };

      interceptor.intercept(mockContext, mockCallHandler).subscribe({
        next: () => {
          expect(mockSetHeader).toHaveBeenCalledTimes(1); // only Content-Type
          expect(mockSetHeader).toHaveBeenCalledWith(
            'Content-Type',
            'application/scim+json; charset=utf-8'
          );
        },
        complete: () => done(),
      });
    });
  });
});
