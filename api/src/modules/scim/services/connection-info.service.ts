/**
 * ConnectionInfoService (WI-2) - the single server-side assembler for an
 * endpoint's "connection properties": every absolute URL an identity provider
 * (primarily Microsoft Entra ID) needs, plus the per-auth-method field set,
 * assembled once so no UI hand-builds URLs.
 *
 * Design: docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md Part 6.
 *
 * Contract guarantees:
 *  - NO secrets are ever present. `secretToken` / `clientSecret` are always
 *    null; secrets remain one-time-at-create on the credential-create path.
 *  - The URL shapes match the authoritative forms in Part 2: the customer-
 *    facing SCIM base is the LEADING `/scim/v2/endpoints/{id}` form (WI-1),
 *    the per-endpoint token endpoint is the bare `/scim/endpoints/{id}/oauth/token`
 *    form, and the per-endpoint RFC 8414 metadata is the WI-12 append form.
 *  - The method-enablement decisions reuse `getEffectiveAuthEnablement` +
 *    `getConfigBoolean`, so they agree byte-for-byte with the create-gate and
 *    the resource-plane guard.
 *
 * The service is PURE: it takes the already-loaded endpoint + credentials + a
 * base URL and returns the assembled shape. Host derivation (X-Forwarded-*)
 * and data loading live in the controller, keeping this trivially unit-testable
 * across host-header permutations.
 */
