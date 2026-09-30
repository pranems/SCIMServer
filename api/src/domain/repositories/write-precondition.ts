import { RepositoryError } from '../errors/repository-error';

/** A numeric version is compare-and-swap; '*' requires only that the row exists. */
export type ExpectedVersion = number | '*';

/** InMemory callers must check and mutate synchronously, without an intervening await. */
export function assertWritePrecondition<T extends { version: number }>(
  record: T | undefined,
  expectedVersion?: ExpectedVersion,
): asserts record is T {
  if (!record) {
    throw new RepositoryError(
      expectedVersion === undefined ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
      expectedVersion === undefined ? 'Resource not found.' : 'Resource no longer satisfies If-Match.',
    );
  }
  if (typeof expectedVersion === 'number' && record.version !== expectedVersion) {
    throw new RepositoryError('PRECONDITION_FAILED', 'Resource no longer satisfies If-Match.');
  }
}
