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
  /** WI-7: retained secret, DEK-encrypted (`v1.<iv>.<ct>.<tag>`); null unless retained. */
  secretEnvelope: string | null;
  active: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  /** P1: public identifier carried in the token; null on pre-P1 rows. */
  lookupKey?: string | null;
  /** P1: HMAC-SHA256(pepper, secret), hex; null on pre-P1 rows. */
  secretHash?: string | null;
  /** P1: `bcrypt` (legacy) or `hmac-sha256-v1`. Selects the verifier. */
  hashAlgo?: string;
}

export interface EndpointCredentialCreateInput {
  endpointId: string;
  credentialType: string;
  credentialHash: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  /** WI-7: retained (DEK-encrypted) secret envelope; omit/null when not retained. */
  secretEnvelope?: string | null;
  expiresAt?: Date | null;
  lookupKey?: string | null;
  secretHash?: string | null;
  hashAlgo?: string;
}
