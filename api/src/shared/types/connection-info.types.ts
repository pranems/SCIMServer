/**
 * Connection-info types (WI-2 / WI-3) - shared between the API assembler
 * ([connection-info.service.ts](../../modules/scim/services/connection-info.service.ts)),
 * the per-endpoint Overview BFF ([dashboard.controller.ts](../../modules/dashboard/dashboard.controller.ts)),
 * and the web `ConnectionPanel` UI (via the `@scim/types` path alias).
 *
 * The shape is the authoritative connection-info contract documented in
 * docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md Part 6. NO secret value is ever
 * carried here (secrets remain one-time-at-create on the credential path).
 */

/** The four SCIM auth methods a connection can use. */
export type ConnectionMethod = 'shared_secret' | 'bearer' | 'oauth_client' | 'wif';

/** How the UI should present the method's secret. */
export type ClientSecretState =
  | 'set-shown-once' // a credential exists; its secret was shown once at create
  | 'create-required' // the method is enabled but no credential exists yet
  | 'none'; // the method has no per-endpoint secret to show (shared_secret, wif)

/** All absolute URLs for the endpoint. */
export interface ConnectionInfoUrls {
  /** Customer-facing SCIM base (LEADING /scim/v2 form). Entra's "Tenant URL". */
  scimBaseUrl: string;
  /** The bare rewrite target form, for reference. */
  scimBaseUrlBare: string;
  /** Per-endpoint OAuth token endpoint (bare form). */
  tokenEndpoint: string;
  /** ServiceProviderConfig discovery URL under the v2 base. */
  serviceProviderConfig: string;
  /** Per-endpoint RFC 8414 OAuth AS metadata (WI-12 append form). */
  oauthMetadata: string;
}

/** An enabled auth method + the Entra fields it maps to (no secrets). */
export interface ConnectionEnabledMethod {
  method: ConnectionMethod;
  label: string;
  entraAuthenticationMethod: 'Secret Token' | 'OAuth2 Client Credentials Grant';
  entraFields: Record<string, string | null>;
  clientSecretState: ClientSecretState;
  /** Present only for `wif`: the audience the source token must carry. */
  expectedAudience?: string;
  /**
   * The active per-endpoint credential id backing this method (bearer /
   * oauth_client), when one exists. The UI uses it to call the reveal
   * endpoint. Null for methods with no per-endpoint credential (shared_secret,
   * wif) or when no credential has been created yet.
   */
  credentialId?: string | null;
  /**
   * True when this method's credential kept an encrypted copy of its secret
   * (i.e. the effective `CredentialSecretVisibility` was `always` at create
   * time). The UI may then re-view the secret via the reveal endpoint. The
   * reveal endpoint remains the authority on whether the secret is actually
   * returned. Never the secret value itself.
   */
  secretRetained?: boolean;
  /**
   * True when the ACTUAL secret value is inlined in `entraFields` (secretToken
   * / clientSecret) because the effective `CredentialSecretVisibility` is
   * `always` (operator opt-in) and the secret was resolvable. When false, the
   * secret field is null and the surface shows the "shown once - rotate to
   * view" fallback. Every inline is an admin-only, audit-logged disclosure.
   */
  secretRevealed?: boolean;
}

/** A disabled auth method + why + how to enable it. */
export interface ConnectionDisabledMethod {
  method: ConnectionMethod;
  reason: string;
  enableHint: string;
}

/** The full connection-info response (Part 6 shape). */
export interface ConnectionInfo {
  endpointId: string;
  displayName: string;
  urls: ConnectionInfoUrls;
  enabledMethods: ConnectionEnabledMethod[];
  disabledMethods: ConnectionDisabledMethod[];
}
