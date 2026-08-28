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

  /**
   * W1.2 - all active, non-expired credentials of one type, ACROSS every
   * endpoint. Used by the boot-time JWKS prewarm, which needs the set of
   * registered trusts before any request has named an endpoint.
   */
  findAllActiveByType(credentialType: string): Promise<EndpointCredentialModel[]>;

  /** Find a credential by ID. */
  findById(id: string): Promise<EndpointCredentialModel | null>;

  /**
   * P1 - find the ONE active credential carrying this public lookup key.
   *
   * This is the method that removes the O(N) bcrypt scan: a P1-format token
   * names its own row, so verification costs one indexed read and one HMAC
   * instead of a bcrypt compare against every active credential (287 ms each).
   * Returns null when the key is unknown or the row is inactive/expired.
   */
  findActiveByLookupKey(lookupKey: string): Promise<EndpointCredentialModel | null>;

  /** List all credentials for an endpoint (active and inactive). */
  findByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]>;

  /** Soft-deactivate (revoke) a credential by setting active=false. */
  deactivate(id: string): Promise<EndpointCredentialModel | null>;

  /** V2 - reactivate a previously deactivated credential (active=true). */
  reactivate(id: string): Promise<EndpointCredentialModel | null>;

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

  /**
   * Item 4: replace a credential's public metadata (used to EDIT a saved WIF
   * trust in place - correct a typo, rotate the JWKS URI, change required
   * roles, etc). Only the metadata JSON is replaced; credentialType, hash,
   * and secret envelope are untouched. Returns the updated row, or null if
   * the credential does not exist.
   */
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<EndpointCredentialModel | null>;

  /**
   * Item 4: update a credential's label (used to rename a WIF trust while
   * editing it). Optional so older repo mocks stay compatible. Returns the
   * updated row, or null if the credential does not exist.
   */
  updateLabel?(id: string, label: string | null): Promise<EndpointCredentialModel | null>;
}
