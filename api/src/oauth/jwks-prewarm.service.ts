import { Injectable, Inject, Optional, type OnModuleInit } from '@nestjs/common';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../modules/endpoint/services/endpoint.service';
import { resolveEndpointEgressOverrides } from '../modules/endpoint/endpoint-config.interface';
import type { EgressPolicyOverrides } from './egress-policy';

/**
 * W1.2 - fetch every registered trust's JWKS at boot.
 *
 * W1.4 keeps the cache warm once it holds an entry, but nothing put the first
 * entry there, so the FIRST WIF mint after a deploy paid a cold outbound fetch
 * on a real user's request. This closes that window.
 *
 * It is a separate service rather than more work inside
 * {@link ExternalJwksValidatorService} because the validator has no business
 * knowing that trusts are stored as endpoint credentials. The validator warms a
 * URI; this decides which URIs exist.
 */
@Injectable()
export class JwksPrewarmService implements OnModuleInit {
  constructor(
    private readonly validator: ExternalJwksValidatorService,
    private readonly logger: ScimLogger,
    private readonly endpointService: EndpointService,
    @Optional()
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo?: IEndpointCredentialRepository,
  ) {}

  /** Returns the number of distinct URI + effective-policy partitions attempted. */
  async onModuleInit(): Promise<number> {
    const repo = this.credentialRepo;
    if (!repo || typeof repo.findAllActiveByType !== 'function') return 0;

    let trusts;
    try {
      trusts = await repo.findAllActiveByType('wif');
    } catch (err) {
      // Boot must survive a database that is not ready yet.
      this.logger.warn(LogCategory.AUTH, 'JWKS prewarm skipped (trust lookup failed at boot)', {
        reason: (err as Error)?.message,
      });
      return 0;
    }

    const distinctUris = new Set<string>();
    const partitions = new Map<string, { uri: string; overrides: EgressPolicyOverrides }>();
    for (const t of trusts) {
      const uri = t.metadata?.jwksUri;
      if (typeof uri !== 'string' || uri.length === 0) continue;
      distinctUris.add(uri);
      let overrides: EgressPolicyOverrides = {};
      try {
        const endpoint = await this.endpointService.getEndpoint(t.endpointId);
        overrides = resolveEndpointEgressOverrides(endpoint.profile?.settings);
      } catch (err) {
        this.logger.warn(LogCategory.AUTH, 'JWKS prewarm using server policy (endpoint lookup failed)', {
          endpointId: t.endpointId,
          reason: (err as Error)?.message,
        });
      }
      const policyIdentity = JSON.stringify(
        Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)),
      );
      partitions.set(JSON.stringify([uri, policyIdentity]), { uri, overrides });
    }

    // allSettled, not all: `prewarm` already promises never to reject, but this
    // runs at boot and must not depend on a collaborator keeping that promise.
    await Promise.allSettled(
      [...partitions.values()].map(({ uri, overrides }) => this.validator.prewarm(uri, overrides)),
    );

    // Logged even when nothing was warmed. A boot-time action leaves no other
    // trace, so without an unconditional line there is no way to tell "ran and
    // found no trusts" from "never ran" - which is the only externally
    // observable evidence this feature works at all.
    this.logger.info(LogCategory.AUTH, 'JWKS prewarm complete', {
      trusts: trusts.length,
      distinctJwksUris: distinctUris.size,
      policyPartitions: partitions.size,
    });
    return partitions.size;
  }
}
