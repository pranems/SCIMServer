/**
 * Domain model for endpoint credentials (Phase 11).
 *
 * Represents a per-endpoint authentication credential stored in the
 * EndpointCredential table. The plaintext token is never stored - only
 * its bcrypt hash.
 */

export interface EndpointCredentialModel {
  id: string;
  endpointId: string;
  credentialType: string;   // "bearer" | "oauth_client"
  credentialHash: string;   // bcrypt hash
  label: string | null;
  metadata: Record<string, unknown> | null;
  active: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface EndpointCredentialCreateInput {
  endpointId: string;
  credentialType: string;
  credentialHash: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}
