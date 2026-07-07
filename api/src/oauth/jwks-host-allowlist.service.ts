import { Injectable, Inject, Optional, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScimLogger } from '../modules/logging/scim-logger.service';
import { LogCategory } from '../modules/logging/log-levels';
import { JWKS_HOST_ALLOWLIST_REPOSITORY } from '../domain/repositories/repository.tokens';
import type { IJwksHostAllowlistRepository } from '../domain/repositories/jwks-host-allowlist.repository.interface';

/**
 * JwksHostAllowlistService (WI-15) - the single source of truth for the
 * effective JWKS host allowlist consulted by BOTH the runtime JWKS validator
 * and the config-time discovery resolver.
 *
 * The effective allowlist is the UNION of three layers:
 *   1. a COMPILED seed of well-known IdP hosts (so common IdPs work out of the box);
 *   2. the `JWKS_HOST_ALLOWLIST` env var (deploy-time additions);
 *   3. a PERSISTED, admin-editable-at-runtime layer (add a host without a redeploy).
 *
 * Design choice (operator, 2026-07-06): this is a convenience/runtime-flexibility
 * feature - there is NO deny-list and NO lock flag. The existing https +
 * exact-host-match validation is retained by the callers; this service only
 * decides membership. Server-global, never per-endpoint.
 *
 * The union is held in an in-memory Set for O(1) synchronous membership checks
 * on the hot auth path. The persisted layer is loaded once at startup and the
 * Set is hot-reloaded whenever a host is added/removed via the admin API - so a
 * newly-added host is honored immediately, no restart.
 */

/** Compiled seed of well-known IdP JWKS hosts (lowercased, exact-match). */
export const WELL_KNOWN_JWKS_HOST_SEED: ReadonlyArray<string> = [
  'login.microsoftonline.com', // Entra commercial
  'login.microsoftonline.us', // Entra US Gov
  'login.chinacloudapi.cn', // Entra China (21Vianet)
  'login.partner.microsoftonline.cn', // Entra China alt
  'www.googleapis.com', // Google
  'accounts.google.com', // Google OIDC
];

export interface JwksAllowlistView {
  seed: string[];
  env: string[];
  persisted: string[];
  effective: string[];
}

@Injectable()
export class JwksHostAllowlistService implements OnModuleInit {
  private readonly seed: ReadonlySet<string>;
  private readonly env: ReadonlySet<string>;
  /** The live union used for membership checks (seed ∪ env ∪ persisted). */
  private effective: Set<string>;
  /** Just the persisted layer, mirrored in memory for hot-reload + the view. */
  private persisted = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly logger: ScimLogger,
    @Optional() @Inject(JWKS_HOST_ALLOWLIST_REPOSITORY)
    private readonly repo?: IJwksHostAllowlistRepository,
  ) {
    this.seed = new Set(WELL_KNOWN_JWKS_HOST_SEED.map((h) => h.toLowerCase()));
    const raw = this.config.get<string>('JWKS_HOST_ALLOWLIST') ?? '';
    this.env = new Set(raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
    this.effective = new Set([...this.seed, ...this.env]);
  }

  /** Load the persisted layer into the effective union at startup. */
  async onModuleInit(): Promise<void> {
    if (!this.repo) return;
    try {
      const rows = await this.repo.findAll();
      this.persisted = new Set(rows.map((r) => r.host.toLowerCase()));
      this.rebuild();
      this.logger.info(LogCategory.AUTH, 'JWKS host allowlist loaded', {
        seed: this.seed.size,
        env: this.env.size,
        persisted: this.persisted.size,
      });
    } catch (err) {
      // Fail open to the seed+env union - a DB outage must not brick auth.
      this.logger.warn(LogCategory.AUTH, 'JWKS host allowlist persisted-layer load failed (using seed+env)', {
        error: (err as Error).message,
      });
    }
  }

  /** Synchronous O(1) membership check on the effective union (hot path). */
  isAllowed(host: string): boolean {
    return this.effective.has(host.trim().toLowerCase());
  }

  /** The three layers + the effective union, for the admin view. */
  view(): JwksAllowlistView {
    return {
      seed: [...this.seed].sort(),
      env: [...this.env].sort(),
      persisted: [...this.persisted].sort(),
      effective: [...this.effective].sort(),
    };
  }

  /**
   * Add a host to the persisted layer and hot-reload the union. Idempotent.
   * Adding a host already covered by the seed/env is a persisted no-op but
   * still succeeds (the effective union is unchanged).
   */
  async addHost(host: string, label: string | null = null): Promise<JwksAllowlistView> {
    const normalized = host.trim().toLowerCase();
    if (!this.repo) {
      throw new Error('JWKS host allowlist persistence is not available.');
    }
    await this.repo.add(normalized, label);
    this.persisted.add(normalized);
    this.rebuild();
    this.logger.info(LogCategory.AUTH, 'JWKS host added to allowlist (runtime)', { host: normalized });
    return this.view();
  }

  /**
   * Remove a host from the persisted layer and hot-reload. A seed/env host
   * cannot be removed (it is not in the persisted layer) - the call succeeds
   * but the effective union still contains it. Returns whether a persisted row
   * was actually removed.
   */
  async removeHost(host: string): Promise<{ removed: boolean; view: JwksAllowlistView }> {
    const normalized = host.trim().toLowerCase();
    if (!this.repo) {
      throw new Error('JWKS host allowlist persistence is not available.');
    }
    const removed = await this.repo.removeByHost(normalized);
    this.persisted.delete(normalized);
    this.rebuild();
    if (removed) {
      this.logger.info(LogCategory.AUTH, 'JWKS host removed from allowlist (runtime)', { host: normalized });
    }
    return { removed, view: this.view() };
  }

  /** Recompute the effective union from the three layers. */
  private rebuild(): void {
    this.effective = new Set([...this.seed, ...this.env, ...this.persisted]);
  }
}
