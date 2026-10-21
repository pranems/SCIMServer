import { RepositoryError } from '../errors/repository-error';

export type IfMatchVersion = number | '*';

export interface ObservedWriteScope {
  readonly endpointId: string;
  readonly resourceType: string;
}

/** The client condition and the state used to compute a write are independent. */
export type ExpectedVersion = IfMatchVersion | {
  readonly observedVersion: number;
  readonly ifMatch?: IfMatchVersion;
  readonly scope?: ObservedWriteScope;
};

export function observeWriteVersion(
  observedVersion: number, ifMatch?: IfMatchVersion, scope?: ObservedWriteScope,
): ExpectedVersion {
  return { observedVersion, ifMatch, ...(scope ? { scope: { ...scope } } : {}) };
}

export function observedWriteScope(expected?: ExpectedVersion): ObservedWriteScope | undefined {
  return typeof expected === 'object' ? expected.scope : undefined;
}

export function resourceWriteWhere(id: string, expected?: ExpectedVersion) {
  return { id, ...observedWriteScope(expected), version: resourceWriteVersion(expected) };
}

export function resourceWriteVersion(expected?: ExpectedVersion): number | undefined {
  return typeof expected === 'object' ? expected.observedVersion
    : typeof expected === 'number' ? expected : undefined;
}

export function writeMissError(expected?: ExpectedVersion): RepositoryError {
  if (typeof expected === 'object' && typeof expected.ifMatch !== 'number') {
    return new RepositoryError('WRITE_CONFLICT', 'Resource changed while the write was being computed.');
  }
  return new RepositoryError(expected === undefined ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
    expected === undefined ? 'Resource not found.' : 'Resource no longer satisfies If-Match.');
}

/** InMemory callers must check and mutate synchronously, without an intervening await. */
export function assertWritePrecondition<T extends { version: number; endpointId?: string; resourceType?: string }>(
  record: T | undefined,
  expectedVersion?: ExpectedVersion,
  resourceType?: string,
): asserts record is T {
  const condition = typeof expectedVersion === 'object' ? expectedVersion.ifMatch : expectedVersion;
  if (!record) {
    if (typeof expectedVersion === 'object' && condition === undefined) throw writeMissError(expectedVersion);
    throw new RepositoryError(
      condition === undefined ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
      condition === undefined ? 'Resource not found.' : 'Resource no longer satisfies If-Match.',
    );
  }
  if (typeof condition === 'number' && record.version !== condition) {
    throw new RepositoryError('PRECONDITION_FAILED', 'Resource no longer satisfies If-Match.');
  }
  const scope = observedWriteScope(expectedVersion);
  if (typeof expectedVersion === 'object' && (record.version !== expectedVersion.observedVersion ||
      (scope && (record.endpointId !== scope.endpointId ||
        (record.resourceType ?? resourceType) !== scope.resourceType)))) {
    throw writeMissError(expectedVersion);
  }
}
