import { Controller, Get, Header, Inject, Param, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { OAUTH_METADATA_PATH } from '../../../oauth/oauth.constants';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import {
  WIF_PROFILE_RFC7523,
  trustEnablesProfile,
  type WifProfile,
} from './assertion-token-provider';

/** The RFC 8693 token-exchange grant URN (advertised only when W4 lands). */
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';

/**
 * The OAuth capabilities the runtime can ACTUALLY honor for one endpoint.
 * Derived from (a) what the token handler implements today and (b) the
 * endpoint's ACTIVE credentials/trusts - never from inert config fields.
 */
interface EndpointOAuthCapabilities {
  /** An active `oauth_client` credential exists -> client_secret_* works. */
  clientSecret: boolean;
  /** An active `wif` trust exists -> the RFC 7523 client-assertion works. */
  syncFabricRfc7523: boolean;
  /**
   * The RFC 8693 token-exchange handler is implemented AND active. It is NOT
   * implemented yet (delivery-plan Wave 4), so this is hard-false: advertising
   * it would be a live untruth the runtime rejects. Flip to a real capability
   * check when the handler ships.
   */
  syncFabricRfc8693: boolean;
}

/**
 * EndpointOAuthMetadataController (WI-12 + W0.3) - per-endpoint RFC 8414 OAuth
 * 2.0 Authorization Server Metadata, served in the OIDC-style APPEND form:
 *
 *   GET /scim/endpoints/:endpointId/.well-known/oauth-authorization-server
 *
 * This is the per-endpoint sibling of the global
 * [oauth-metadata.controller.ts](../../../oauth/oauth-metadata.controller.ts)
 * (which advertises only the global `/scim/oauth/token`). A standards-based
 * OAuth client can discover the PER-ENDPOINT token endpoint + the shared JWKS
 * without any prior configuration.
 *
 * **W0.3 - capability-derived (truthful) metadata.** The advertised grants +
 * client-auth methods are DERIVED from what the runtime implements and what the
 * endpoint actually has an active credential/trust for - not hardcoded. This
 * removes the prior live untruth where token-exchange (no runtime handler) and
 * `private_key_jwt` (even with no WIF trust) were advertised unconditionally
 * (see the SyncFabric guide Section 17). A method appears ONLY when a client
 * could actually use it against this endpoint's token endpoint.
 *
 * RFC 8414 rules honored:
 *  - the returned `issuer` MUST exactly equal the identifier used to build the
 *    URL (mix-up-attack defense, RFC 8414 section 3.3), i.e.
 *    `<base>/scim/endpoints/{id}` (the bare identifier form, not the `/v2` one);
 *  - the advertised `token_endpoint` is the per-endpoint one, and it starts
 *    with the issuer identifier (self-consistency);
 *  - `jwks_uri` points at the SHARED global key set - there is one signing key
 *    today, so every endpoint's tokens verify against the same JWKS.
 *
 * Public (no bearer required); the document contains only public URLs. Entra's
 * own provisioning client does NOT consume this (the admin types the values by
 * hand) - it is for standards-based OAuth clients + self-consistency.
 */
@Controller('endpoints/:endpointId')
export class EndpointOAuthMetadataController {
  constructor(
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('.well-known/oauth-authorization-server')
  @Header('Cache-Control', 'public, max-age=3600')
  async getMetadata(
    @Param('endpointId') endpointId: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
    const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
    const prefix = process.env.API_PREFIX ?? 'scim';
    const base = `${proto}://${host}`;

    // The issuer identifier is the BARE per-endpoint path (RFC 8414 section
    // 3.3). The token endpoint is built by appending to it, so it is trivially
    // self-consistent (token_endpoint.startsWith(issuer)).
    const issuer = `${base}/${prefix}/endpoints/${endpointId}`;

    const caps = await this.resolveCapabilities(endpointId);

    // Grant types: `client_credentials` always (both the oauth_client secret
    // path and the WIF client-assertion path ride it). token-exchange ONLY once
    // the RFC 8693 handler is active (W4) - never advertise what we reject.
    const grantTypes = ['client_credentials'];
    if (caps.syncFabricRfc8693) grantTypes.push(TOKEN_EXCHANGE_GRANT);

    // Client-auth methods: each appears ONLY with an active compatible
    // credential/trust, so a client is never told to use a method the token
    // endpoint would refuse.
    const authMethods: string[] = [];
    if (caps.clientSecret) authMethods.push('client_secret_basic', 'client_secret_post');
    if (caps.syncFabricRfc7523) authMethods.push('private_key_jwt');
    if (caps.syncFabricRfc8693) authMethods.push('none');

    const doc: Record<string, unknown> = {
      issuer,
      token_endpoint: `${issuer}/oauth/token`,
      jwks_uri: `${base}/${prefix}/oauth/jwks`,
      grant_types_supported: grantTypes,
      token_endpoint_auth_methods_supported: authMethods,
      scopes_supported: this.resolveScopes(),
    };

    // Signing-alg advertisement only matters when a JWT-assertion method is
    // advertised (the WIF/8693 profiles); the shared issuer verifies RS256/ES256.
    if (caps.syncFabricRfc7523 || caps.syncFabricRfc8693) {
      doc.token_endpoint_auth_signing_alg_values_supported = ['RS256', 'ES256'];
    }

    // Collision-resistant extension (guide 17.4, option 1): when a WIF profile
    // is active, disclose that the advertised `private_key_jwt` is a SyncFabric
    // client-assertion profile whose assertion SUBJECT is validated against the
    // endpoint's trust and need NOT equal `client_id` (unlike conventional
    // private_key_jwt). Present ONLY when the profile is actually active.
    const wifProfiles: Record<string, unknown>[] = [];
    if (caps.syncFabricRfc7523) {
      wifProfiles.push({
        name: 'syncfabric-rfc7523',
        client_id_binding: 'target-client-id',
        assertion_subject_binding: 'independent',
        resource_parameter_supported: true,
      });
    }
    if (caps.syncFabricRfc8693) {
      wifProfiles.push({
        name: 'syncfabric-rfc8693',
        subject_token_types_supported: ['urn:ietf:params:oauth:token-type:jwt'],
        requested_token_types_supported: ['urn:ietf:params:oauth:token-type:access_token'],
        client_authentication: 'none',
      });
    }
    if (wifProfiles.length > 0) {
      doc.x_scimserver_wif_profiles = wifProfiles;
    }

    return doc;
  }

  /**
   * Derive the endpoint's real OAuth capabilities from its ACTIVE credentials.
   * `findActiveByEndpoint` returns only active, non-expired rows, so a revoked
   * or disabled credential is never projected. Fails open to an empty set (a
   * valid document that advertises nothing) rather than falsely claiming a
   * capability when the lookup is unavailable.
   */
  private async resolveCapabilities(endpointId: string): Promise<EndpointOAuthCapabilities> {
    let active: Array<{ credentialType: string; metadata?: Record<string, unknown> | null }> = [];
    try {
      active = await this.credentialRepo.findActiveByEndpoint(endpointId);
    } catch {
      active = [];
    }
    const hasType = (t: string): boolean => active.some((c) => c.credentialType === t);
    // W3.1 - a WIF trust only makes a profile advertisable if it actually SERVES
    // that profile. A trust scoped to token-exchange no longer causes the RFC
    // 7523 client-assertion capability (and its `private_key_jwt` method) to be
    // advertised, because the 7523 provider will not select it. This keeps the
    // W0.3 "advertise only what is implemented AND active" invariant true now
    // that routing is per-variation.
    const hasWifForProfile = (profile: WifProfile): boolean =>
      active.some((c) => c.credentialType === 'wif' && trustEnablesProfile(c.metadata ?? null, profile));
    return {
      clientSecret: hasType('oauth_client'),
      syncFabricRfc7523: hasWifForProfile(WIF_PROFILE_RFC7523),
      // Still hardcoded false: there is no RFC 8693 runtime handler until Wave 4,
      // so an 8693-scoped trust must NOT make us advertise the grant.
      syncFabricRfc8693: false,
    };
  }

  /** The scopes the issuer recognizes (env-overridable), mirroring the global AS metadata. */
  private resolveScopes(): string[] {
    const raw = this.config.get<string>('OAUTH_CLIENT_SCOPES');
    return raw
      ? raw.split(',').map((s) => s.trim()).filter(Boolean)
      : ['scim.read', 'scim.write', 'scim.manage'];
  }

  /**
   * Re-exported for tests that assert the constant path is used verbatim; the
   * global metadata path constant and this per-endpoint route share the same
   * `.well-known/oauth-authorization-server` suffix.
   */
  static readonly WELL_KNOWN_SUFFIX = OAUTH_METADATA_PATH;
}
