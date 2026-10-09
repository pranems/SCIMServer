import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LoggingService } from '../logging/logging.service';
import { ActivityParserService, ActivitySummary } from './activity-parser.service';

@Controller('admin/activity')
export class ActivityController {
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityParser: ActivityParserService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  async getActivities(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('type') type?: string,
    @Query('severity') severity?: string,
    @Query('search') search?: string,
    @Query('hideKeepalive') hideKeepalive?: string,
    @Query('endpointId') endpointId?: string,
  ) {
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (this.isInMemoryBackend) {
      return this.getActivitiesInMemory(pageNum, limitNum, type, severity, search, hideKeepalive === 'true', endpointId);
    }

    const skip = (pageNum - 1) * limitNum;
    const shouldHideKeepalive = hideKeepalive === 'true';

    // Build where clause for filtering logs
    // Include both legacy (/scim/Users) and versioned (/scim/v2/Users) plus any SCIM base rewrite variants
    const baseConditions: any = {
      AND: [
        {
          OR: [
            { url: { contains: '/Users' } },
            { url: { contains: '/Groups' } },
            { url: { contains: '/endpoints/' } },
          ],
        },
        {
          NOT: { url: { contains: '/admin/' } }
        }
      ]
    };

    // Build WHERE clause with keepalive filtering if requested
    // Keepalive detection logic from isKeepaliveRequest:
    // - method === 'GET'
    // - url contains '/Users'
    // - identifier is null or empty
    // - status < 400
    // - filter contains 'userName eq <UUID>'
    //
    // To EXCLUDE keepalive (inverse logic), we need:
    // - method !== 'GET' OR
    // - url not contains '/Users' (but we need /Users for baseConditions, so this is complex) OR
    // - identifier is not null OR
    // - status >= 400 OR status is null OR
    // - no userName eq filter (URL parsing would be needed, omitted for now)
    //
    // Simplified approach: Exclude requests that match all of these conditions:
    // - method = 'GET' AND url contains '/Users' AND identifier IS NULL AND (status IS NULL OR status < 400)
    const keepaliveExclusionConditions: any = shouldHideKeepalive ? {
      OR: [
        { method: { not: 'GET' } },                      // Not a GET request
        { identifier: { not: null } },                   // Has an identifier
        { status: { gte: 400 } },                        // Error status
        { AND: [{ url: { contains: '/Users' } }, { NOT: { url: { contains: '?filter=' } } }] }, // /Users but no filter param
      ]
    } : undefined;

    let whereConditions: any[] = [...baseConditions.AND];

    // Add keepalive exclusion if requested
    if (keepaliveExclusionConditions) {
      whereConditions.push(keepaliveExclusionConditions);
    }

    // Add search conditions if present
    if (search) {
      whereConditions.push({
        OR: [
          { url: { contains: search } },
          { identifier: { contains: search } },
          { requestBody: { contains: search } },
          { responseBody: { contains: search } },
        ],
      });
    }

    // Phase D2: per-endpoint scoping. The Activity tab on
    // /endpoints/$id/activity needs server-side filtering by
    // endpointId; the indexed `endpointId` column was added in
    // Phase 17 for exactly this purpose. When the caller omits the
    // param, the existing global-activity behavior (used by the
    // legacy ActivityFeed component) is preserved.
    if (endpointId) {
      whereConditions.push({ endpointId });
    }

    if (type === 'user') {
      whereConditions.push({ url: { contains: '/Users' } });
    } else if (type === 'group') {
      whereConditions.push({ url: { contains: '/Groups' } });
    } else if (type === 'resource') {
      whereConditions.push({
        AND: [
          { url: { contains: '/endpoints/' } },
          {
            NOT: {
              OR: [
                { url: { contains: '/Users' } },
                { url: { contains: '/Groups' } },
                { url: { contains: '/Schemas' } },
                { url: { contains: '/ResourceTypes' } },
                { url: { contains: '/ServiceProviderConfig' } },
                { url: { contains: '/Bulk' } },
                { url: { contains: '/Me' } },
                { url: { contains: '/oauth/' } },
                { url: { contains: '/.well-known/' } },
              ],
            },
          },
        ],
      });
    }

    if (severity === 'error') {
      whereConditions.push({ status: { gte: 400 } });
    } else if (severity) {
      whereConditions.push({
        OR: [
          { status: { lt: 400 } },
          { status: null },
        ],
      });
    }

    const where: any = { AND: whereConditions };
    const requiresParsedPagination = type === 'system' || (severity !== undefined && severity !== 'error');
    const logSelect = {
      id: true,
      method: true,
      url: true,
      status: true,
      requestBody: true,
      responseBody: true,
      createdAt: true,
      identifier: true,
    } as const;

    // Fetch logs from database
    let logs: Array<{
      id: string;
      method: string;
      url: string;
      status: number | null;
      requestBody: string | null;
      responseBody: string | null;
      createdAt: Date;
      identifier: string | null;
    }>;
    let total: number;
    if (requiresParsedPagination) {
      const candidatePageSize = 200;
      logs = [];
      let candidateSkip = 0;
      while (true) {
        const batch = await this.prisma.requestLog.findMany({
          where,
          skip: candidateSkip,
          take: candidatePageSize,
          orderBy: { createdAt: 'desc' },
          select: logSelect,
        });
        logs.push(...batch);
        if (batch.length < candidatePageSize) break;
        candidateSkip += candidatePageSize;
      }
      total = 0;
    } else {
      [logs, total] = await Promise.all([
        this.prisma.requestLog.findMany({
          where,
          skip,
          take: limitNum,
          orderBy: { createdAt: 'desc' },
          select: logSelect,
        }),
        this.prisma.requestLog.count({ where }),
      ]);
    }

    // Parse each log into an activity summary
    // Parse each log into an activity summary.
    // Use allSettled to prevent one malformed log from crashing the entire page.
    const results = await Promise.allSettled(
      logs.map(async log =>
        await this.activityParser.parseActivity({
          id: log.id,
          method: log.method,
          url: log.url,
          status: log.status || undefined,
          requestBody: log.requestBody || undefined,
          responseBody: log.responseBody || undefined,
          createdAt: log.createdAt.toISOString(),
          identifier: log.identifier || undefined,
        })
      )
    );
    let activities: ActivitySummary[] = results
      .filter((r): r is PromiseFulfilledResult<ActivitySummary> => r.status === 'fulfilled')
      .map(r => r.value);

    // Apply client-side filters
    if (type) {
      activities = activities.filter(activity => activity.type === type);
    }

    if (severity) {
      activities = activities.filter(activity => activity.severity === severity);
    }

    const filteredTotal = requiresParsedPagination ? activities.length : total;
    if (requiresParsedPagination) {
      activities = activities.slice(skip, skip + limitNum);
    }

    return {
      activities,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredTotal,
        pages: Math.ceil(filteredTotal / limitNum),
      },
      filters: {
        types: ['user', 'group', 'resource', 'system'],
        severities: ['info', 'success', 'warning', 'error'],
      },
    };
  }

  @Get('summary')
  async getActivitySummary() {
    if (this.isInMemoryBackend) {
      // InMemory mode: return zeroed summary (no persistent request logs)
      return {
        summary: {
          last24Hours: 0,
          lastWeek: 0,
          operations: { users: 0, groups: 0 },
        },
      };
    }

    // Aggregate all four counters in one bounded scan. Four parallel count()
    // calls previously occupied four of the five pool connections for the
    // duration of the scans, starving unrelated UI reads under browser load.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [counts] = await this.prisma.$queryRaw<Array<{
      last24Hours: number;
      lastWeek: number;
      userOperations: number;
      groupOperations: number;
    }>>`
      SELECT
        COUNT(*) FILTER (
          WHERE "createdAt" >= ${oneDayAgo}
            AND NOT (
              "method" = 'GET'
              AND "url" LIKE '%/Users%'
              AND "identifier" IS NULL
              AND ("status" IS NULL OR "status" < 400)
              AND "url" LIKE '%?filter=%'
            )
        )::int AS "last24Hours",
        COUNT(*) FILTER (
          WHERE "createdAt" >= ${oneWeekAgo}
            AND NOT (
              "method" = 'GET'
              AND "url" LIKE '%/Users%'
              AND "identifier" IS NULL
              AND ("status" IS NULL OR "status" < 400)
              AND "url" LIKE '%?filter=%'
            )
        )::int AS "lastWeek",
        COUNT(*) FILTER (
          WHERE "url" LIKE '%/Users%'
            AND NOT (
              "method" = 'GET'
              AND "identifier" IS NULL
              AND ("status" IS NULL OR "status" < 400)
              AND "url" LIKE '%?filter=%'
            )
        )::int AS "userOperations",
        COUNT(*) FILTER (WHERE "url" LIKE '%/Groups%')::int AS "groupOperations"
      FROM "RequestLog"
      WHERE "createdAt" >= ${thirtyDaysAgo}
        AND "url" NOT LIKE '%/admin/%'
    `;
    const {
      last24Hours = 0,
      lastWeek = 0,
      userOperations = 0,
      groupOperations = 0,
    } = counts ?? {};

    return {
      summary: {
        last24Hours,
        lastWeek,
        operations: {
          users: userOperations,
          groups: groupOperations,
        },
      },
    };
  }

  // ─── InMemory fallback ──────────────────────────────────────────

  private async getActivitiesInMemory(
    page: number, limit: number,
    type?: string, severity?: string, search?: string, hideKeepalive?: boolean,
    endpointId?: string,
  ) {
    const listFilters = {
      urlContains: search || undefined,
      hideKeepalive,
      endpointId: endpointId || undefined,
    };
    const requiresParsedPagination = type !== undefined || severity !== undefined;
    let sourceTotal: number;
    let logs: any[];

    if (requiresParsedPagination) {
      const pageSize = 200;
      const first = await this.loggingService.listLogs({ ...listFilters, page: 1, pageSize });
      const pageCount = Math.ceil(first.total / pageSize);
      const remaining = pageCount > 1
        ? await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, index) =>
            this.loggingService.listLogs({ ...listFilters, page: index + 2, pageSize })
          )
        )
        : [];
      logs = [first, ...remaining].flatMap(result => result.items ?? []);
      sourceTotal = first.total;
    } else {
      const result = await this.loggingService.listLogs({ ...listFilters, page, pageSize: limit });
      logs = result.items ?? [];
      sourceTotal = result.total ?? logs.length;
    }

    let activities: ActivitySummary[] = await Promise.all(
      logs.map(async (log: any) =>
        await this.activityParser.parseActivity({
          id: log.id ?? `inmem-${Date.now()}-${Math.random()}`,
          method: log.method,
          url: log.url,
          status: log.status || undefined,
          requestBody: log.requestBody || undefined,
          responseBody: log.responseBody || undefined,
          createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : new Date().toISOString(),
          identifier: log.reportableIdentifier || undefined,
        })
      )
    );

    if (type) activities = activities.filter(a => a.type === type);
    if (severity) activities = activities.filter(a => a.severity === severity);
    const filteredTotal = requiresParsedPagination ? activities.length : sourceTotal;
    if (requiresParsedPagination) {
      const skip = (page - 1) * limit;
      activities = activities.slice(skip, skip + limit);
    }

    return {
      activities,
      pagination: {
        page,
        limit,
        total: filteredTotal,
        pages: Math.ceil(filteredTotal / limit),
      },
      filters: {
        types: ['user', 'group', 'resource', 'system'],
        severities: ['info', 'success', 'warning', 'error'],
      },
    };
  }
}