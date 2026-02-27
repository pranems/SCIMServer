/**
 * Repository interface for EndpointCredential (Phase 11).
 *
 * Abstracts persistence operations for per-endpoint credentials.
 * Implementations: PrismaEndpointCredentialRepository, InMemoryEndpointCredentialRepository.
 */
import type { EndpointCredentialModel, EndpointCredentialCreateInput } from '../models/endpoint-credential.model';

export interface IEndpointCredentialRepository {
  /** Create a new credential record. */
  create(input: EndpointCredentialCreateInput): Promise<EndpointCredentialModel>;

  /** Find all active, non-expired credentials for an endpoint. */
  findActiveByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]>;

  /** Find a credential by ID. */
  findById(id: string): Promise<EndpointCredentialModel | null>;

  /** List all credentials for an endpoint (active and inactive). */
  findByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]>;

  /** Soft-deactivate (revoke) a credential by setting active=false. */
  deactivate(id: string): Promise<EndpointCredentialModel | null>;

  /** Hard delete a credential. */
  delete(id: string): Promise<void>;
}
