import { Controller, Get } from '@nestjs/common';
import {
  CredentialMigrationService,
  type CredentialMigrationStatus,
} from '../services/credential-migration.service';

/**
 * P1 phase 4 - the measurement surface for the bcrypt tail.
 *
 * Phase 5 (deleting the legacy verifier) is one-way, so it is gated on
 * `readyToRetireLegacyPath` being true on EVERY estate rather than on elapsed
 * time. "It has been three months, probably fine" is the reasoning that
 * produced the EOL-Node escape.
 *
 * Admin-only (the default bearer guard applies - no `@Public`). Its own
 * controller rather than another method on AdminCredentialController, which is
 * already a god-class at 1,200+ lines (register item D1).
 */
@Controller('admin/credentials')
export class CredentialMigrationController {
  constructor(private readonly migration: CredentialMigrationService) {}

  @Get('migration-status')
  getMigrationStatus(): Promise<CredentialMigrationStatus> {
    return this.migration.getMigrationStatus();
  }
}
