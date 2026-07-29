import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { resolveRuntimeConfig } from '../../bootstrap/runtime-config';
import { toStorableRequestId } from './storable-request-id';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '../../generated/prisma/client';
import { randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { ScimLogger, getCorrelationContext } from './scim-logger.service';
import { capStoredBodyString } from './request-body-capture';
import { LogCategory } from './log-levels';
import { redactSensitiveDeep, REDACTED } from '../../security/redact-sensitive';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { getEffectivePersistRequestSecrets } from '../endpoint/endpoint-config.interface';

export interface CreateRequestLogOptions {
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestHeaders: Record<string, unknown>;
  requestBody?: unknown;
  responseHeaders?: Record<string, unknown>;
  responseBody?: unknown;
  error?: unknown;
  /** SCIM endpoint ID extracted from URL (persisted for indexed endpoint-scoped queries) */
  endpointId?: string;
  /** P3 - the X-Request-Id correlation id, bridges a log row to its AuthDecisionTrace. */
  requestId?: string;
}

@Injectable()
export class LoggingService implements OnModuleDestroy, OnModuleInit {
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';

  // ── Auto-prune configuration ──
  private autoPruneRetentionDays: number = Number(process.env.LOG_RETENTION_DAYS) || 21;
  private autoPruneIntervalMs: number = Number(process.env.LOG_PRUNE_INTERVAL_MS) || 60 * 60 * 1000; // default: 1 hour
  private autoPruneTimer: ReturnType<typeof setInterval> | null = null;
  private autoPruneEnabled: boolean = (process.env.LOG_AUTO_PRUNE ?? 'true').toLowerCase() !== 'false';

  // ── Buffered logging for performance ──
  // Buffering trades real-time logging (up to 3s data loss on crash) for reduced
  // database write overhead. Single batch insert instead of N individual writes.
  // Originally introduced to mitigate SQLite single-writer contention; retained
  // for PostgreSQL to reduce connection pool pressure.
  private logBuffer: Prisma.RequestLogCreateManyInput[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInProgress = false;
  /**
   * W1.7b - buffering is a throughput/durability tradeoff that moves with the
   * deployment: a busy production replica wants a SHORTER interval (bounding
   * crash-loss) with a LARGER batch (fewer round-trips and less pool pressure)
   * than a developer laptop. `LOG_FLUSH_INTERVAL_MS` / `LOG_FLUSH_MAX_BUFFER`,
   * clamped; the previous hardcoded 3000 ms / 50 remain the defaults.
   */
  private readonly flushIntervalMs: number;
  private readonly flushMaxBuffer: number;
  private inMemoryLogRows: Array<{
    id: string;
    method: string;
    url: string;
    endpointId: string | null;
    status: number | null;
    durationMs: number | null;
    createdAt: Date;
    requestHeaders: string | null;
    requestBody: string | null;
    responseHeaders: string | null;
    responseBody: string | null;
    errorMessage: string | null;
    errorStack: string | null;
    identifier: string | null;
    requestId: string | null;
    authOutcome: string | null;
    authMethod: string | null;
    authReason: string | null;
    authCredentialId: string | null;
    authDecision: string | null;
  }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: ScimLogger,
    private readonly moduleRef: ModuleRef,
  ) {
    const log = resolveRuntimeConfig((k) => process.env[k]).groups.logging;
    this.flushIntervalMs = log.flushIntervalMs.effective as number;
    this.flushMaxBuffer = log.flushMaxBuffer.effective as number;
  }

  /**
   * The server-level default for PersistRequestSecrets (env, default true). When
   * true the RequestLog keeps the complete request/response (secrets included);
   * an endpoint may override it per-endpoint via the `PersistRequestSecrets`
   * config flag.
   */
  private readonly persistRequestSecretsServerDefault =
    (process.env.PERSIST_REQUEST_SECRETS ?? 'true').toLowerCase() !== 'false';

  /** Lazily-resolved EndpointService (cycle-safe via ModuleRef; cached). */
  private endpointServiceRef?: EndpointService | null;

  /**
   * Resolve the EFFECTIVE PersistRequestSecrets for a request: the endpoint's
   * explicit config flag OVERRIDES the server-level default; an endpoint that
   * leaves it unset (or a global/unknown route) inherits the server default.
   * Cache-only endpoint read (no async/DB) so this stays cheap on the log path;
   * a cache miss falls back to the server default.
   */
  private resolvePersistSecrets(endpointId?: string): boolean {
    if (!endpointId) return this.persistRequestSecretsServerDefault;
    if (this.endpointServiceRef === undefined) {
      try {
        this.endpointServiceRef = this.moduleRef.get(EndpointService, { strict: false });
      } catch {
        this.endpointServiceRef = null;
      }
    }
    const settings = this.endpointServiceRef?.getCachedProfileSettings(endpointId);
    return getEffectivePersistRequestSecrets(settings, this.persistRequestSecretsServerDefault);
  }

  // ── Auto-prune lifecycle ──

  // eslint-disable-next-line @typescript-eslint/require-await -- NestJS OnModuleInit signature requires Promise<void>
  async onModuleInit(): Promise<void> {
    if (this.autoPruneEnabled && !this.isInMemoryBackend) {
      this.logger.info(LogCategory.DATABASE, `Auto-prune enabled: retention=${this.autoPruneRetentionDays}d, interval=${this.autoPruneIntervalMs}ms`);
      // Run initial prune after a short delay (don't block startup)
      setTimeout(() => void this.runAutoPrune(), 5_000);
      // Schedule recurring prune
      this.autoPruneTimer = setInterval(() => void this.runAutoPrune(), this.autoPruneIntervalMs);
    }
  }

  private async runAutoPrune(): Promise<void> {
    try {
      const pruned = await this.pruneOldLogs(this.autoPruneRetentionDays);
      if (pruned > 0) {
        this.logger.info(LogCategory.DATABASE, `Auto-pruned ${pruned} log entries (retention: ${this.autoPruneRetentionDays}d)`);
      }
    } catch (err) {
      this.logger.error(LogCategory.DATABASE, `Auto-prune failed: ${(err as Error).message}`);
    }
  }

  /** Get current auto-prune configuration */
  getAutoPruneConfig() {
    return {
      enabled: this.autoPruneEnabled,
      retentionDays: this.autoPruneRetentionDays,
      intervalMs: this.autoPruneIntervalMs,
    };
  }

  /** Update auto-prune configuration at runtime */
  setAutoPruneConfig(config: { retentionDays?: number; intervalMs?: number; enabled?: boolean }): void {
    if (config.retentionDays !== undefined && config.retentionDays > 0) {
      this.autoPruneRetentionDays = config.retentionDays;
    }
    if (config.intervalMs !== undefined && config.intervalMs >= 60_000) {
      this.autoPruneIntervalMs = config.intervalMs;
    }
    if (config.enabled !== undefined) {
      this.autoPruneEnabled = config.enabled;
    }

    // Restart the timer with new interval
    if (this.autoPruneTimer) {
      clearInterval(this.autoPruneTimer);
      this.autoPruneTimer = null;
    }
    if (this.autoPruneEnabled && !this.isInMemoryBackend) {
      this.autoPruneTimer = setInterval(() => void this.runAutoPrune(), this.autoPruneIntervalMs);
    }

    this.logger.info(LogCategory.CONFIG, `Auto-prune config updated: enabled=${this.autoPruneEnabled}, retention=${this.autoPruneRetentionDays}d, interval=${this.autoPruneIntervalMs}ms`);
  }

  /**
   * Buffer a request log entry. The entry is written to the DB asynchronously
   * in batches to reduce per-request database write overhead.
   *
   * Successful GETs to the health endpoint are dropped without ever entering
   * the buffer: they are pure liveness/readiness pings (k8s, Container Apps
   * health probe, uptime monitors), produce no diagnostic value, and at
   * default Container Apps probe cadence accumulate ~12k rows/day per replica.
   * Failed health checks (status >= 400 or thrown error) ARE still recorded
   * because they are exactly the cases an operator wants to see.
   */
  recordRequest({
    method,
    url,
    status,
    durationMs,
    requestHeaders,
    requestBody,
    responseHeaders,
    responseBody,
    error,
    endpointId,
    requestId,
  }: CreateRequestLogOptions): void {
    // Skip successful health probes - see method-level docstring.
    // Matches: GET /health, /scim/health (with optional trailing slash or
    // sub-path) when status is in [200, 400) and there is no error.
    if (
      method === 'GET' &&
      !error &&
      typeof status === 'number' && status >= 200 && status < 400 &&
      /^\/(?:scim\/)?health(?:\/|$|\?)/.test(url)
    ) {
      return;
    }

    // F1 - request-log privacy. By DEFAULT the RequestLog keeps the complete
    // request/response (headers + body, secrets included) for fast RCA. When the
    // effective PersistRequestSecrets flag is OFF (server env or per-endpoint
    // override), secret-bearing header/body values are redacted BEFORE the row is
    // persisted, so they never reach the DB or the API/UI. Identifier derivation
    // still runs on the raw payload (userName/displayName/externalId are not
    // secrets). Console/file structured logs are always redacted separately.
    const persistSecrets = this.resolvePersistSecrets(endpointId);
    const storedRequestHeaders = persistSecrets ? requestHeaders : redactSensitiveDeep(requestHeaders);
    let storedRequestBody = persistSecrets ? requestBody : redactSensitiveDeep(requestBody);
    const storedResponseHeaders = persistSecrets ? responseHeaders : redactSensitiveDeep(responseHeaders);
    const storedResponseBody = persistSecrets ? responseBody : redactSensitiveDeep(responseBody);
    // When secrets are not persisted, mask the free-text raw preview of an
    // unparseable body - key-based redaction cannot reach a blob's contents.
    if (
      !persistSecrets &&
      storedRequestBody &&
      typeof storedRequestBody === 'object' &&
      (storedRequestBody as Record<string, unknown>)._rawPreview !== undefined
    ) {
      storedRequestBody = { ...(storedRequestBody as Record<string, unknown>), _rawPreview: REDACTED };
    }

    // V10 - the auth decision for this request is stamped onto the correlation
    // context by emitAuthDecisionEvent / the guard earlier in the same async
    // chain. Persist it on the row so the logs list shows the auth outcome
    // instantly (no second per-row Auth-Decision-Record lookup needed).
    const authCtx = getCorrelationContext();
    const authOutcome = authCtx?.authOutcome ?? null;
    const authMethod = authCtx?.authMethod ?? null;
    const authReason = authCtx?.authReason ?? null;
    const authCredentialId = authCtx?.authCredentialId ?? null;
    // W1 - the full redacted AuthDecisionTrace (JSON), so the detail renders the
    // diff permanently. Capped like any stored body.
    const authDecision = capStoredBodyString(authCtx?.authDecision) ?? null;

    if (this.isInMemoryBackend) {
      const errorMessage = this.extractErrorMessage(error);
      const errorStack = this.extractErrorStack(error);
      let identifier: string | undefined;
      try {
        const idCandidate = this.deriveReportableIdentifier(url, requestBody, responseBody) ||
          (/\/scim\/Groups/i.test(url) ? this.deriveGroupDisplayName(
            this.normalizeObject(requestBody) ?? null,
            this.normalizeObject(responseBody) ?? null
          ) : undefined) || this.deriveIdentifierFromUrl(url);
        if (idCandidate && typeof idCandidate === 'string') identifier = idCandidate;
      } catch (e) {
        this.logger.debug(LogCategory.DATABASE, 'Identifier derivation failed (inmemory)', { url, error: (e as Error).message });
      }

      this.inMemoryLogRows.push({
        id: randomUUID(),
        method,
        url,
        endpointId: endpointId ?? null,
        status: status ?? null,
        durationMs: durationMs ?? null,
        createdAt: new Date(),
        requestHeaders: this.stringifyValue(storedRequestHeaders) ?? '{}',
        requestBody: capStoredBodyString(this.stringifyValue(storedRequestBody)) ?? null,
        responseHeaders: this.stringifyValue(storedResponseHeaders),
        responseBody: capStoredBodyString(this.stringifyValue(storedResponseBody)) ?? null,
        errorMessage,
        errorStack,
        identifier: identifier ?? null,
        requestId: toStorableRequestId(requestId),
        authOutcome,
        authMethod,
        authReason,
        authCredentialId,
        authDecision,
      });
      return;
    }

    const errorMessage = this.extractErrorMessage(error);
    const errorStack = this.extractErrorStack(error);
    // Compute identifier once (cheap vs later bulk parsing). Works for Users (userName/email/externalId) & Groups (displayName)
    let identifier: string | undefined;
    try {
      const idCandidate = this.deriveReportableIdentifier(url, requestBody, responseBody) ||
        (/\/scim\/Groups/i.test(url) ? this.deriveGroupDisplayName(
          this.normalizeObject(requestBody) ?? null,
          this.normalizeObject(responseBody) ?? null
        ) : undefined) || this.deriveIdentifierFromUrl(url);
      if (idCandidate && typeof idCandidate === 'string') identifier = idCandidate;
    } catch (e) {
      this.logger.debug(LogCategory.DATABASE, 'Identifier derivation failed', { url, error: (e as Error).message });
    }

    const data: Prisma.RequestLogCreateManyInput = {
      method,
      url,
      status: status ?? null,
      durationMs: durationMs ?? null,
      requestHeaders: this.stringifyValue(storedRequestHeaders) ?? '{}',
      requestBody: capStoredBodyString(this.stringifyValue(storedRequestBody)),
      responseHeaders: this.stringifyValue(storedResponseHeaders),
      responseBody: capStoredBodyString(this.stringifyValue(storedResponseBody)),
      errorMessage,
      errorStack,
      // Include the derived identifier INLINE so the flush is a single batch
      // insert (no per-row UPDATE backfill). `identifier` is a real column.
      identifier: identifier ?? null,
      endpointId: endpointId ?? null,
      requestId: toStorableRequestId(requestId),
      authOutcome,
      authMethod,
      authReason,
      authCredentialId,
      authDecision,
    };

    this.logBuffer.push(data);

    // Flush immediately if buffer is full, otherwise schedule a delayed flush
    if (this.logBuffer.length >= this.flushMaxBuffer) {
      void this.flushLogs();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushLogs(), this.flushIntervalMs);
    }
  }

  /**
   * Flush the accumulated log buffer to PostgreSQL in ONE batch insert.
   *
   * The identifier is included inline in each row (see `recordRequest`), so the
   * flush is a single `createMany` with no per-identifier `UPDATE` backfill. The
   * old backfill (SELECT most-recent-N + N sequential UPDATEs) was the root cause
   * of flush-backlog under sustained load on a latency-bound node - each flush
   * did N+1 round-trips, so request volume outran flush throughput and rows sat
   * un-persisted in the buffer. It was also fragile (createdAt-desc correlation
   * could misassign identifiers when inserts interleaved). One batch insert is
   * both faster and correct.
   */
  async flushLogs(): Promise<void> {
    if (this.isInMemoryBackend) {
      return;
    }

    if (this.flushInProgress || this.logBuffer.length === 0) return;
    this.flushInProgress = true;

    // Drain the buffer atomically
    const batch = this.logBuffer.splice(0);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      // Single batch insert (identifier included inline - no UPDATE backfill).
      await this.prisma.requestLog.createMany({ data: batch });
    } catch (persistError) {
      this.logger.error(LogCategory.DATABASE, 'Failed to flush request log batch', persistError as Error);
    } finally {
      this.flushInProgress = false;
    }
  }

  /**
   * Force ALL currently-buffered entries to the database, awaiting any in-flight
   * flush first.
   *
   * `flushLogs()` deliberately no-ops while a prior flush is in progress (so the
   * 3s timer never double-flushes), which means a bare `flushLogs()` call is NOT
   * a reliable "drain now" under sustained load - a background flush is usually
   * running, so the call returns having drained nothing. `flushPending` spins
   * until the buffer is empty AND no flush is in flight (bounded by a deadline),
   * so on return every entry buffered before the call is durable + queryable.
   * This is what the admin force-flush endpoint uses so a just-produced row is
   * immediately readable (operators chasing a fresh row; tests reading back a
   * row they just created). No-op on the in-memory backend (writes are sync).
   */
  async flushPending(timeoutMs = 10_000): Promise<void> {
    if (this.isInMemoryBackend) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.flushInProgress) {
        // A flush is writing; wait for it to release, then re-check the buffer
        // (entries can arrive during the write).
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }
      if (this.logBuffer.length === 0) return; // drained + nothing in flight
      await this.flushLogs();
    }
  }

  /** Flush remaining log entries and stop timers on application shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.autoPruneTimer) {
      clearInterval(this.autoPruneTimer);
      this.autoPruneTimer = null;
    }
    await this.flushLogs();
  }

  async clearLogs(): Promise<number> {
    if (this.isInMemoryBackend) {
      const count = this.inMemoryLogRows.length;
      this.inMemoryLogRows = [];
      return count;
    }

    const result = await this.prisma.requestLog.deleteMany();
    return result.count;
  }

  /** Delete log entries older than the given number of days. */
  async pruneOldLogs(retentionDays: number): Promise<number> {
    if (this.isInMemoryBackend) {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const before = this.inMemoryLogRows.length;
      this.inMemoryLogRows = this.inMemoryLogRows.filter(r => r.createdAt >= cutoff);
      return before - this.inMemoryLogRows.length;
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.requestLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    this.logger.info(LogCategory.DATABASE, `Pruned ${result.count} log entries older than ${retentionDays} days`);
    return result.count;
  }

  async listLogs(filters: {
    page?: number;
    pageSize?: number;
    method?: string;
    status?: number;
    hasError?: boolean;
    urlContains?: string;
    since?: Date;
    until?: Date;
    search?: string;
    includeAdmin?: boolean;
    hideKeepalive?: boolean;
    minDurationMs?: number;
    /** Filter by indexed endpointId column (preferred over urlContains) */
    endpointId?: string;
    /** P3 - filter by the X-Request-Id correlation id (auth-decision bridge). */
    requestId?: string;
  } = {}) {
    if (this.isInMemoryBackend) {
      const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
      const page = Math.max(filters.page ?? 1, 1);
      const skip = (page - 1) * pageSize;
      let filtered = [...this.inMemoryLogRows];
      // Phase D4 in-memory parity fix: previously only endpointId was
      // applied here, so callers passing minDurationMs / since / until /
      // method / status / urlContains / hasError got back the full set
      // (and tests asserting empty results failed). Mirror the Prisma
      // branch's filter set 1:1.
      if (filters.endpointId) {
        filtered = filtered.filter((r) => r.endpointId === filters.endpointId);
      }
      if (filters.requestId) {
        filtered = filtered.filter((r) => r.requestId === filters.requestId);
      }
      if (filters.method) {
        const m = filters.method.toUpperCase();
        filtered = filtered.filter((r) => r.method === m);
      }
      if (typeof filters.status === 'number') {
        filtered = filtered.filter((r) => r.status === filters.status);
      }
      if (filters.hasError === true) {
        filtered = filtered.filter((r) => r.errorMessage !== null && r.errorMessage !== undefined);
      } else if (filters.hasError === false) {
        filtered = filtered.filter((r) => r.errorMessage === null || r.errorMessage === undefined);
      }
      if (filters.urlContains) {
        const needle = filters.urlContains;
        filtered = filtered.filter((r) => r.url.includes(needle));
      }
      if (filters.since) {
        const since = filters.since;
        filtered = filtered.filter((r) => r.createdAt >= since);
      }
      if (filters.until) {
        const until = filters.until;
        filtered = filtered.filter((r) => r.createdAt <= until);
      }
      if (filters.minDurationMs !== undefined && filters.minDurationMs > 0) {
        const min = filters.minDurationMs;
        filtered = filtered.filter((r) => (r.durationMs ?? 0) >= min);
      }
      if (!filters.includeAdmin) {
        filtered = filtered.filter(
          (r) => !r.url.includes('/scim/admin/') && r.url !== '/' && r.url !== '/health',
        );
      }
      if (filters.search) {
        const s = filters.search;
        filtered = filtered.filter(
          (r) =>
            r.url.includes(s) ||
            (r.errorMessage ?? '').includes(s) ||
            (r.requestHeaders ?? '').includes(s) ||
            (r.responseHeaders ?? '').includes(s) ||
            (r.requestBody ?? '').includes(s) ||
            (r.responseBody ?? '').includes(s),
        );
      }
      const records = filtered
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(skip, skip + pageSize);

      const items = records.map((r) => ({
        id: r.id,
        method: r.method,
        url: r.url,
        status: r.status ?? undefined,
        durationMs: r.durationMs ?? undefined,
        createdAt: r.createdAt,
        errorMessage: r.errorMessage ?? undefined,
        reportableIdentifier: r.identifier ?? this.deriveIdentifierFromUrl(r.url),
        requestId: r.requestId ?? undefined,
        endpointId: r.endpointId ?? undefined,
        authOutcome: r.authOutcome ?? undefined,
        authMethod: r.authMethod ?? undefined,
        authReason: r.authReason ?? undefined,
        authCredentialId: r.authCredentialId ?? undefined,
      }));

      const total = filtered.length;
      return {
        total,
        page,
        pageSize,
        count: items.length,
        hasNext: skip + items.length < total,
        hasPrev: page > 1,
        items,
      };
    }

    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);

  const where: Prisma.RequestLogWhereInput = {};
    if (filters.endpointId) where.endpointId = filters.endpointId;
    if (filters.requestId) {
      // requestId is a `@db.Uuid` column: a non-UUID value makes Postgres throw
      // on the cast (previously surfaced as a 500). A non-UUID can never match a
      // UUID column, so return an empty set instead (parity with the in-memory
      // string-equality branch), using the nil UUID as a guaranteed-no-match.
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(filters.requestId);
      where.requestId = isUuid ? filters.requestId : '00000000-0000-0000-0000-000000000000';
    }
    if (filters.method) where.method = filters.method.toUpperCase();
    if (typeof filters.status === 'number') where.status = filters.status;
    if (filters.hasError === true) where.errorMessage = { not: null };
    if (filters.hasError === false) where.errorMessage = null;
    if (filters.urlContains) where.url = { contains: filters.urlContains };

    // By default, exclude admin endpoints and non-SCIM traffic to focus on SCIM provisioning
    if (!filters.includeAdmin) {
      const nonScimFilters = [
        { url: { not: { contains: '/scim/admin/' } } },
        { url: { not: { equals: '/' } } },
        { url: { not: { equals: '/health' } } }
      ];

      if (Array.isArray(where.AND)) {
        where.AND.push(...nonScimFilters);
      } else if (where.AND) {
        where.AND = [where.AND, ...nonScimFilters];
      } else {
        where.AND = nonScimFilters;
      }
    }

    // Add keepalive filtering if requested
    // Keepalive requests are: GET /Users with no identifier and status < 400 and filter param with userName eq UUID
    // To exclude them: method != GET OR url not contains /Users OR identifier not null OR status >= 400 OR no filter param
    if (filters.hideKeepalive) {
      const keepaliveExclusionFilters: any = {
        OR: [
          { method: { not: 'GET' } },                           // Not a GET request
          { NOT: { url: { contains: '/Users' } } },             // Not a Users endpoint
          { identifier: { not: null } },                        // Has an identifier
          { status: { gte: 400 } },                             // Error status
          { NOT: { url: { contains: '?filter=' } } },           // No filter parameter
        ]
      };

      if (Array.isArray(where.AND)) {
        where.AND.push(keepaliveExclusionFilters);
      } else if (where.AND) {
        where.AND = [where.AND, keepaliveExclusionFilters];
      } else {
        where.AND = [keepaliveExclusionFilters];
      }
    }

    if (filters.since || filters.until) {
      where.createdAt = {};
      if (filters.since) where.createdAt.gte = filters.since;
      if (filters.until) where.createdAt.lte = filters.until;
    }
    if (filters.minDurationMs !== undefined && filters.minDurationMs > 0) {
      where.durationMs = { gte: filters.minDurationMs };
    }
    if (filters.search) {
      const s = filters.search;
      // Expand search to additional large text columns (stored as JSON strings)
      // Using mode: 'insensitive' when supported (ignored silently if not by connector)
      const textSearch: Prisma.RequestLogWhereInput[] = [
        { url: { contains: s } },
        { errorMessage: { contains: s } },
        { requestHeaders: { contains: s } },
        { responseHeaders: { contains: s } },
        { requestBody: { contains: s } },
        { responseBody: { contains: s } }
      ];
      // Merge with existing OR if already set (unlikely at this point, but safe)
      if (where.OR) {
        where.OR = [...where.OR, ...textSearch];
      } else {
        where.OR = textSearch;
      }
    }

    const skip = (page - 1) * pageSize;

    // Defensive: ensure no invalid Date objects slip through
    const isInvalidDate = (d: unknown): d is Date => d instanceof Date && isNaN(d.getTime());
    if (isInvalidDate(filters.since) || isInvalidDate(filters.until)) {
      const sinceStr = filters.since ? String(filters.since) : 'undefined';
      const untilStr = filters.until ? String(filters.until) : 'undefined';
      this.logger.warn(LogCategory.DATABASE, `Ignoring invalid date filter(s): since='${sinceStr}' until='${untilStr}'`);
      if (where.createdAt && Object.keys(where.createdAt as object).length === 0) {
        delete where.createdAt; // remove empty date filter
      }
    }

    let total = 0;
    type RequestLogRow = {
      id: string;
      method: string;
      url: string;
      status: number | null;
      durationMs: number | null;
      createdAt: Date;
      errorMessage: string | null;
      requestId: string | null;
      endpointId: string | null;
      authOutcome: string | null;
      authMethod: string | null;
      authReason: string | null;
      authCredentialId: string | null;
    };
    let records: RequestLogRow[] = [];
    try {
      [total, records] = await Promise.all([
        this.prisma.requestLog.count({ where }),
        this.prisma.requestLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          // Limit fields to mitigate potential large string conversion issues
          select: {
            id: true,
            method: true,
            url: true,
            status: true,
            durationMs: true,
            createdAt: true,
            errorMessage: true,
            requestId: true,
            endpointId: true,
            authOutcome: true,
            authMethod: true,
            authReason: true,
            authCredentialId: true
          }
        })
      ]);
    } catch (err) {
      this.logger.error(
        LogCategory.DATABASE,
        'requestLog.findMany failed',
        err as Error,
        { where: JSON.stringify(where), page, pageSize },
      );
      throw err; // rethrow for controller to handle
    }

    // Try to pull identifiers in one raw query (ignore if column not present)
  const identifierMap: Record<string, string | null> = {};
    try {
      const ids = records.map(r => `'${r.id}'`).join(',');
      if (ids.length) {
        // Unsafe raw only over internal generated IDs (cuid) - controlled
        const rows: Array<{ id: string; identifier: string | null }> = await this.prisma.$queryRawUnsafe(
          `SELECT "id", "identifier" FROM "RequestLog" WHERE "id" IN (${ids})`
        );
        for (const row of rows) identifierMap[row.id] = row.identifier;
      }
    } catch (e) {
      // Best-effort: identifier backfill column may not exist in early migrations
      this.logger.debug(LogCategory.DATABASE, 'Identifier backfill query failed', {
        error: (e as Error).message,
        recordCount: records.length,
      });
    }

    // Map records with async user resolution
    const items = await Promise.all(
      records.map((r) => this.mapLog(r, identifierMap))
    );

    return {
      total,
      page,
      pageSize,
      count: records.length,
      hasNext: skip + records.length < total,
      hasPrev: page > 1,
      items
    };
  }

  private async mapLog(r: {
    id: string;
    method: string;
    url: string;
    status: number | null;
    durationMs: number | null;
    createdAt: Date;
    errorMessage: string | null;
    requestId?: string | null;
    endpointId?: string | null;
    authOutcome?: string | null;
    authMethod?: string | null;
    authReason?: string | null;
    authCredentialId?: string | null;
  }, identifierMap?: Record<string, string | null>) {
    let identifier = identifierMap?.[r.id] || this.deriveIdentifierFromUrl(r.url);

    // Resolve user display names for better readability
    if (identifier && r.url.includes('/Users') && !identifier.includes('@')) {
      // If this looks like a user ID or userName, try to resolve to display name
      const resolvedName = await this.resolveUserDisplayName(identifier);
      if (resolvedName) {
        identifier = resolvedName;
      }
    }

    return {
      id: r.id,
      method: r.method,
      url: r.url,
      status: r.status ?? undefined,
      durationMs: r.durationMs ?? undefined,
      createdAt: r.createdAt,
      errorMessage: r.errorMessage ?? undefined,
      reportableIdentifier: identifier,
      requestId: r.requestId ?? undefined,
      endpointId: r.endpointId ?? undefined,
      authOutcome: r.authOutcome ?? undefined,
      authMethod: r.authMethod ?? undefined,
      authReason: r.authReason ?? undefined,
      authCredentialId: r.authCredentialId ?? undefined
    };
  }

  /**
   * Phase D4 - Hourly request count series for dashboard charts.
   *
   * Returns an array of length `hours` containing per-hour request counts
   * for the last `hours` hours. `result[0]` is the OLDEST hour (i.e.
   * `hours-1` complete hours back from the current bucket boundary).
   * `result[hours-1]` is the CURRENT hour (the bucket containing now).
   *
   * Buckets are aligned to hour boundaries via:
   *   currentBucketStart = floor(now / bucketMs) * bucketMs
   *   oldestBucketStart  = currentBucketStart - (hours - 1) * bucketMs
   * So the chart axis is stable (same buckets reappear if you call twice
   * within the same minute) and the current hour is ALWAYS at index
   * `hours - 1` regardless of the current minute.
   *
   * Filters applied (matches the default `listLogs` filters when
   * `includeAdmin: false`):
   *   - excludes `/scim/admin/*` (admin API)
   *   - excludes `/` and `/health` (root + health probes)
   *
   * Performance: indexed range scan on `createdAt`, returns `select { createdAt: true }`
   * only. For a busy 100 req/min server this is ~144k rows in 24h - still
   * sub-100ms with the default index. If this becomes a hot path we can
   * push the bucketing to SQL via $queryRaw + date_trunc.
   *
   * @param opts.hours number of hours in the series (default 24, clamped 1..168)
   * @returns number[] of length `hours`, oldest first
   */
  async getRequestSeries(opts: { hours?: number } = {}): Promise<number[]> {
    const hours = Math.min(Math.max(opts.hours ?? 24, 1), 168);
    const now = Date.now();
    const bucketMs = 60 * 60 * 1000;
    // Bucket alignment: result[hours-1] must be the CURRENT hour bucket.
    // The current bucket starts at floor(now/bucketMs)*bucketMs. To put it
    // at index hours-1, the oldest visible bucket starts (hours-1) buckets
    // earlier. With this layout, any row where
    //   bucketStart <= row.createdAt < bucketStart + bucketMs
    // lands at index in [0, hours-1].
    const currentBucketStart = Math.floor(now / bucketMs) * bucketMs;
    const oldestBucketStart = currentBucketStart - (hours - 1) * bucketMs;
    const series = new Array<number>(hours).fill(0);

    const tally = (createdAt: Date): void => {
      const t = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
      if (!Number.isFinite(t)) return;
      const idx = Math.floor((t - oldestBucketStart) / bucketMs);
      if (idx >= 0 && idx < hours) series[idx] += 1;
    };

    const cutoff = new Date(oldestBucketStart);

    if (this.isInMemoryBackend) {
      for (const row of this.inMemoryLogRows) {
        if (row.createdAt < cutoff) continue;
        // Mirror listLogs default exclusions (includeAdmin: false)
        if (row.url.includes('/scim/admin/')) continue;
        if (row.url === '/' || row.url === '/health') continue;
        tally(row.createdAt);
      }
      return series;
    }

    // Postgres: indexed range scan, project createdAt only.
    try {
      const rows = await this.prisma.requestLog.findMany({
        where: {
          createdAt: { gte: cutoff },
          AND: [
            { url: { not: { contains: '/scim/admin/' } } },
            { url: { not: { equals: '/' } } },
            { url: { not: { equals: '/health' } } },
          ],
        },
        select: { createdAt: true },
      });
      for (const r of rows) tally(r.createdAt);
    } catch (err) {
      this.logger.error(
        LogCategory.DATABASE,
        `getRequestSeries failed: ${(err as Error).message} - returning zero series`,
      );
      // Fall through with zeros - dashboard chart shows flat line, not 500.
    }

    return series;
  }

  async getLog(id: string) {
    if (this.isInMemoryBackend) {
      const row = this.inMemoryLogRows.find((r) => r.id === id);
      if (!row) return null;
      const parsedRequest = this.safeParse(row.requestBody ? String(row.requestBody) : null);
      const parsedResponse = this.safeParse(row.responseBody ? String(row.responseBody) : null);
      const rid =
        row.identifier ||
        this.deriveReportableIdentifier(row.url, parsedRequest, parsedResponse) ||
        this.deriveGroupDisplayName(
          parsedRequest as Record<string, unknown> | null,
          parsedResponse as Record<string, unknown> | null,
        ) ||
        this.deriveIdentifierFromUrl(row.url);

      return {
        id: row.id,
        endpointId: row.endpointId ?? undefined,
        method: row.method,
        url: row.url,
        status: row.status ?? undefined,
        durationMs: row.durationMs ?? undefined,
        createdAt: row.createdAt,
        requestHeaders: this.safeParse(row.requestHeaders ? String(row.requestHeaders) : null),
        requestBody: parsedRequest,
        responseHeaders: this.safeParse(row.responseHeaders ? String(row.responseHeaders) : null),
        responseBody: parsedResponse,
        errorMessage: row.errorMessage ?? undefined,
        reportableIdentifier: rid,
        requestId: row.requestId ?? undefined,
        authOutcome: row.authOutcome ?? undefined,
        authMethod: row.authMethod ?? undefined,
        authReason: row.authReason ?? undefined,
        authCredentialId: row.authCredentialId ?? undefined,
        authDecision: row.authDecision ? this.safeParse(String(row.authDecision)) : undefined,
      };
    }

    const row = await this.prisma.requestLog.findUnique({ where: { id } });
    if (!row) return null;
    // Parse bodies once for identifier + returned payload
    const parsedRequest = this.safeParse(row.requestBody ? String(row.requestBody) : null);
    const parsedResponse = this.safeParse(row.responseBody ? String(row.responseBody) : null);
    const rid =
      this.deriveReportableIdentifier(row.url, parsedRequest, parsedResponse) ||
      this.deriveGroupDisplayName(
        parsedRequest as Record<string, unknown> | null,
        parsedResponse as Record<string, unknown> | null
      ) ||
      this.deriveIdentifierFromUrl(row.url);
    return {
      id: row.id,
      endpointId: row.endpointId ?? undefined,
      method: row.method,
      url: row.url,
      status: row.status ?? undefined,
      durationMs: row.durationMs ?? undefined,
      createdAt: row.createdAt,
      requestHeaders: this.safeParse(row.requestHeaders ? String(row.requestHeaders) : null),
      requestBody: parsedRequest,
      responseHeaders: this.safeParse(row.responseHeaders ? String(row.responseHeaders) : null),
      responseBody: parsedResponse,
      errorMessage: row.errorMessage ?? undefined,
      reportableIdentifier: rid,
      requestId: row.requestId ?? undefined,
      authOutcome: row.authOutcome ?? undefined,
      authMethod: row.authMethod ?? undefined,
      authReason: row.authReason ?? undefined,
      authCredentialId: row.authCredentialId ?? undefined,
      authDecision: row.authDecision ? this.safeParse(String(row.authDecision)) : undefined,
    };
  }

  private deriveReportableIdentifier(url: string, requestBody: unknown, responseBody: unknown): string | undefined {
    try {
      // If this is a SCIM User create/update, prefer response id or userName
      const isUserEndpoint = /\/scim\/Users/i.test(url) || /\/Users/i.test(url);
      if (!isUserEndpoint) return undefined;
      const rb = this.normalizeObject(requestBody);
      const resp = this.normalizeObject(responseBody);

      const extractEmail = (o?: Record<string, unknown>): string | undefined => {
        if (!o) return undefined;
        const raw = o['emails'];
        if (Array.isArray(raw)) {
          interface EmailEntry { value?: unknown; primary?: unknown; }
          const isEmailEntry = (e: unknown): e is EmailEntry => !!e && typeof e === 'object';
          const primary = raw.find((e) => isEmailEntry(e) && e.primary && typeof e.value === 'string');
          if (primary && typeof primary.value === 'string' && primary.value.trim()) return primary.value.trim();
          const first = raw.find((e) => isEmailEntry(e) && typeof e.value === 'string');
          if (first && typeof first.value === 'string' && first.value.trim()) return first.value.trim();
        }
        return undefined;
      };

      const candidates: (unknown)[] = [
        resp?.userName,
        extractEmail(resp),
        rb?.userName,
        extractEmail(rb),
        resp?.externalId,
        rb?.externalId,
        // fallbacks last: ids
        resp?.id,
        rb?.id
      ];

      for (const c of candidates) {
        if (typeof c === 'string') {
          const trimmed = c.trim();
          if (trimmed) return trimmed;
        }
      }
      return undefined;
    } catch {
      this.logger.trace(LogCategory.DATABASE, 'deriveReportableIdentifier failed - returning undefined');
      return undefined;
    }
  }

  private deriveIdentifierFromUrl(url: string): string | undefined {
    // Attempt to pull last UUID-like or alphanumeric segment for context
    const parts = url.split('?')[0].split('/').filter(Boolean);
    if (parts.length === 0) return undefined;
    const last = parts[parts.length - 1];
    if (/^[0-9a-fA-F-]{8,}$/.test(last)) return last;
    return undefined;
  }

  /**
   * Resolve user identifier to display name for better readability
   */
  private async resolveUserDisplayName(identifier: string): Promise<string | null> {
    try {
      // Try to find user by SCIM ID first
      let user = await this.prisma.scimResource.findFirst({
        where: { scimId: identifier, resourceType: 'User' },
        select: { userName: true, payload: true },
      });

      // If not found by SCIM ID, try by userName
      if (!user) {
        user = await this.prisma.scimResource.findFirst({
          where: { userName: identifier, resourceType: 'User' },
          select: { userName: true, payload: true },
        });
      }

      if (user) {
        // Try to get display name from raw payload first
        try {
          const payload = user.payload as Record<string, any> | null;
          if (payload) {
            if (payload.displayName) return payload.displayName;
            if (payload.name?.formatted) return payload.name.formatted;
            if (payload.name?.givenName && payload.name?.familyName) {
              return `${payload.name.givenName} ${payload.name.familyName}`;
            }
          }
        } catch (e) {
          this.logger.debug(LogCategory.DATABASE, 'Payload parsing failed in resolveUserDisplayName', { error: (e as Error).message });
        }
        return user.userName;
      }
    } catch (e) {
      this.logger.debug(LogCategory.DATABASE, 'User lookup failed in resolveUserDisplayName', { error: (e as Error).message });
    }
    return null;
  }

  private deriveGroupDisplayName(req: Record<string, unknown> | null, resp: Record<string, unknown> | null): string | undefined {
    const candidates: unknown[] = [
      resp && typeof resp === 'object' ? resp['displayName' as keyof typeof resp] : undefined,
      req && typeof req === 'object' ? req['displayName' as keyof typeof req] : undefined
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c;
    }
    return undefined;
  }

  // Removed persistent identifier logic; derivation now purely ephemeral.

  private normalizeObject(value: unknown): Record<string, unknown> | undefined {
    if (!value) return undefined;
    if (typeof value === 'object') return value as Record<string, unknown>;
    try {
      return JSON.parse(String(value));
    } catch { this.logger.trace(LogCategory.DATABASE, 'normalizeObject JSON.parse failed'); return undefined; }
  }

  private safeParse(value: string | null): unknown {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      this.logger.trace(LogCategory.DATABASE, 'safeParse JSON.parse failed');
      return undefined;
    }
  }

  private stringifyValue(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    try {
      return JSON.stringify(value);
    } catch (error) {
      this.logger.warn(LogCategory.DATABASE, 'Failed to stringify log value', { error: (error as Error).message });
      return null;
    }
  }

  private extractErrorMessage(error: unknown): string | null {
    if (!error) {
      return null;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return JSON.stringify(error);
  }

  private extractErrorStack(error: unknown): string | null {
    if (!error) {
      return null;
    }

    if (error instanceof Error) {
      return error.stack ?? null;
    }

    return null;
  }
}
