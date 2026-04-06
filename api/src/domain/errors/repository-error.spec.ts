import { RepositoryError, repositoryErrorToHttpStatus } from './repository-error';

describe('RepositoryError', () => {
  it('should create a NOT_FOUND error', () => {
    const err = new RepositoryError('NOT_FOUND', 'User with id xyz not found');
    expect(err).toBeInstanceOf(RepositoryError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('User with id xyz not found');
    expect(err.name).toBe('RepositoryError');
    expect(err.isRepositoryError).toBe(true);
    expect(err.cause).toBeUndefined();
  });

  it('should preserve the original error as cause', () => {
    const original = new Error('P2025: Record to delete does not exist.');
    const err = new RepositoryError('NOT_FOUND', 'Record not found', original);
    expect(err.cause).toBe(original);
    expect(err.stack).toContain('Caused by:');
    expect(err.stack).toContain('P2025');
  });

  it('should handle cause without stack', () => {
    const original = new Error('no stack');
    original.stack = undefined;
    const err = new RepositoryError('UNKNOWN', 'Something failed', original);
    expect(err.cause).toBe(original);
    // Should not crash when cause has no stack
    expect(err.stack).toBeDefined();
    expect(err.stack).not.toContain('Caused by:');
  });

  it('should support CONFLICT code', () => {
    const err = new RepositoryError('CONFLICT', 'Unique constraint violated');
    expect(err.code).toBe('CONFLICT');
  });

  it('should support CONNECTION code', () => {
    const err = new RepositoryError('CONNECTION', 'Database connection timed out');
    expect(err.code).toBe('CONNECTION');
  });

  it('should support UNKNOWN code', () => {
    const err = new RepositoryError('UNKNOWN', 'Unexpected failure');
    expect(err.code).toBe('UNKNOWN');
  });
});

describe('repositoryErrorToHttpStatus', () => {
  it.each([
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['CONNECTION', 503],
    ['UNKNOWN', 500],
  ] as const)('should map %s to %d', (code, expected) => {
    expect(repositoryErrorToHttpStatus(code)).toBe(expected);
  });
});
