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
 * - Effective value: always retain encrypted copies for authenticated admin
 *   display and export. Legacy `once` values are read but resolve to `always`.
 *
 * A freshly-created or rotated secret is encrypted via CredentialEncryptionService
 * and its envelope is stored on the credential.
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
    normalizeCredentialSecretVisibility(raw);
    return 'always';
  }

  /** Set the server-scope visibility (validated by the caller). */
  async setServerVisibility(value: CredentialSecretVisibility): Promise<void> {
    await this.serverSettings.set(SERVER_VISIBILITY_KEY, value === 'always' ? value : 'always');
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
  * Administrative compatibility helper for explicitly purging retained
  * envelopes on an endpoint. Current visibility policy never calls it.
   */
  async purgeRetainedSecrets(endpointId: string): Promise<number> {
    return this.credentialRepo.clearSecretEnvelopesForEndpoint(endpointId);
  }

  /**
  * Administrative compatibility helper for explicitly purging every retained
  * envelope. Current visibility policy never calls it.
   */
  async purgeAllRetainedSecrets(): Promise<number> {
    return this.credentialRepo.clearAllSecretEnvelopes();
  }
}
