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

  /**
   * WI-7: purge the retained secret envelope for every credential of an
   * endpoint (used when CredentialSecretVisibility flips to `once`). Returns
   * the number of rows cleared.
   */
  clearSecretEnvelopesForEndpoint(endpointId: string): Promise<number>;

  /**
   * WI-8: purge the retained secret envelope for EVERY credential (used when
   * the server-scope CredentialSecretVisibility flips to `once`, the global
   * ceiling). Returns the number of rows cleared.
   */
  clearAllSecretEnvelopes(): Promise<number>;

  /** Hard delete a credential. */
  delete(id: string): Promise<void>;
}
