/**
 * CredentialSecurityService (WI-7) - the runtime owner of the
 * `CredentialSecretVisibility` setting at both scopes (server + endpoint) and
 * the retain/purge orchestration for credential secrets. See
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.
 *
 * - Server scope: persisted in the ServerSetting KV store under
 *   `credentialSecretVisibility` (seeded to `always` by the migration / the
 *   inmemory backend). Read/written via this service.
 * - Endpoint scope: rides `profile.settings.CredentialSecretVisibility`.
 * - Effective value: most-restrictive-wins with the SERVER as the ceiling
 *   (`getEffectiveCredentialSecretVisibility`).
 *
 * Retention: when the effective value is `always`, a freshly-created secret is
 * encrypted (via CredentialEncryptionService) and its envelope stored on the
 * credential. When it flips to `once`, retained envelopes are purged.
 */
import { Inject, Injectable } from '@nestjs/common';
import { SERVER_SETTING_REPOSITORY, ENDPOINT_CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.tokens';
import type { IServerSettingRepository } from '../domain/repositories/server-setting.repository.interface';
import type { IEndpointCredentialRepository } from '../domain/repositories/endpoint-credential.repository.interface';
import {
  getEffectiveCredentialSecretVisibility,
  normalizeCredentialSecretVisibility,
  type CredentialSecretVisibility,
  type EndpointConfig,
} from '../modules/endpoint/endpoint-config.interface';

/** The ServerSetting key holding the server-scope visibility. */
export const SERVER_VISIBILITY_KEY = 'credentialSecretVisibility';

@Injectable()
export class CredentialSecurityService {
  constructor(
    @Inject(SERVER_SETTING_REPOSITORY)
    private readonly serverSettings: IServerSettingRepository,
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
  ) {}

  /** The server-scope visibility (defaults to `always` when unset/invalid). */
  async getServerVisibility(): Promise<CredentialSecretVisibility> {
    const raw = await this.serverSettings.get(SERVER_VISIBILITY_KEY);
    return normalizeCredentialSecretVisibility(raw) ?? 'always';
  }

  /** Set the server-scope visibility (validated by the caller). */
  async setServerVisibility(value: CredentialSecretVisibility): Promise<void> {
    await this.serverSettings.set(SERVER_VISIBILITY_KEY, value);
  }

  /**
   * The EFFECTIVE visibility for an endpoint, applying the server-ceiling
   * precedence over the endpoint config.
   */
  async getEffectiveVisibility(config: EndpointConfig | undefined): Promise<CredentialSecretVisibility> {
    const server = await this.getServerVisibility();
    return getEffectiveCredentialSecretVisibility(server, config);
  }

  /**
   * Purge retained secret envelopes for an endpoint (used when its effective
   * visibility becomes `once`). Returns the number of rows cleared.
   */
  async purgeRetainedSecrets(endpointId: string): Promise<number> {
    return this.credentialRepo.clearSecretEnvelopesForEndpoint(endpointId);
  }

  /**
   * Purge EVERY retained secret envelope (used when the server-scope visibility
   * flips to `once`, the global ceiling). Returns the number of rows cleared.
   */
  async purgeAllRetainedSecrets(): Promise<number> {
    return this.credentialRepo.clearAllSecretEnvelopes();
  }
}
