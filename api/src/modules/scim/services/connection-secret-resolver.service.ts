/**
 * ConnectionSecretResolverService - resolves the ACTUAL secret values that a
 * connection surface may inline WHEN the effective `CredentialSecretVisibility`
 * is `always` (operator opt-in). This is the single place that gates + decrypts
 * every secret shown on the Connect tab / connection-info / server settings, so
 * the "show secrets when always" policy is enforced identically everywhere.
 *
 * Policy (most-restrictive-wins, server is the ceiling):
 *  - Per-endpoint `bearer` / `oauth_client` secrets are inlined ONLY when the
 *    endpoint's EFFECTIVE visibility is `always` AND the credential kept an
 *    encrypted envelope (i.e. it was created under `always`). Decryption goes
 *    through the same `CredentialEncryptionService` the reveal endpoint uses.
 *  - The global `shared_secret` (SCIM_SHARED_SECRET) + the global OAuth client
 *    secret are SERVER-scope; they are inlined ONLY when the SERVER visibility
 *    is `always`. These are env-configured (not envelope-encrypted), so they
 *    are read straight from config.
 *
 * When visibility is `once` (or an envelope is missing / undecryptable), the
 * corresponding value resolves to `null` and the surface falls back to the
 * "shown once at creation - rotate to view" behavior. Nothing here ever throws
 * on a decrypt failure; it degrades to `null`.
 *
 * Every inlined secret is a deliberate, admin-only, audit-logged disclosure -
 * the caller logs the disclosure at `LogCategory.AUTH`.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialSecurityService } from '../../../security/credential-security.service';
import { CredentialEncryptionService } from '../../../security/credential-encryption.service';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import type { EndpointCredentialModel } from '../../../domain/models/endpoint-credential.model';

/** The resolved secret values a connection surface may inline (each null when withheld). */
export interface ResolvedConnectionSecrets {
  /** The global SCIM_SHARED_SECRET, when SERVER visibility is `always`. */
  sharedSecret: string | null;
  /** The per-endpoint bearer token, when EFFECTIVE visibility is `always` + retained. */
  bearerToken: string | null;
  /** The per-endpoint oauth_client secret, when EFFECTIVE visibility is `always` + retained. */
  oauthClientSecret: string | null;
  /** Whether ANY per-endpoint secret was inlined (for the caller's audit line). */
  anyEndpointSecretRevealed: boolean;
}

/** The global (server-scope) secrets, when SERVER visibility is `always`. */
export interface ResolvedServerSecrets {
  /** The global SCIM_SHARED_SECRET (Entra "Secret Token"). */
  sharedSecret: string | null;
  /** The global OAuth client id (public; the token-endpoint client_id). */
  oauthClientId: string | null;
  /** The global OAuth client secret (the token-endpoint client_secret). */
  oauthClientSecret: string | null;
  /** True when the server visibility was `always` so secrets are present. */
  revealed: boolean;
}

@Injectable()
export class ConnectionSecretResolverService {
  constructor(
    private readonly credentialSecurity: CredentialSecurityService,
    private readonly credentialEncryption: CredentialEncryptionService,
    private readonly config: ConfigService,
  ) {}

  /** The global SCIM shared secret (Entra "Secret Token"), or null when unset. */
  private globalSharedSecret(): string | null {
    const v = this.config.get<string>('SCIM_SHARED_SECRET') ?? process.env.SCIM_SHARED_SECRET;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /** The global OAuth client id used by the global token endpoint. */
  private globalOauthClientId(): string | null {
    const v = this.config.get<string>('OAUTH_CLIENT_ID') ?? process.env.OAUTH_CLIENT_ID;
    return typeof v === 'string' && v.length > 0 ? v : 'scimserver-client';
  }

  /** The global OAuth client secret used by the global token endpoint. */
  private globalOauthClientSecret(): string | null {
    const v = this.config.get<string>('OAUTH_CLIENT_SECRET') ?? process.env.OAUTH_CLIENT_SECRET;
    return typeof v === 'string' && v.length > 0 ? v : null;
  }

  /** Safely decrypt a retained envelope; null on any failure (never throws). */
  private tryDecrypt(envelope: string | null | undefined): string | null {
    if (!envelope || !this.credentialEncryption.isReady()) return null;
    try {
      return this.credentialEncryption.decrypt(envelope);
    } catch {
      return null;
    }
  }

  /**
   * Resolve the secrets a per-endpoint connection surface may inline. Gated on
   * the endpoint's effective visibility (bearer/oauth) + the server visibility
   * (shared_secret). Returns all-null when `once`.
   */
  async resolveForEndpoint(
    config: EndpointConfig | undefined,
    credentials: EndpointCredentialModel[],
  ): Promise<ResolvedConnectionSecrets> {
    const serverVisibility = await this.credentialSecurity.getServerVisibility();
    const effective = await this.credentialSecurity.getEffectiveVisibility(config);

    const active = credentials.filter((c) => c.active);
    const bearerCred = active.find((c) => c.credentialType === 'bearer');
    const oauthCred = active.find((c) => c.credentialType === 'oauth_client');

    const bearerToken =
      effective === 'always' ? this.tryDecrypt(bearerCred?.secretEnvelope) : null;
    const oauthClientSecret =
      effective === 'always' ? this.tryDecrypt(oauthCred?.secretEnvelope) : null;
    // The shared secret is server-global, so it follows the SERVER visibility.
    const sharedSecret = serverVisibility === 'always' ? this.globalSharedSecret() : null;

    return {
      sharedSecret,
      bearerToken,
      oauthClientSecret,
      anyEndpointSecretRevealed: bearerToken !== null || oauthClientSecret !== null,
    };
  }

  /**
   * Resolve the server-scope global secrets, inlined only when the SERVER
   * visibility is `always`. All null (revealed:false) otherwise.
   */
  async resolveServerSecrets(): Promise<ResolvedServerSecrets> {
    const serverVisibility = await this.credentialSecurity.getServerVisibility();
    if (serverVisibility !== 'always') {
      return { sharedSecret: null, oauthClientId: null, oauthClientSecret: null, revealed: false };
    }
    return {
      sharedSecret: this.globalSharedSecret(),
      oauthClientId: this.globalOauthClientId(),
      oauthClientSecret: this.globalOauthClientSecret(),
      revealed: true,
    };
  }
}
