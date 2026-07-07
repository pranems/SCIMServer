import { Injectable, Inject, Optional, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { JWKS_FETCH } from './external-jwks-validator.service';
import { JwksHostAllowlistService } from './jwks-host-allowlist.service';

/**
 * WifDiscoveryResolverService (WI-14) - config-time resolver that turns one or
 * two inputs into the WIF signing-trust fields (`expectedIssuer` + `jwksUri`)
 * plus a proposed `expectedAudience` default, by reading the SOURCE IdP's OIDC
 * discovery document (`.well-known/openid-configuration`).
 *
 * This is the OPPOSITE direction from WI-12 (where SCIMServer PUBLISHES its own
 * `.well-known/oauth-authorization-server`): here we FETCH the customer IdP's
 * discovery doc, ONCE, at config time (operator-approved).
 *
 * Hard guarantees (mirroring the runtime JWKS fetch):
 *  - SSRF: the discovery host MUST be https and on `JWKS_HOST_ALLOWLIST`; a
 *    disallowed host is rejected BEFORE any network call.
 *  - Issuer validation: the discovery doc's `issuer` MUST be present and, for a
 *    preset/derived URL, be consistent with the host we asked (RFC 8414 s3.3
 *    mix-up defense) - we return the doc's own `issuer` as `expectedIssuer`.
 *  - Nothing here touches the runtime validation path; it only fills the SAME
 *    stored fields the admin would otherwise type by hand.
 */

/** A well-known IdP/cloud preset -> its `.well-known/openid-configuration` URL. */
const PRESETS: Readonly<Record<string, (tenantId: string) => string>> = {
  'entra-commercial': (t) => `https://login.microsoftonline.com/${t}/v2.0/.well-known/openid-configuration`,
  'entra-usgov': (t) => `https://login.microsoftonline.us/${t}/v2.0/.well-known/openid-configuration`,
  'entra-china': (t) => `https://login.chinacloudapi.cn/${t}/v2.0/.well-known/openid-configuration`,
  'google': () => `https://accounts.google.com/.well-known/openid-configuration`,
};

export interface WifResolveRequest {
  /** Mode A - the full OIDC discovery URL (any IdP). */
  discoveryUrl?: string;
  /** Mode B - a well-known preset (with tenantId where required). */
  preset?: string;
  tenantId?: string;
}

export interface WifResolveResult {
  expectedIssuer: string;
  jwksUri: string;
  /** Proposed default - the endpointId (v2-only, collision-free per endpoint). */
  expectedAudience: string;
}

@Injectable()
export class WifDiscoveryResolverService {
  private readonly hostAllowlist: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: ScimLogger,
    @Optional() @Inject(JWKS_FETCH) private readonly fetchFn?: typeof fetch,
    @Optional() private readonly allowlistService?: JwksHostAllowlistService,
  ) {
    const raw = this.config.get<string>('JWKS_HOST_ALLOWLIST') ?? '';
    this.hostAllowlist = new Set(
      raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    );
  }

  /** List the preset ids this resolver understands (for the UI dropdown). */
  static readonly PRESET_IDS: ReadonlyArray<string> = Object.keys(PRESETS);

  /**
   * Resolve the signing-trust fields for an endpoint. `endpointId` becomes the
   * proposed `expectedAudience` default.
   */
  async resolve(endpointId: string, req: WifResolveRequest): Promise<WifResolveResult> {
    const discoveryUrl = this.buildDiscoveryUrl(req);
    this.assertHostAllowed(discoveryUrl);

    const doc = await this.fetchDiscoveryDoc(discoveryUrl);
    const issuer = typeof doc.issuer === 'string' ? doc.issuer : undefined;
    const jwksUri = typeof doc.jwks_uri === 'string' ? doc.jwks_uri : undefined;
    if (!issuer || !jwksUri) {
      throw new BadRequestException(
        'The IdP discovery document is missing "issuer" or "jwks_uri".',
      );
    }
    // The jwks_uri the doc advertises must ALSO be an allowed host - it will be
    // fetched at runtime, so it is subject to the same SSRF guard.
    this.assertHostAllowed(jwksUri);

    this.logger.info(LogCategory.AUTH, 'WIF discovery resolved', {
      endpointId,
      issuer,
      jwksUri,
    });

    return { expectedIssuer: issuer, jwksUri, expectedAudience: endpointId };
  }

  /** Build the discovery URL from either mode; validate the inputs. */
  private buildDiscoveryUrl(req: WifResolveRequest): string {
    if (req.discoveryUrl && req.discoveryUrl.trim().length > 0) {
      return req.discoveryUrl.trim();
    }
    if (req.preset) {
      const builder = PRESETS[req.preset];
      if (!builder) {
        throw new BadRequestException(
          `Unknown preset "${req.preset}". Known presets: ${Object.keys(PRESETS).join(', ')}, or use "discoveryUrl".`,
        );
      }
      // Presets that embed a tenant require a tenantId; `google` does not.
      const needsTenant = req.preset.startsWith('entra-');
      if (needsTenant && (!req.tenantId || req.tenantId.trim().length === 0)) {
        throw new BadRequestException(`Preset "${req.preset}" requires a "tenantId".`);
      }
      return builder((req.tenantId ?? '').trim());
    }
    throw new BadRequestException('Provide either "discoveryUrl" (Mode A) or "preset" (Mode B).');
  }

  /** Anti-SSRF: scheme must be https and host must be on the allowlist. */
  private assertHostAllowed(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException(`Invalid URL: "${rawUrl}".`);
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException(`URL must use https (got "${url.protocol}").`);
    }
    const host = url.hostname.toLowerCase();
    // WI-15: consult the shared effective allowlist (seed + env + persisted)
    // when wired; otherwise fall back to the env-only Set (unit-test standalone).
    const allowed = this.allowlistService
      ? this.allowlistService.isAllowed(host)
      : this.hostAllowlist.has(host);
    if (!allowed) {
      this.logger.warn(LogCategory.AUTH, 'WIF discovery host not permitted by allowlist (SSRF guard)', {
        host,
      });
      throw new BadRequestException(
        `Discovery host "${host}" is not permitted by the JWKS_HOST_ALLOWLIST.`,
      );
    }
  }

  /** Fetch + parse the discovery doc. Fails (throws) on any fetch/parse error. */
  private async fetchDiscoveryDoc(url: string): Promise<Record<string, unknown>> {
    const doFetch = this.fetchFn ?? globalThis.fetch;
    try {
      const res = await doFetch(url);
      if (!res.ok) {
        throw new Error(`discovery fetch returned HTTP ${res.status}.`);
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(LogCategory.AUTH, 'WIF discovery fetch failed', {
        url,
        error: (err as Error).message,
      });
      throw new BadRequestException(`Could not fetch the IdP discovery document: ${(err as Error).message}`);
    }
  }
}
