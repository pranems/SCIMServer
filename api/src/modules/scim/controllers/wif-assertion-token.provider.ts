import { Inject, Injectable } from '@nestjs/common';
import type { AccessToken } from '../../../oauth/oauth.service';
import { OAuthService } from '../../../oauth/oauth.service';
import {
  WifAssertionValidatorService,
  WifAssertionInvalidError,
  type WifTrust,
} from '../../../oauth/wif-assertion-validator.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';
import type { IAssertionTokenProvider } from './assertion-token-provider';

/**
 * WifAssertionTokenProvider (Q6.4) - binds the A3 `IAssertionTokenProvider`
 * seam to the WIF validation + issuance pipeline.
 *
 * Three-outcome contract (architecture section 2.2):
 *  - No `wif` trust configured for the endpoint  -> `null` (not-mine-continue).
 *  - A `wif` trust exists but the assertion fails -> throws (mine-but-invalid-stop).
 *  - A `wif` trust exists and the assertion is valid -> mints and returns the
 *    endpoint's own short-lived token, scoped to the configured `scope`.
 *
 * The minted token is the ISV's OWN token (the Entra assertion is presented once
 * here and never rides the SCIM calls). No secret is read or stored - the WIF
 * trust is all public values on the `wif` EndpointCredential.metadata.
 */
@Injectable()
export class WifAssertionTokenProvider implements IAssertionTokenProvider {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly validator: WifAssertionValidatorService,
    private readonly oauthService: OAuthService,
    private readonly logger: ScimLogger,
  ) {}

  async mintFromAssertion(endpointId: string, clientAssertion: string): Promise<AccessToken | null> {
    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const wif = credentials.find((c) => c.credentialType === 'wif');

    // Not-mine-continue: no WIF trust configured for this endpoint.
    if (!wif) {
      return null;
    }

    // From here on the assertion is "mine": any failure throws (the controller
    // maps that to invalid_client) and NEVER falls through.
    const trust = this.buildTrust(wif.metadata);
    const claims = await this.validator.validate(clientAssertion, trust);

    const token = await this.oauthService.generateEndpointAccessToken(
      endpointId,
      String(claims.sub),
      undefined,
      { ttlSec: trust.issuedTokenTtlSec, trustedScope: trust.scope },
    );

    this.logger.info(LogCategory.AUTH, 'WIF assertion accepted; endpoint token minted', {
      endpointId,
      subject: trust.expectedSubject,
      scope: token.scope,
    });

    return token;
  }

  /**
   * Build the validated `WifTrust` from the persisted `wif` credential
   * metadata. A `wif` credential whose metadata is missing a required public
   * trust field is misconfigured - fail closed (throw), never silently accept.
   */
  private buildTrust(metadata: Record<string, unknown> | null): WifTrust {
    const m = metadata ?? {};
    const requireString = (key: string): string => {
      const value = m[key];
      if (typeof value !== 'string' || value.length === 0) {
        throw new WifAssertionInvalidError(`WIF trust metadata is missing required field "${key}".`);
      }
      return value;
    };

    return {
      expectedIssuer: requireString('expectedIssuer'),
      expectedSubject: requireString('expectedSubject'),
      expectedAudience: requireString('expectedAudience'),
      jwksUri: requireString('jwksUri'),
      allowedTenantId: requireString('allowedTenantId'),
      requiredRoles: Array.isArray(m.requiredRoles)
        ? (m.requiredRoles as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined,
      expectedResource: typeof m.expectedResource === 'string' ? m.expectedResource : undefined,
      scope: typeof m.scope === 'string' ? m.scope : undefined,
      issuedTokenTtlSec: typeof m.issuedTokenTtlSec === 'number' ? m.issuedTokenTtlSec : undefined,
    };
  }
}
