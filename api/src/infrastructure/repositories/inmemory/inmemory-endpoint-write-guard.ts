import { Injectable } from '@nestjs/common';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';

@Injectable()
export class InMemoryEndpointWriteGuard {
  // Never expire a tombstone: a suspended request may resume arbitrarily late.
  // IDs are UUIDs and never reused; this set has the lifetime of this backend.
  private readonly deleted = new Set<string>();

  assertWritable(endpointId: string): void {
    if (this.deleted.has(endpointId)) {
      throw new EndpointNotFoundError();
    }
  }

  markDeleted(endpointId: string): void {
    this.deleted.add(endpointId);
  }
}
