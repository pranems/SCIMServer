/**
 * Repository interface for the WI-6 credential data-encryption-key (DEK).
 *
 * The DEK is a per-install 32-byte key stored WRAPPED (encrypted) by the KEK
 * (which lives only in env). Persisting the wrapped DEK is what makes retained
 * secrets survive restart / redeploy / backup, while a DB dump alone stays
 * inert (the KEK is not in the DB). See
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.4.
 *
 * Implementations: PrismaCredentialDekRepository, InMemoryCredentialDekRepository.
 */

/** A persisted (wrapped) data-encryption key. */
export interface CredentialDekModel {
  id: string;
  /** The DEK wrapped by the KEK-derived key: `v1.<iv>.<ct>.<tag>`. */
  wrappedDek: string;
  /** The scrypt salt (base64url) used to derive the KEK key that wrapped it. */
  kekSalt: string;
  /** Only one DEK is active at a time; rotation flips this. */
  active: boolean;
  createdAt: Date;
}

export interface CredentialDekCreateInput {
  wrappedDek: string;
  kekSalt: string;
}

export interface ICredentialDekRepository {
  /** The current active DEK, or null when none has been provisioned yet. */
  findActive(): Promise<CredentialDekModel | null>;

  /** Persist a new active DEK. Any prior active DEK is left as-is (rotation is WI-9). */
  create(input: CredentialDekCreateInput): Promise<CredentialDekModel>;
}
