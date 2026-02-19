import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

import { PrismaService } from '../prisma/prisma.service';

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
}

@Injectable()
export class LoggingService implements OnModuleDestroy {
  private readonly logger = new Logger(LoggingService.name);

  // ── Buffered logging to reduce SQLite write contention ──
  // SQLite compromise (CRITICAL): Per-request logging (2 writes each) competes for the
  // single SQLite writer lock with SCIM operations. Buffering trades real-time logging
  // (up to 3s data loss on crash) for reduced lock contention.
  // PostgreSQL migration: remove buffering, use direct create() per request.
  // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.2.2
  private logBuffer: Array<Prisma.RequestLogCreateInput & { _identifier?: string }> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInProgress = false;
  private static readonly FLUSH_INTERVAL_MS = 3_000;  // flush every 3 seconds
  private static readonly MAX_BUFFER_SIZE = 50;        // or when 50 entries accumulate

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Buffer a request log entry. The entry is written to the DB asynchronously
   * in batches to avoid per-request SQLite write-lock contention with SCIM
   * transactions.
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
    error
  }: CreateRequestLogOptions): void {
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
    } catch {/* swallow */}

    const data: Prisma.RequestLogCreateInput & { _identifier?: string } = {
      method,
      url,
      status: status ?? null,
      durationMs: durationMs ?? null,
      requestHeaders: this.stringifyValue(requestHeaders) ?? '{}',
      requestBody: this.stringifyValue(requestBody),
      responseHeaders: this.stringifyValue(responseHeaders),
      responseBody: this.stringifyValue(responseBody),
      errorMessage,
      errorStack,
      _identifier: identifier,
    };

    this.logBuffer.push(data);

    // Flush immediately if buffer is full, otherwise schedule a delayed flush
    if (this.logBuffer.length >= LoggingService.MAX_BUFFER_SIZE) {
      void this.flushLogs();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flushLogs(), LoggingService.FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Flush the accumulated log buffer to SQLite in a single batch.
   * Uses createMany for the bulk insert, then a single raw UPDATE for identifiers.
   */
  async flushLogs(): Promise<void> {
    if (this.flushInProgress || this.logBuffer.length === 0) return;
    this.flushInProgress = true;

    // Drain the buffer atomically
    const batch = this.logBuffer.splice(0);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Separate identifier metadata from Prisma create input
    const identifiers: Array<{ index: number; identifier: string }> = [];
    const createData: Prisma.RequestLogCreateManyInput[] = batch.map((entry, i) => {
      if (entry._identifier) {
        identifiers.push({ index: i, identifier: entry._identifier });
      }
      // Strip the non-Prisma field before passing to createMany
      const { _identifier, ...prismaData } = entry;
      return prismaData as Prisma.RequestLogCreateManyInput;
    });

    try {
      // Single batch insert (1 write instead of N*2 writes)
      await this.prisma.requestLog.createMany({ data: createData });

      // SQLite compromise: createMany doesn't support RETURNING in SQLite.
      // We fetch the most recent N rows by rowid to correlate batch-inserted records.
      // PostgreSQL migration: use createMany with RETURNING or createManyAndReturn().
      // See docs/SQLITE_COMPROMISE_ANALYSIS.md §3.4.2
      if (identifiers.length > 0) {
        // Fetch the last N created rows (ordered by rowid DESC) to correlate
        try {
          const recentRows: Array<{ id: string }> = await this.prisma.$queryRawUnsafe(
            `SELECT id FROM RequestLog ORDER BY rowid DESC LIMIT ${batch.length}`
          );
          // recentRows[0] = newest (last in batch), so reverse to align with batch order
          const ordered = [...recentRows].reverse();
          for (const { index, identifier } of identifiers) {
            if (ordered[index]) {
              await this.prisma.$executeRawUnsafe(
                'UPDATE RequestLog SET identifier = ? WHERE id = ?',
                identifier,
                ordered[index].id,
              );
            }
          }
        } catch {
          // Best-effort: identifier backfill is non-critical
        }
      }
    } catch (persistError) {
      this.logger.error('Failed to flush request log batch', persistError as Error);
    } finally {
      this.flushInProgress = false;
    }
  }

  /** Flush remaining log entries on application shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushLogs();
  }

  async clearLogs(): Promise<number> {
    const result = await this.prisma.requestLog.deleteMany();
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
  } = {}) {
    const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
    const page = Math.max(filters.page ?? 1, 1);

  const where: Prisma.RequestLogWhereInput = {};
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
      this.logger.warn(`Ignoring invalid date filter(s): since='${sinceStr}' until='${untilStr}'`);
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
            errorMessage: true
          }
        })
      ]);
    } catch (err) {
      this.logger.error(
        'requestLog.findMany failed',
        err as Error,
        JSON.stringify({ where, page, pageSize })
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
          `SELECT id, identifier FROM RequestLog WHERE id IN (${ids})`
        );
        for (const row of rows) identifierMap[row.id] = row.identifier;
      }
    } catch { /* column might not exist yet or query failed */ }

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
      reportableIdentifier: identifier
    };
  }

  async getLog(id: string) {
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
      reportableIdentifier: rid
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
      let user = await this.prisma.scimUser.findFirst({
        where: { scimId: identifier },
        select: { userName: true, rawPayload: true },
      });

      // If not found by SCIM ID, try by userName
      if (!user) {
        user = await this.prisma.scimUser.findFirst({
          where: { userName: identifier },
          select: { userName: true, rawPayload: true },
        });
      }

      if (user) {
        // Try to get display name from raw payload first
        try {
          if (user.rawPayload && typeof user.rawPayload === 'string') {
            const payload = JSON.parse(user.rawPayload);
            if (payload.displayName) return payload.displayName;
            if (payload.name?.formatted) return payload.name.formatted;
            if (payload.name?.givenName && payload.name?.familyName) {
              return `${payload.name.givenName} ${payload.name.familyName}`;
            }
          }
        } catch (e) {
          // Fall back to userName if payload parsing fails
        }
        return user.userName;
      }
    } catch (e) {
      // If lookup fails, return null to use original identifier
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
    } catch { return undefined; }
  }

  private safeParse(value: string | null): unknown {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
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
      this.logger.warn('Failed to stringify log value', error as Error);
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
