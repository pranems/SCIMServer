import { Inject, Injectable } from '@nestjs/common';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type {
  IEndpointCredentialRepository,
  CredentialAlgoCount,
} from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { HASH_ALGO_BCRYPT, HASH_ALGO_HMAC_V1 } from '../../../security/credential-token';

export interface CredentialPopulationSplit {
  total: number;
  active: number;
  inactive: number;
}

export interface EndpointLegacyCredentials {
  endpointId: string;
  endpointName: string | null;
  legacyTotal: number;
  legacyActive: number;
  legacyInactive: number;
  keyedTotal: number;
}

export interface CredentialMigrationStatus {
  generatedAt: string;
  total: number;
  legacy: CredentialPopulationSplit;
  keyed: CredentialPopulationSplit;
  /** Rows with no secret at all (wif) - never bcrypt-verified, so not the tail. */
  secretless: CredentialPopulationSplit;
  byAlgo: Record<string, number>;
  /** True only when NO credential anywhere still needs the bcrypt verifier. */
  readyToRetireLegacyPath: boolean;
  /** Only endpoints that still hold legacy rows - the list IS the work queue. */
  endpoints: EndpointLegacyCredentials[];
}

/**
 * Credential types that carry NO secret, so they never reach the bcrypt
 * verifier. A WIF trust is public metadata checked as a JWT against a JWKS;
 * it is stored with an empty hash and therefore inherits the `bcrypt` column
 * default, which would otherwise hold the phase-5 gate shut permanently.
 */
const SECRETLESS_TYPES = new Set(['wif']);

/**
 * P1 phase 4 - report the remaining bcrypt tail.
 *
 * Phase 5 deletes the legacy verifier and is one-way, so it is gated on this
 * number being zero rather than on elapsed time. Kept out of
 * AdminCredentialController deliberately: that file is already a god-class
 * (register item D1) and this is a distinct responsibility.
 */
@Injectable()
export class CredentialMigrationService {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly endpointService: EndpointService,
  ) {}

  async getMigrationStatus(): Promise<CredentialMigrationStatus> {
    const groups = await this.credentialRepo.countByHashAlgo();
    const names = await this.endpointNames();

    const legacy: CredentialPopulationSplit = { total: 0, active: 0, inactive: 0 };
    const keyed: CredentialPopulationSplit = { total: 0, active: 0, inactive: 0 };
    const secretless: CredentialPopulationSplit = { total: 0, active: 0, inactive: 0 };
    const byAlgo: Record<string, number> = {};
    const perEndpoint = new Map<string, EndpointLegacyCredentials>();

    for (const g of groups) {
      const algo = g.hashAlgo ?? HASH_ALGO_BCRYPT;
      byAlgo[algo] = (byAlgo[algo] ?? 0) + g.count;

      // Anything that is not provably keyed needs the legacy verifier, so an
      // algorithm we do not recognise must not open the one-way gate.
      const kind = SECRETLESS_TYPES.has(g.credentialType ?? '')
        ? 'secretless'
        : algo === HASH_ALGO_HMAC_V1
          ? 'keyed'
          : 'legacy';
      const bucket = kind === 'secretless' ? secretless : kind === 'keyed' ? keyed : legacy;
      bucket.total += g.count;
      if (g.active) bucket.active += g.count;
      else bucket.inactive += g.count;

      const row = perEndpoint.get(g.endpointId) ?? {
        endpointId: g.endpointId,
        endpointName: names.get(g.endpointId) ?? null,
        legacyTotal: 0,
        legacyActive: 0,
        legacyInactive: 0,
        keyedTotal: 0,
      };
      if (kind === 'keyed') {
        row.keyedTotal += g.count;
      } else if (kind === 'legacy') {
        row.legacyTotal += g.count;
        if (g.active) row.legacyActive += g.count;
        else row.legacyInactive += g.count;
      }
      perEndpoint.set(g.endpointId, row);
    }

    return {
      generatedAt: new Date().toISOString(),
      total: legacy.total + keyed.total + secretless.total,
      legacy,
      keyed,
      secretless,
      byAlgo,
      readyToRetireLegacyPath: legacy.total === 0,
      endpoints: Array.from(perEndpoint.values())
        .filter((e) => e.legacyTotal > 0)
        .sort((a, b) => b.legacyTotal - a.legacyTotal),
    };
  }

  private async endpointNames(): Promise<Map<string, string>> {
    try {
      const list = await this.endpointService.listEndpoints();
      return new Map((list?.endpoints ?? []).map((e) => [e.id, e.name]));
    } catch {
      // A name is a convenience; failing to resolve one must not hide the tail.
      return new Map();
    }
  }
}

// Referenced so the grouped-count contract stays visible at this seam.
export type { CredentialAlgoCount };
