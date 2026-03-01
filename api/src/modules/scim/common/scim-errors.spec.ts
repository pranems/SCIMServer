import { HttpException } from '@nestjs/common';
import { createScimError } from './scim-errors';

describe('createScimError', () => {
  it('should return an HttpException', () => {
    const err = createScimError({ status: 400, detail: 'bad request' });
    expect(err).toBeInstanceOf(HttpException);
  });

  it('should set the HTTP status code', () => {
    const err = createScimError({ status: 404, detail: 'not found' });
    expect(err.getStatus()).toBe(404);
  });

  it('should include SCIM error schema in response body', () => {
    const err = createScimError({ status: 400, detail: 'test' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:Error']);
  });

  it('should include detail message in response body', () => {
    const err = createScimError({ status: 400, detail: 'Invalid filter syntax' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.detail).toBe('Invalid filter syntax');
  });

  it('should include scimType when provided', () => {
    const err = createScimError({ status: 400, detail: 'bad', scimType: 'invalidFilter' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.scimType).toBe('invalidFilter');
  });

  it('should omit scimType when not provided', () => {
    const err = createScimError({ status: 500, detail: 'server error' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.scimType).toBeUndefined();
  });

  it('should convert status to string per RFC 7644 §3.12', () => {
    const err = createScimError({ status: 409, detail: 'conflict' });
    const body = err.getResponse() as Record<string, unknown>;
    expect(body.status).toBe('409');
    expect(typeof body.status).toBe('string');
  });

  it('should handle various status codes correctly', () => {
    const cases = [
      { status: 400, detail: 'Bad Request', scimType: 'invalidSyntax' },
      { status: 401, detail: 'Unauthorized' },
      { status: 404, detail: 'Not Found', scimType: 'noTarget' },
      { status: 409, detail: 'Conflict', scimType: 'uniqueness' },
      { status: 412, detail: 'Precondition Failed', scimType: 'versionMismatch' },
      { status: 501, detail: 'Not Implemented', scimType: 'mutability' },
    ];

    for (const { status, detail, scimType } of cases) {
      const err = createScimError({ status, detail, scimType });
      expect(err.getStatus()).toBe(status);
      const body = err.getResponse() as Record<string, unknown>;
      expect(body.detail).toBe(detail);
      expect(body.status).toBe(String(status));
    }
  });
});