import { Injectable } from '@nestjs/common';
import {
  ENDPOINT_CONFIG_FLAGS,
  getConfigBoolean,
  getEffectiveAuthEnablement,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';
import type {
  ConnectionDisabledMethod,
  ConnectionEnabledMethod,
  ConnectionInfo,
  ConnectionInfoUrls,
} from '../../../shared/types/connection-info.types';

// Re-export the shared connection-info types so existing importers of this
// module keep working; the canonical definitions live in the shared types so
// the web `ConnectionPanel` (via `@scim/types`) consumes the identical shape.
export type {
  ClientSecretState,
  ConnectionDisabledMethod,
  ConnectionEnabledMethod,
  ConnectionInfo,
  ConnectionInfoUrls,
  ConnectionMethod,
} from '../../../shared/types/connection-info.types';

/** The minimal endpoint fields the assembler needs. */
export interface ConnectionInfoEndpointInput {
  id: string;
  name: string;
  displayName?: string;
  profile?: { settings?: Record<string, unknown> } | null;
}

/**
 * The resolved secret values a connection surface may inline when the effective
 * `CredentialSecretVisibility` is `always`. Each is null when withheld. Mirrors
 * `ResolvedConnectionSecrets` from the ConnectionSecretResolverService so the
 * assembler stays pure (no service dependency). Omitted entirely = withhold all
 * (backward-compatible default: no secret is ever inlined).
 */
export interface AssembleSecrets {
  sharedSecret?: string | null;
  bearerToken?: string | null;
  oauthClientSecret?: string | null;
}

@Injectable()
export class ConnectionInfoService {
  /**
   * Build the absolute URL set for an endpoint. `baseUrl` is the scheme+host
   * origin (no trailing slash), e.g. `https://scim.example.com`.
   */
  buildUrls(baseUrl: string, endpointId: string): ConnectionInfoUrls {
    const prefix = process.env.API_PREFIX ?? 'scim';
    const origin = baseUrl.replace(/\/+$/, '');
    const v2Base = `${origin}/${prefix}/v2/endpoints/${endpointId}`;
    const bareBase = `${origin}/${prefix}/endpoints/${endpointId}`;
    return {
      scimBaseUrl: v2Base,
      scimBaseUrlBare: bareBase,
      tokenEndpoint: `${bareBase}/oauth/token`,
      serviceProviderConfig: `${v2Base}/ServiceProviderConfig`,
      oauthMetadata: `${bareBase}/.well-known/oauth-authorization-server`,
    };
  }

  /**
   * Assemble the full connection-info shape from an already-loaded endpoint +
   * its credentials + the request-derived base URL.
   */
  assemble(
    endpoint: ConnectionInfoEndpointInput,
    credentials: EndpointCredentialModel[],
    baseUrl: string,
    secrets?: AssembleSecrets,
  ): ConnectionInfo {
    const endpointId = endpoint.id;
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    const urls = this.buildUrls(baseUrl, endpointId);
    const effective = getEffectiveAuthEnablement(config);
    const wifEnabled = getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED);

    const activeCreds = credentials.filter((c) => c.active);

    const enabledMethods: ConnectionEnabledMethod[] = [];
    const disabledMethods: ConnectionDisabledMethod[] = [];

    // ── shared_secret (global SCIM_SHARED_SECRET bearer) ──────────────────
    if (effective.sharedSecretBearer) {
      // The secret is the server-configured global SCIM_SHARED_SECRET. It is
      // inlined ONLY when the server visibility is `always` (resolved upstream
      // and passed in as `secrets.sharedSecret`); otherwise it stays null.
      const sharedSecretValue = secrets?.sharedSecret ?? null;
      enabledMethods.push({
        method: 'shared_secret',
        label: 'Shared-secret bearer token',
        entraAuthenticationMethod: 'Secret Token',
        entraFields: {
          tenantUrl: urls.scimBaseUrl,
          secretToken: sharedSecretValue,
        },
        clientSecretState: sharedSecretValue ? 'set-shown-once' : 'none',
        secretRevealed: sharedSecretValue !== null,
      });
    } else {
      disabledMethods.push({
        method: 'shared_secret',
        reason: `${ENDPOINT_CONFIG_FLAGS.SHARED_SECRET_BEARER_AUTH_ENABLED} is false`,
        enableHint: `Set ${ENDPOINT_CONFIG_FLAGS.SHARED_SECRET_BEARER_AUTH_ENABLED}=True in endpoint Settings`,
      });
    }

    // ── bearer (per-endpoint Secret Token) ────────────────────────────────
    if (effective.secretTokenBearer) {
      const bearerCred = activeCreds.find((c) => c.credentialType === 'bearer');
      // Inline the decrypted token ONLY when the effective visibility is
      // `always` AND the credential retained an envelope (resolved upstream).
      const bearerSecret = bearerCred ? (secrets?.bearerToken ?? null) : null;
      enabledMethods.push({
        method: 'bearer',
        label: 'Per-endpoint bearer token (Secret Token)',
        entraAuthenticationMethod: 'Secret Token',
        entraFields: {
          tenantUrl: urls.scimBaseUrl,
          secretToken: bearerSecret,
        },
        clientSecretState: bearerCred ? 'set-shown-once' : 'create-required',
        credentialId: bearerCred?.id ?? null,
        secretRetained: !!bearerCred?.secretEnvelope,
        secretRevealed: bearerSecret !== null,
      });
    } else {
      disabledMethods.push({
        method: 'bearer',
        reason: `${ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED} is not set`,
        enableHint: `Set ${ENDPOINT_CONFIG_FLAGS.SECRET_TOKEN_BEARER_AUTH_ENABLED}=True in endpoint Settings`,
      });
    }

    // ── oauth_client (per-endpoint OAuth2 client credentials) ─────────────
    if (effective.oauthClientCredentials) {
      const oauthCred = activeCreds.find((c) => c.credentialType === 'oauth_client');
      const clientId =
        typeof oauthCred?.metadata?.clientId === 'string' ? oauthCred.metadata.clientId : null;
      // Inline the decrypted client secret ONLY when effective visibility is
      // `always` AND the credential retained an envelope (resolved upstream).
      const oauthSecret = oauthCred ? (secrets?.oauthClientSecret ?? null) : null;
      enabledMethods.push({
        method: 'oauth_client',
        label: 'OAuth2 client credentials',
        entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
        entraFields: {
          tenantUrl: urls.scimBaseUrl,
          tokenEndpoint: urls.tokenEndpoint,
          clientIdentifier: clientId,
          clientSecret: oauthSecret,
        },
        clientSecretState: oauthCred ? 'set-shown-once' : 'create-required',
        credentialId: oauthCred?.id ?? null,
        secretRetained: !!oauthCred?.secretEnvelope,
        secretRevealed: oauthSecret !== null,
      });
    } else {
      disabledMethods.push({
        method: 'oauth_client',
        reason: `${ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED} is not set`,
        enableHint: `Set ${ENDPOINT_CONFIG_FLAGS.OAUTH_CLIENT_CREDENTIALS_AUTH_ENABLED}=True in endpoint Settings`,
      });
    }

    // ── wif (Workload Identity Federation) ────────────────────────────────
    if (wifEnabled) {
      const wifCred = activeCreds.find((c) => c.credentialType === 'wif');
      const audience =
        typeof wifCred?.metadata?.expectedAudience === 'string'
          ? wifCred.metadata.expectedAudience
          : endpointId;
      enabledMethods.push({
        method: 'wif',
        label: 'Workload Identity Federation',
        entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
        entraFields: {
          tenantUrl: urls.scimBaseUrl,
          tokenEndpoint: urls.tokenEndpoint,
        },
        clientSecretState: 'none',
        expectedAudience: audience,
      });
    } else {
      disabledMethods.push({
        method: 'wif',
        reason: `${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED} is not set`,
        enableHint: `Set ${ENDPOINT_CONFIG_FLAGS.WIF_CREDENTIALS_ENABLED}=True in endpoint Settings`,
      });
    }

    return {
      endpointId,
      displayName: endpoint.displayName ?? endpoint.name,
      urls,
      enabledMethods,
      disabledMethods,
    };
  }
}
