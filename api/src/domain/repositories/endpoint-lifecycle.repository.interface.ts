import type { ProfileRevision } from './profile-revision';

/** Endpoint ownership deletion; audit history is deliberately outside this port. */
export interface IEndpointLifecycleRepository {
  deleteEndpoint(endpointId: string): Promise<void>;
  recordProfileRevision?(endpointId: string, revision: ProfileRevision): void;
}
