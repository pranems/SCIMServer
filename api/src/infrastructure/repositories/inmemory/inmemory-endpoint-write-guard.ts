import { Injectable } from '@nestjs/common';
import { RepositoryError } from '../../../domain/errors/repository-error';

@Injectable()
export class InMemoryEndpointWriteGuard {
  // Never expire a tombstone: a suspended request may resume arbitrarily late.
  // IDs are UUIDs and never reused; this set has the lifetime of this backend.
  private readonly deleted = new Set<string>();

  assertWritable(endpointId: string): void {
    if (this.deleted.has(endpointId)) {
      throw new RepositoryError('NOT_FOUND', 'Endpoint no longer exists');
    }
  }

  markDeleted(endpointId: string): void {
    this.deleted.add(endpointId);
  }
}
