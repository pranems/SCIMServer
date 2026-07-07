/**
 * AdminSecuritySettingsController (WI-8) - the server-scope security settings
 * surface: the server-level CredentialSecretVisibility (the ceiling in the
 * most-restrictive-wins precedence) and the KEK status. See
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md section 6A.7.
 *
 *   GET /admin/settings/security   -> { credentialSecretVisibility, kek }
 *   PUT /admin/settings/security   -> set credentialSecretVisibility (always|once)
 *
 * The KEK status ({configured, isDefault}) never includes the KEK value.
 * Flipping the server setting to `once` purges every retained secret envelope
 * (defense-in-depth; reveal already gates on the effective value).
 */
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { CredentialSecurityService } from '../../../security/credential-security.service';
import { CredentialEncryptionService } from '../../../security/credential-encryption.service';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import {
  normalizeCredentialSecretVisibility,
  type CredentialSecretVisibility,
} from '../../endpoint/endpoint-config.interface';

interface SecuritySettingsResponse {
  credentialSecretVisibility: CredentialSecretVisibility;
  kek: { configured: boolean; isDefault: boolean };
}

interface UpdateSecuritySettingsDto {
  credentialSecretVisibility?: string;
}

@Controller('admin/settings/security')
export class AdminSecuritySettingsController {
  constructor(
    private readonly credentialSecurity: CredentialSecurityService,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly logger: ScimLogger,
  ) {}

  @Get()
  async get(): Promise<SecuritySettingsResponse> {
    return {
      credentialSecretVisibility: await this.credentialSecurity.getServerVisibility(),
      kek: this.credentialEncryption.getKekStatus(),
    };
  }

  @Put()
  async update(@Body() body: UpdateSecuritySettingsDto): Promise<SecuritySettingsResponse> {
    const next = normalizeCredentialSecretVisibility(body?.credentialSecretVisibility);
    if (!next) {
      throw new BadRequestException(
        'credentialSecretVisibility must be "always" or "once".',
      );
    }
    await this.credentialSecurity.setServerVisibility(next);
    this.logger.info(
      LogCategory.AUTH,
      `Server CredentialSecretVisibility set to "${next}".`,
    );
    // Server-scope `once` is the ceiling; purge retained ciphertext everywhere.
    if (next === 'once') {
      const cleared = await this.credentialSecurity.purgeAllRetainedSecrets();
      this.logger.info(
        LogCategory.AUTH,
        `Purged ${cleared} retained credential secret(s) after server flip to "once".`,
      );
    }
    return {
      credentialSecretVisibility: next,
      kek: this.credentialEncryption.getKekStatus(),
    };
  }
}
