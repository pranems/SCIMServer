import { Injectable, Inject, Optional, type OnModuleInit } from '@nestjs/common';
import { ExternalJwksValidatorService } from './external-jwks-validator.service';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../domain/repositories/endpoint-credential.repository.interface';

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
    @Optional()
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo?: IEndpointCredentialRepository,
  ) {}

  /** Returns the number of distinct JWKS URIs attempted, for tests and logs. */
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

    const uris = new Set<string>();
    for (const t of trusts) {
      const uri = t.metadata?.jwksUri;
      if (typeof uri === 'string' && uri.length > 0) uris.add(uri);
    }

    // allSettled, not all: `prewarm` already promises never to reject, but this
    // runs at boot and must not depend on a collaborator keeping that promise.
    await Promise.allSettled([...uris].map((uri) => this.validator.prewarm(uri)));

    // Logged even when nothing was warmed. A boot-time action leaves no other
    // trace, so without an unconditional line there is no way to tell "ran and
    // found no trusts" from "never ran" - which is the only externally
    // observable evidence this feature works at all.
    this.logger.info(LogCategory.AUTH, 'JWKS prewarm complete', {
      trusts: trusts.length,
      distinctJwksUris: uris.size,
    });
    return uris.size;
  }
}
