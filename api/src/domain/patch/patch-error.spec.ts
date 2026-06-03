import { PatchError } from './patch-error';

describe('PatchError', () => {
  it('should extend Error', () => {
    const err = new PatchError(400, 'bad request');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PatchError);
  });

  it('should set name to PatchError', () => {
    const err = new PatchError(400, 'test');
    expect(err.name).toBe('PatchError');
  });

  it('should capture status code', () => {
    const err = new PatchError(409, 'conflict');
    expect(err.status).toBe(409);
  });

  it('should capture detail message', () => {
    const err = new PatchError(400, 'Invalid path');
    expect(err.message).toBe('Invalid path');
  });

  it('should capture scimType when provided', () => {
    const err = new PatchError(400, 'bad path', 'invalidPath');
    expect(err.scimType).toBe('invalidPath');
  });

  it('should leave scimType undefined when not provided', () => {
    const err = new PatchError(500, 'server error');
    expect(err.scimType).toBeUndefined();
  });

  it('should have a stack trace', () => {
    const err = new PatchError(400, 'test');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('PatchError');
  });

  it('should work with different HTTP status codes', () => {
    const cases = [
      { status: 400, detail: 'Bad Request' },
      { status: 404, detail: 'Not Found', scimType: 'noTarget' },
      { status: 409, detail: 'Conflict', scimType: 'uniqueness' },
      { status: 501, detail: 'Not Implemented', scimType: 'mutability' },
    ];

    for (const { status, detail, scimType } of cases) {
      const err = new PatchError(status, detail, scimType);
      expect(err.status).toBe(status);
      expect(err.message).toBe(detail);
      expect(err.scimType).toBe(scimType);
    }
  });
});
