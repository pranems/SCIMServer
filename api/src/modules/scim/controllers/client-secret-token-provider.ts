/**
 * W2.3 - the `client_secret` (RFC 6749 client_credentials) token provider.
 *
 * Extracts the credential lookup + bcrypt verification + mint that used to live
 * inline in `EndpointOAuthController.handleClientSecret`, so the controller no
 * longer carries any bcrypt / repository logic - it just routes the parsed
 * request (W2.2) to this provider and shapes the response + decision trace.
 *
 * The provider owns the per-check auth trace THROUGH `secret_match` (and, on
 * accept, mints the endpoint token). It deliberately does NOT emit the decision
 * event, add the `token_ttl` / `method_enabled_shadow` checks, or shape the HTTP
 * response - those cross-cutting concerns stay in the controller (and centralize
 * in W2.4's `AuthDecisionEmitter`). This keeps the provider a pure mint unit,
 * symmetric with the assertion provider.
 */
import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { HASH_ALGO_HMAC_V1, parseCredentialToken, verifySecretHash } from '../../../security/credential-token';
import type { AccessToken } from '../../../oauth/oauth.service';
import { OAuthService } from '../../../oauth/oauth.service';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import type { AuthCheck } from '../../../oauth/auth-decision-trace';

/** The already-parsed client_secret request (W2.2 union member fields). */
export interface ClientSecretMintRequest {
  clientId: string;
  clientSecret: string;
  credentialLocation: 'client_secret_post' | 'client_secret_basic';
  scope?: string;
}

/** Three-outcome result the controller turns into a response + decision event. */
export type ClientSecretMintOutcome =
  | { outcome: 'accept'; token: AccessToken; checks: AuthCheck[] }
  | { outcome: 'reject'; reasonCode: string; checks: AuthCheck[] };

@Injectable()
export class ClientSecretTokenProvider {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly oauthService: OAuthService,
  ) {}

  /**
   * Verify the presented `client_secret` against the endpoint's active
   * `oauth_client` credentials and, on success, mint the endpoint token. Returns
   * a reject outcome (with the per-check trace) on any mismatch - it never
   * throws for an auth failure, so the controller owns the error shaping.
   */
  async mintFromClientSecret(
    endpointId: string,
    req: ClientSecretMintRequest,
  ): Promise<ClientSecretMintOutcome> {
    const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
    const candidates = credentials.filter(
      (c) => c.credentialType === 'oauth_client' && c.metadata?.clientId === req.clientId,
    );

    // P6: every oauth_client credential on an endpoint shares one clientId
    // (`client-id-<endpointId>`), so picking the candidate with `.find()` meant
    // only ONE could ever authenticate - while the P2 caps allow five, and
    // `findActiveByEndpoint` has no `orderBy`, leaving WHICH one unspecified on
    // Postgres. That also blocked the only zero-downtime migration path: issue
    // the new keyed secret alongside the old, let the integration owner switch
    // when convenient, then retire the old.
    //
    // P1 hybrid: a secret minted after v0.55.17 carries its own lookup key, so
    // it names its row exactly - no scan, unambiguous at any number of
    // credentials. Legacy `client-secret-<uuid>` secrets carry nothing
    // identifying, so each pre-migration row must be tried; that loop is bounded
    // by MaxActiveOAuthClientCredentials and shrinks as rotation progresses.
    const parsed = parseCredentialToken(req.clientSecret);
    let candidate: (typeof candidates)[number] | undefined;

    if (parsed) {
      const keyed = candidates.find(
        (c) => c.hashAlgo === HASH_ALGO_HMAC_V1 && c.lookupKey === parsed.lookupKey,
      );
      if (keyed?.secretHash && verifySecretHash(parsed.secret, keyed.secretHash)) {
        candidate = keyed;
      }
    }

    if (!candidate) {
      for (const c of candidates) {
        if (c.hashAlgo === HASH_ALGO_HMAC_V1) continue;
        if (await bcrypt.compare(req.clientSecret, c.credentialHash)) {
          candidate = c;
          break;
        }
      }
    }

    // `client_found` answers "is this clientId registered at all", which is not
    // the same question as "did a secret verify" - keep them distinct so the
    // trace still tells an operator which half failed.
    const clientFound = candidates.length > 0;
    const secretValid = candidate != null;

    // The per-check trace: real expected-vs-received, never the secret value.
    const checks: AuthCheck[] = [
      { id: 'grant_type', status: 'pass', expected: 'client_credentials', received: 'client_credentials' },
      {
        id: 'credential_location',
        status: 'pass',
        expected: 'client_secret_basic | client_secret_post',
        received: req.credentialLocation,
      },
      {
        id: 'client_id_present',
        status: req.clientId ? 'pass' : 'fail',
        expected: 'present',
        received: req.clientId ? 'present' : 'absent',
      },
      {
        id: 'client_found',
        status: clientFound ? 'pass' : 'fail',
        expected: '(a registered oauth_client for this endpoint)',
        received: clientFound ? 'found' : 'not found',
      },
      {
        id: 'secret_match',
        status: secretValid ? 'pass' : 'fail',
        expected: '(the registered client secret)',
        received: secretValid ? 'match' : 'mismatch',
      },
    ];

    if (!candidate || !secretValid) {
      return { outcome: 'reject', reasonCode: 'oauth_client_auth_failed', checks };
    }

    const token = await this.oauthService.generateEndpointAccessToken(
      endpointId,
      req.clientId,
      req.scope,
      // W3.8 (guide 13.4) - name the profile that authorized this mint so a
      // consumer can tell a plain client_secret token from a federated one.
      { authMethod: 'client_secret' },
    );
    return { outcome: 'accept', token, checks };
  }
}
