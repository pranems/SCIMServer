/**
 * WI-15 - the persisted JWKS host allowlist entry (a host an admin added at
 * runtime, part of the effective seed + env + persisted union).
 */
export interface JwksHostAllowlistEntryModel {
  id: string;
  host: string;
  label: string | null;
  createdAt: Date;
}

/**
 * Repository for the persisted (admin-editable) JWKS host allowlist layer.
 * The effective allowlist consulted at runtime is the UNION of a compiled seed
 * + the env var + these rows (see JwksHostAllowlistService).
 */
export interface IJwksHostAllowlistRepository {
  /** All persisted hosts (lowercased), most-recent first. */
  findAll(): Promise<JwksHostAllowlistEntryModel[]>;
  /** Add a host (idempotent on the unique host). Returns the row. */
  add(host: string, label: string | null): Promise<JwksHostAllowlistEntryModel>;
  /** Remove a host by its (lowercased) value. Returns true if a row was removed. */
  removeByHost(host: string): Promise<boolean>;
}
