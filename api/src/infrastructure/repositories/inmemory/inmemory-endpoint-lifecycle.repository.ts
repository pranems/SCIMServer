import { Inject, Injectable } from '@nestjs/common';
import type { IEndpointLifecycleRepository } from '../../../domain/repositories/endpoint-lifecycle.repository.interface';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import { InMemoryUserRepository } from './inmemory-user.repository';
import { InMemoryGroupRepository } from './inmemory-group.repository';
import { InMemoryGenericResourceRepository } from './inmemory-generic-resource.repository';
import { InMemoryEndpointCredentialRepository } from './inmemory-endpoint-credential.repository';
import { InMemoryEndpointWriteGuard } from './inmemory-endpoint-write-guard';
import type { EndpointDeletionStep } from './endpoint-deletion-step';

@Injectable()
export class InMemoryEndpointLifecycleRepository implements IEndpointLifecycleRepository {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: InMemoryUserRepository,
    @Inject(GROUP_REPOSITORY) private readonly groups: InMemoryGroupRepository,
    @Inject(GENERIC_RESOURCE_REPOSITORY) private readonly resources: InMemoryGenericResourceRepository,
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY) private readonly credentials: InMemoryEndpointCredentialRepository,
    private readonly writes: InMemoryEndpointWriteGuard,
  ) {}

  // No await between preparation, commit, rollback and the write barrier.
  // A yielded sequence of destructive async deletes is not a transaction.
  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteEndpoint(endpointId: string): Promise<void> {
    const steps = [
      this.users.prepareEndpointDeletion(endpointId),
      this.groups.prepareEndpointDeletion(endpointId),
      this.resources.prepareEndpointDeletion(endpointId),
      this.credentials.prepareEndpointDeletion(endpointId),
    ];
    const applied: EndpointDeletionStep[] = [];
    try {
      for (const step of steps) {
        applied.push(step);
        step.commit();
      }
      this.writes.markDeleted(endpointId);
    } catch (error) {
      for (const step of applied.reverse()) step.rollback();
      throw error;
    }
  }
}
