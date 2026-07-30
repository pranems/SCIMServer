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

export interface JwksAllowlistPersistedEntry {
  id: string;
  host: string;
  label: string | null;
}

export interface JwksAllowlistView {
  seed: string[];
  env: string[];
  persisted: string[];
  effective: string[];
  /**
   * R1 - the persisted rows with their id + label, so the admin UI can edit or
   * remove a specific entry by id. `persisted` (the bare host strings) is kept
   * for backward compatibility.
   */
  persistedEntries: JwksAllowlistPersistedEntry[];
}

@Injectable()
export class JwksHostAllowlistService implements OnModuleInit {
  private readonly seed: ReadonlySet<string>;
  private readonly env: ReadonlySet<string>;
  /** The live union used for membership checks (seed ∪ env ∪ persisted). */
  private effective: Set<string>;
  /** Just the persisted layer, mirrored in memory for hot-reload + the view. */
  private persisted = new Set<string>();
  /** R1 - the persisted rows (id + host + label) for the admin edit/remove UI. */
  private persistedEntries: JwksAllowlistPersistedEntry[] = [];

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
      // R1 - prepopulate the well-known IdP seed into the persisted table so
      // the seed hosts appear as editable/removable rows in the admin UI.
      // Idempotent: repo.add is a no-op if the host already exists.
      await this.ensureSeeded();
      const rows = await this.repo.findAll();
      this.persistedEntries = rows.map((r) => ({ id: r.id, host: r.host.toLowerCase(), label: r.label }));
      this.persisted = new Set(this.persistedEntries.map((e) => e.host));
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

  /**
   * R1 - ensure every compiled well-known seed host exists as a persisted row.
   * Runs once at startup; idempotent. The compiled seed also remains a
   * permanent effective-union safety floor (a persisted seed row can be edited
   * or removed, but the compiled seed keeps well-known IdPs reachable so an
   * accidental removal cannot brick Entra/Google auth).
   */
  private async ensureSeeded(): Promise<void> {
    if (!this.repo) return;
    const existing = await this.repo.findAll();
    const have = new Set(existing.map((r) => r.host.toLowerCase()));
    for (const host of WELL_KNOWN_JWKS_HOST_SEED) {
      const normalized = host.toLowerCase();
      if (!have.has(normalized)) {
        // Per-host try/catch: a concurrent init (multiple app instances against
        // the same DB) can race the unique-host insert. The compiled seed is a
        // permanent safety floor, so a failed persist of one seed row must not
        // abort seeding the rest or the whole persisted-layer load.
        try {
          await this.repo.add(normalized, 'well-known IdP (seed)');
        } catch {
          // ignore - another instance won the race, or a transient DB error;
          // the host is covered by the compiled floor regardless.
        }
      }
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
      persistedEntries: [...this.persistedEntries].sort((a, b) => a.host.localeCompare(b.host)),
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
    await this.reloadPersisted();
    this.logger.info(LogCategory.AUTH, 'JWKS host added to allowlist (runtime)', { host: normalized });
    return this.view();
  }

  /**
   * R1 - update a persisted entry by id (change its host and/or label) and
   * hot-reload the union. Returns null via the boolean when no such row exists.
   */
  async updateHost(id: string, host: string, label: string | null = null): Promise<{ updated: boolean; view: JwksAllowlistView }> {
    const normalized = host.trim().toLowerCase();
    if (!this.repo) {
      throw new Error('JWKS host allowlist persistence is not available.');
    }
    const row = await this.repo.update(id, normalized, label);
    await this.reloadPersisted();
    if (row) {
      this.logger.info(LogCategory.AUTH, 'JWKS host updated in allowlist (runtime)', { id, host: normalized });
    }
    return { updated: row != null, view: this.view() };
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
    await this.reloadPersisted();
    if (removed) {
      this.logger.info(LogCategory.AUTH, 'JWKS host removed from allowlist (runtime)', { host: normalized });
    }
    return { removed, view: this.view() };
  }

  /**
   * R1 - selectively add and/or remove hosts in a single call (PATCH). `add`
   * hosts are appended to the persisted layer (idempotent); `remove` hosts are
   * deleted from it. Both lists are normalized + validated as bare hostnames
   * by the caller. Returns the count actually added/removed + the fresh view.
   * The union is hot-reloaded once at the end.
   */
  async patchHosts(
    add: string[] = [],
    remove: string[] = [],
  ): Promise<{ added: number; removed: number; view: JwksAllowlistView }> {
    if (!this.repo) {
      throw new Error('JWKS host allowlist persistence is not available.');
    }
    let added = 0;
    let removed = 0;
    for (const host of add) {
      const normalized = host.trim().toLowerCase();
      if (normalized === '') continue;
      const before = this.persisted.has(normalized);
      await this.repo.add(normalized, null);
      if (!before) added += 1;
    }
    for (const host of remove) {
      const normalized = host.trim().toLowerCase();
      if (normalized === '') continue;
      const didRemove = await this.repo.removeByHost(normalized);
      if (didRemove) removed += 1;
    }
    await this.reloadPersisted();
    this.logger.info(LogCategory.AUTH, 'JWKS host allowlist patched (runtime)', { added, removed });
    return { added, removed, view: this.view() };
  }

  /** Reload the persisted layer from the repo and rebuild the union. */
  private async reloadPersisted(): Promise<void> {
    if (!this.repo) return;
    const rows = await this.repo.findAll();
    this.persistedEntries = rows.map((r) => ({ id: r.id, host: r.host.toLowerCase(), label: r.label }));
    this.persisted = new Set(this.persistedEntries.map((e) => e.host));
    this.rebuild();
  }

  /** Recompute the effective union from the three layers. */
  private rebuild(): void {
    this.effective = new Set([...this.seed, ...this.env, ...this.persisted]);
  }
}
