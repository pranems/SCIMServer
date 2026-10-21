/**
 * Shared Prisma → RepositoryError translation utility.
 *
 * Used by all Prisma repository implementations to convert
 * Prisma-specific errors into typed RepositoryError instances.
 *
 * @see RepositoryError - domain/errors/repository-error.ts
 */
import { RepositoryError } from '../../../domain/errors/repository-error';
import { writeMissError, type ExpectedVersion } from '../../../domain/repositories/write-precondition';

// pg/pg-pool also raise uncoded timeout errors. Match their complete messages,
// never a bare "connect", which also appears in Prisma's query-source details.
const PG_CONNECTION_TIMEOUT_MESSAGES = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'timeout expired',
]);

function rawSqlState(error: unknown): unknown {
  if (error === null || typeof error !== 'object' || !('meta' in error)) return undefined;
  const meta = error.meta;
  if (meta === null || typeof meta !== 'object') return undefined;
  if ('code' in meta) return meta.code;
  if (!('driverAdapterError' in meta)) return undefined;
  const adapter = meta.driverAdapterError;
  if (adapter === null || typeof adapter !== 'object' || !('cause' in adapter)) return undefined;
  const cause = adapter.cause;
  return cause !== null && typeof cause === 'object' && 'originalCode' in cause
    ? cause.originalCode : undefined;
}

/**
 * Translate a Prisma error into a typed RepositoryError.
 *
 * Prisma error codes handled:
 *   P2025 - Record not found (update/delete on nonexistent record)
 *   P2002 - Unique constraint violation
 *   P1001 - Can't reach database server
 *   P1002 - Database server reached but connection timed out
 *   P1008 - Operations timed out
 *   P1017 - Server has closed the connection
 *
 * @param error   The caught error (may be PrismaClientKnownRequestError or any Error)
 * @param context Human-readable description of the operation (e.g., "User update(abc-123)")
 */
export function wrapPrismaError(error: unknown, context: string, expectedVersion?: ExpectedVersion): RepositoryError {
  if (error instanceof RepositoryError) return error;
  const err = error instanceof Error ? error : new Error(String(error));
  const code = (error as { code?: string })?.code;

  if (code === 'P2025') {
    if (expectedVersion !== undefined) {
      const failure = writeMissError(expectedVersion);
      return new RepositoryError(failure.code, failure.message, err);
    }
    return new RepositoryError('NOT_FOUND', `${context}: record not found`, err);
  }
  const rawUnique = code === 'P2010' && rawSqlState(error) === '23505';
  if (code === 'P2002' || rawUnique) {
    return new RepositoryError('CONFLICT', `${context}: unique constraint violation`, err);
  }
  // Connection-related Prisma error codes + common message patterns
  if (code === 'P1001' || code === 'P1002' || code === 'P1008' || code === 'P1017' ||
      (!code && (PG_CONNECTION_TIMEOUT_MESSAGES.has(err.message) || err.message.includes('timed out') ||
      err.message.includes('ECONNREFUSED')))) {
    return new RepositoryError('CONNECTION', `${context}: database connection error`, err);
  }
  return new RepositoryError('UNKNOWN', `${context}: ${err.message}`, err);
}
