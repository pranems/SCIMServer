import { wrapPrismaError } from './prisma-error.util';
import { RepositoryError } from '../../../domain/errors/repository-error';

describe('wrapPrismaError', () => {
  it('should map P2025 to NOT_FOUND', () => {
    const prismaError = Object.assign(new Error('Record not found'), { code: 'P2025' });
    const result = wrapPrismaError(prismaError, 'User update(abc)');
    expect(result).toBeInstanceOf(RepositoryError);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toContain('User update(abc)');
    expect(result.message).toContain('record not found');
    expect(result.cause).toBe(prismaError);
  });

  it('should map P2002 to CONFLICT', () => {
    const prismaError = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    const result = wrapPrismaError(prismaError, 'User create');
    expect(result.code).toBe('CONFLICT');
    expect(result.message).toContain('unique constraint violation');
  });

  it.each(['P1001', 'P1002', 'P1008', 'P1017'])('should map %s to CONNECTION', (code) => {
    const prismaError = Object.assign(new Error('Connection issue'), { code });
    const result = wrapPrismaError(prismaError, 'query');
    expect(result.code).toBe('CONNECTION');
  });

  it('should detect connection errors by message pattern "timed out"', () => {
    const err = new Error('Operation timed out after 30s');
    const result = wrapPrismaError(err, 'User findAll');
    expect(result.code).toBe('CONNECTION');
  });

  it('should detect connection errors by message pattern "ECONNREFUSED"', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const result = wrapPrismaError(err, 'Group create');
    expect(result.code).toBe('CONNECTION');
  });

  it('should fall back to UNKNOWN for unrecognized errors', () => {
    const err = new Error('Something unexpected');
    const result = wrapPrismaError(err, 'User delete(xyz)');
    expect(result.code).toBe('UNKNOWN');
    expect(result.message).toContain('Something unexpected');
  });

  it('should handle non-Error thrown values', () => {
    const result = wrapPrismaError('string error', 'Group update');
    expect(result).toBeInstanceOf(RepositoryError);
    expect(result.code).toBe('UNKNOWN');
    expect(result.cause).toBeInstanceOf(Error);
  });
});
