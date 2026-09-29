/**
 * Shared Prisma → RepositoryError translation utility.
 *
 * Used by all Prisma repository implementations to convert
 * Prisma-specific errors into typed RepositoryError instances.
 *
 * @see RepositoryError - domain/errors/repository-error.ts
 */
import { RepositoryError } from '../../../domain/errors/repository-error';
import type { ExpectedVersion } from '../../../domain/repositories/write-precondition';

// pg/pg-pool also raise uncoded timeout errors. Match their complete messages,
// never a bare "connect", which also appears in Prisma's query-source details.
const PG_CONNECTION_TIMEOUT_MESSAGES = new Set([
  'timeout exceeded when trying to connect',
  'Connection terminated due to connection timeout',
  'timeout expired',
]);

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
      return new RepositoryError('PRECONDITION_FAILED', 'Resource no longer satisfies If-Match.', err);
    }
    return new RepositoryError('NOT_FOUND', `${context}: record not found`, err);
  }
  if (code === 'P2002') {
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
