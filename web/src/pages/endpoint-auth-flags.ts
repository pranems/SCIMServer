/**
 * The "Authentication methods" endpoint flags, in ONE place.
 *
 * Four flags represent real methods. `key` stays a literal here so the registry-to-UI
 * coverage check (U-T1) still finds every flag by its declared control.
 *
 * The server registry in api/src/modules/endpoint/endpoint-config.interface.ts
 * remains the source of truth for defaults and bounds; this file only describes
 * how they are PRESENTED.
 */
import type { ConnectionMethod } from '@scim/types/connection-info.types';

export interface AuthMethodFlag {
  key: string;
  method: ConnectionMethod;
  label: string;
  description: string;
  defaultValue: boolean;
  /** Short operator-facing name for the compact Connect-tab control. */
  shortLabel: string;
}

export const AUTH_METHOD_FLAGS: ReadonlyArray<AuthMethodFlag> = [
  {
    key: 'OAuthClientCredentialsAuthEnabled',
    method: 'oauth_client',
    label: 'OAuthClientCredentialsAuthEnabled',
    shortLabel: 'OAuth2 client credentials',
    description:
      'Accept a per-endpoint OAuth client credential for client-credentials token acquisition.',
    defaultValue: false,
  },
  {
    key: 'WifCredentialsEnabled',
    method: 'wif',
    label: 'WifCredentialsEnabled',
    shortLabel: 'Federated identity (WIF)',
    description:
      'Accept federated-identity (WIF, RFC 7523 jwt-bearer) credentials and advertise the WIF authentication scheme.',
    defaultValue: false,
  },
  {
    key: 'SharedSecretBearerAuthEnabled',
    method: 'shared_secret',
    label: 'SharedSecretBearerAuthEnabled',
    shortLabel: 'Global shared secret',
    description:
      'Allow this endpoint to accept the global SCIM shared secret. Turn this off to require endpoint-specific credentials.',
    defaultValue: true,
  },
  {
    key: 'SecretTokenBearerAuthEnabled',
    method: 'bearer',
    label: 'SecretTokenBearerAuthEnabled',
    shortLabel: 'Bearer (Entra "Secret Token")',
    description:
      'Accept a per-endpoint bearer token, including the Secret Token method used by Microsoft Entra.',
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
