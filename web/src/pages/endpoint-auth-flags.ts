/**
 * The "Authentication methods" endpoint flags, in ONE place.
 *
 * Four flags represent real methods. The legacy umbrella remains a separate
 * compatibility definition so Settings can expose it without presenting it as
 * a fifth method on Connect. `key` stays a literal here so the registry-to-UI
 * coverage check (U-T1) still finds every flag by its declared control.
 *
 * The server registry in api/src/modules/endpoint/endpoint-config.interface.ts
 * remains the source of truth for defaults and bounds; this file only describes
 * how they are PRESENTED.
 */

export interface AuthMethodFlag {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
  /** Short operator-facing name for the compact Connect-tab control. */
  shortLabel: string;
}

export const AUTH_METHOD_FLAGS: ReadonlyArray<AuthMethodFlag> = [
  {
    key: 'OAuthClientCredentialsAuthEnabled',
    label: 'OAuthClientCredentialsAuthEnabled',
    shortLabel: 'OAuth2 client credentials',
    description:
      'WI-11: accept a per-endpoint oauth_client credential (Entra "OAuth2 client-credentials"). Falls back to the legacy PerEndpointCredentialsEnabled when unset.',
    defaultValue: false,
  },
  {
    key: 'WifCredentialsEnabled',
    label: 'WifCredentialsEnabled',
    shortLabel: 'Federated identity (WIF)',
    description:
      'Accept federated-identity (WIF, RFC 7523 jwt-bearer) credentials and advertise the WIF authentication scheme.',
    defaultValue: false,
  },
  {
    key: 'SharedSecretBearerAuthEnabled',
    label: 'SharedSecretBearerAuthEnabled',
    shortLabel: 'Global shared secret',
    description:
      'WI-11: whether this endpoint accepts the global SCIM shared secret. Turn OFF to make the endpoint accept only its own credentials. Defaults to on.',
    defaultValue: true,
  },
  {
    key: 'SecretTokenBearerAuthEnabled',
    label: 'SecretTokenBearerAuthEnabled',
    shortLabel: 'Bearer (Entra "Secret Token")',
    description:
      'WI-11: accept a per-endpoint bcrypt bearer token (Entra "Secret Token"). Falls back to the legacy PerEndpointCredentialsEnabled when unset.',
    defaultValue: false,
  },
];

export const LEGACY_AUTH_METHOD_FLAG: AuthMethodFlag = {
  key: 'PerEndpointCredentialsEnabled',
  label: 'PerEndpointCredentialsEnabled',
  shortLabel: 'Legacy per-endpoint credentials umbrella',
  description:
    'Compatibility fallback for endpoints created before bearer and OAuth2 received independent controls. It is not an authentication method.',
  defaultValue: false,
};

/** Resolve a flag's effective boolean from the endpoint's settings blob. */
export function effectiveAuthFlag(
  settings: Record<string, unknown> | undefined,
  flag: AuthMethodFlag,
): boolean {
  const raw = settings?.[flag.key];
  if (raw === undefined || raw === null || raw === '') return flag.defaultValue;
  if (typeof raw === 'boolean') return raw;
  return String(raw).toLowerCase() === 'true';
}
