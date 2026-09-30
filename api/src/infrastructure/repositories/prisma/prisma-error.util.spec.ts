import { wrapPrismaError } from './prisma-error.util';
import { RepositoryError } from '../../../domain/errors/repository-error';

describe('wrapPrismaError', () => {
  it.each([1, '*'] as const)('maps a conditional miss (%s), including deletion, to PRECONDITION_FAILED', (expected) => {
    const error = Object.assign(new Error('Record not found'), { code: 'P2025' });
    expect(wrapPrismaError(error, 'conditional write', expected)).toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('preserves an already typed repository error', () => {
    const error = new RepositoryError('PRECONDITION_FAILED', 'condition failed');
    expect(wrapPrismaError(error, 'aggregate')).toBe(error);
  });
  it.each([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
    'timeout expired',
  ])('preserves native pg timeout classification: %s', message => {
    const cause = new Error(message);
    const error = wrapPrismaError(cause, 'User update');
    expect(error.code).toBe('CONNECTION');
    expect(error.message).toBe('User update: database connection error');
    expect(error.cause).toBe(cause);
  });

  it('preserves an already classified repository error instead of reclassifying it', () => {
    const classified = new RepositoryError('NOT_FOUND', 'Already classified');
    expect(wrapPrismaError(classified, 'aggregate operation')).toBe(classified);
  });

  it.each(['P2003', 'P2010', undefined])('does not classify %s as an outage from a connect statement in driver text', code => {
    const failure = Object.assign(new Error('Driver failure in endpoint: { connect: { id } }'), { code });
    expect(wrapPrismaError(failure, 'create').code).toBe('UNKNOWN');
  });

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
