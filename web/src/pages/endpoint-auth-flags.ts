/**
 * The "Authentication methods" endpoint flags, in ONE place.
 *
 * These five were declared privately inside SettingsTab, which was fine while
 * Settings was the only page that rendered them. The Connect tab now toggles
 * them inline too - an operator setting up an IdP connection should not have to
 * leave for Settings to turn the method on and then navigate back - and two
 * copies of a flag list is precisely the drift the endpoint-config-flag audit
 * exists to catch. `key` stays a literal here so the registry-to-UI coverage
 * check (U-T1) still finds every flag by its declared control.
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
    key: 'PerEndpointCredentialsEnabled',
    label: 'PerEndpointCredentialsEnabled',
    shortLabel: 'Per-endpoint credentials',
    description: "Validate the bearer token against this endpoint's credential set.",
    defaultValue: false,
  },
  {
    key: 'SecretTokenBearerAuthEnabled',
    label: 'SecretTokenBearerAuthEnabled',
    shortLabel: 'Bearer (Entra "Secret Token")',
    description:
      'WI-11: accept a per-endpoint bcrypt bearer token (Entra "Secret Token"). Falls back to the legacy PerEndpointCredentialsEnabled when unset.',
    defaultValue: false,
  },
  {
    key: 'OAuthClientCredentialsAuthEnabled',
    label: 'OAuthClientCredentialsAuthEnabled',
    shortLabel: 'OAuth2 client credentials',
    description:
      'WI-11: accept a per-endpoint oauth_client credential (Entra "OAuth2 client-credentials"). Falls back to the legacy PerEndpointCredentialsEnabled when unset.',
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
    key: 'WifCredentialsEnabled',
    label: 'WifCredentialsEnabled',
    shortLabel: 'Federated identity (WIF)',
    description:
      'Accept federated-identity (WIF, RFC 7523 jwt-bearer) credentials and advertise the WIF authentication scheme.',
    defaultValue: false,
  },
];

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
