/**
 * CredentialEncryptionService (WI-6) - the runtime owner of the retained-secret
 * envelope-encryption scheme (docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md
 * section 6A). It wires the pure crypto core ([credential-envelope.ts](./credential-envelope.ts))
 * to the KEK env loader ([credential-kek.ts](./credential-kek.ts)) and the
 * persisted wrapped DEK ([credential-dek.repository.interface.ts](../domain/repositories/credential-dek.repository.interface.ts)).
 *
 * Lifecycle:
 *   OnModuleInit -> ensure a DEK exists. If none is persisted, generate one,
 *   wrap it under the KEK-derived key, and persist it (+ its scrypt salt). Then
 *   unwrap the active DEK into memory so encrypt/decrypt are synchronous.
 *
 * The KEK is NEVER on the authentication hot path - token verification compares
 * the bcrypt hash. This service is touched only by the retain-on-create + admin
 * reveal + rotate paths.
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { CREDENTIAL_DEK_REPOSITORY } from '../domain/repositories/repository.tokens';
import type { ICredentialDekRepository } from '../domain/repositories/credential-dek.repository.interface';
import {
  deriveKekKey,
  encryptSecret,
  decryptSecret,
  generateDek,
  generateKekSalt,
  unwrapDek,
  wrapDek,
} from './credential-envelope';
import { loadCredentialKek, isDefaultKek } from './credential-kek';

@Injectable()
export class CredentialEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(CredentialEncryptionService.name);

  /** The unwrapped active DEK, held in memory after init. Null until ready. */
  private dek: Buffer | null = null;

  constructor(
    @Inject(CREDENTIAL_DEK_REPOSITORY)
    private readonly dekRepo: ICredentialDekRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDek();
      if (isDefaultKek()) {
        this.logger.warn(
          'CREDENTIAL_KEK is the public default - retained-secret encryption-at-rest is ' +
            'cosmetic until a private KEK is set in prod. See DEPLOYMENT.md section on the KEK.',
        );
      }
    } catch (err) {
      // Never block startup: retained-secret reveal is an optional admin
      // convenience, not the auth path. Log and continue; encrypt/decrypt will
      // report unavailability if called.
      this.logger.error(
        `Failed to initialise the credential DEK; retained-secret reveal is unavailable: ${
          (err as Error).message
        }`,
      );
    }
  }

  /** Load the active DEK (unwrapping it) or provision + persist a fresh one. */
  private async ensureDek(): Promise<void> {
    const passphrase = loadCredentialKek();
    const active = await this.dekRepo.findActive();
    if (active) {
      const kekKey = deriveKekKey(passphrase, Buffer.from(active.kekSalt, 'base64url'));
      this.dek = unwrapDek(active.wrappedDek, kekKey);
      return;
    }
    // Provision a new DEK.
    const salt = generateKekSalt();
    const kekKey = deriveKekKey(passphrase, salt);
    const dek = generateDek();
    const wrapped = wrapDek(dek, kekKey);
    await this.dekRepo.create({ wrappedDek: wrapped, kekSalt: salt.toString('base64url') });
    this.dek = dek;
    this.logger.log('Provisioned a new credential DEK (wrapped under the KEK).');
  }

  /** Whether the DEK is loaded and encrypt/decrypt can run. */
  isReady(): boolean {
    return this.dek !== null;
  }

  /**
   * Encrypt a plaintext secret for retention. Returns a `v1....` envelope.
   * Throws if the DEK is not available (init failed).
   */
  encrypt(plaintext: string): string {
    if (!this.dek) {
      throw new Error('Credential encryption is unavailable (DEK not initialised).');
    }
    return encryptSecret(plaintext, this.dek);
  }

  /** Decrypt a retained-secret envelope back to plaintext. */
  decrypt(envelope: string): string {
    if (!this.dek) {
      throw new Error('Credential encryption is unavailable (DEK not initialised).');
    }
    return decryptSecret(envelope, this.dek);
  }

  /** KEK status for the admin security-settings surface (no secret value). */
  getKekStatus(): { configured: boolean; isDefault: boolean } {
    // `configured` is always true - there is always an effective KEK (the
    // default). `isDefault` tells the operator whether at-rest protection is
    // still cosmetic.
    return { configured: true, isDefault: isDefaultKek() };
  }
}
