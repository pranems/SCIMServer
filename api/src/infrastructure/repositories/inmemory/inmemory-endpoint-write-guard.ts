import { Injectable } from '@nestjs/common';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { assertProfileRevisionValue, type ProfileRevision } from '../../../domain/repositories/profile-revision';

@Injectable()
export class InMemoryEndpointWriteGuard {
  // Never expire a tombstone: a suspended request may resume arbitrarily late.
  // IDs are UUIDs and never reused; this set has the lifetime of this backend.
  private readonly deleted = new Set<string>();
  private readonly profileRevisions = new Map<string, ProfileRevision>();

  assertWritable(endpointId: string, expectedProfileRevision?: ProfileRevision): void {
    if (this.deleted.has(endpointId)) {
      throw new EndpointNotFoundError();
    }
    if (expectedProfileRevision !== undefined) {
      assertProfileRevisionValue(this.profileRevisions.get(endpointId), expectedProfileRevision);
    }
  }

  recordProfileRevision(endpointId: string, revision: ProfileRevision): void {
    this.profileRevisions.set(endpointId, revision);
  }

  markDeleted(endpointId: string): void {
    this.profileRevisions.delete(endpointId);
    this.deleted.add(endpointId);
  }
}
