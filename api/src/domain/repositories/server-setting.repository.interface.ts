/**
 * Repository interface for the WI-7 server-global key/value settings store.
 *
 * Holds settings that are server-scope rather than endpoint-scope (which ride
 * profile.settings). Today: the server-scope `credentialSecretVisibility`
 * (the ceiling in the most-restrictive-wins precedence). See
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.
 *
 * Implementations: PrismaServerSettingRepository, InMemoryServerSettingRepository.
 */
export interface IServerSettingRepository {
  /** Read a setting value by key, or null when unset. */
  get(key: string): Promise<string | null>;

  /** Upsert a setting value. */
  set(key: string, value: string): Promise<void>;
}
