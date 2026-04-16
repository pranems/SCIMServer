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
  ) {
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (this.isInMemoryBackend) {
      return this.getActivitiesInMemory(pageNum, limitNum, type, severity, search, hideKeepalive === 'true');
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

    const where: any = { AND: whereConditions };

    // Fetch logs from database
    const [logs, total] = await Promise.all([
      this.prisma.requestLog.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          method: true,
          url: true,
          status: true,
          requestBody: true,
          responseBody: true,
          createdAt: true,
          identifier: true,
        },
      }),
      this.prisma.requestLog.count({ where }),
    ]);

    // Parse each log into an activity summary
    let activities: ActivitySummary[] = await Promise.all(
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

    // Apply client-side filters
    if (type) {
      activities = activities.filter(activity => activity.type === type);
    }

    if (severity) {
      activities = activities.filter(activity => activity.severity === severity);
    }

    return {
      activities,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
      filters: {
        types: ['user', 'group', 'system'],
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

    // Get recent activity counts
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Common exclusion: admin traffic should never count as SCIM operations
    const notAdmin = { url: { not: { contains: '/admin/' } } };

    // SQL-level keepalive exclusion — Entra keepalive probes are:
    // method=GET + url contains /Users + identifier IS NULL + status < 400 + url has ?filter=
    // We EXCLUDE these by using NOT { AND: [all keepalive conditions] }
    const notKeepalive = {
      NOT: {
        AND: [
          { method: 'GET' },
          { url: { contains: '/Users' } },
          { identifier: null },
          { OR: [{ status: null }, { status: { lt: 400 } }] },
          { url: { contains: '?filter=' } },
        ],
      },
    };

    const [last24Hours, lastWeek, userOperations, groupOperations] = await Promise.all([
      // Last 24h: non-admin, non-keepalive count
      this.prisma.requestLog.count({
        where: {
          createdAt: { gte: oneDayAgo },
          ...notAdmin,
          ...notKeepalive,
        },
      }),
      // Last 7d: non-admin, non-keepalive count
      this.prisma.requestLog.count({
        where: {
          createdAt: { gte: oneWeekAgo },
          ...notAdmin,
          ...notKeepalive,
        },
      }),
      // User operations: last 30 days, non-admin, non-keepalive, URL contains /Users
      // Bounded to 30 days to avoid full table scans on burstable DB tiers.
      this.prisma.requestLog.count({
        where: {
          AND: [
            { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
            { url: { contains: '/Users' } },
            notAdmin,
            notKeepalive,
          ],
        },
      }),
      // Group operations: last 30 days, non-admin count (keepalive only targets /Users, not /Groups)
      this.prisma.requestLog.count({
        where: {
          AND: [
            { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
            { url: { contains: '/Groups' } },
            notAdmin,
          ],
        },
      }),
    ]);

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
  ) {
    // Use LoggingService.listLogs which already has inmemory support
    const logResult = await this.loggingService.listLogs({
      page,
      pageSize: limit,
      urlContains: search || undefined,
      hideKeepalive,
    });

    const logs = logResult.items ?? [];
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

    return {
      activities,
      pagination: {
        page,
        limit,
        total: logResult.total ?? logs.length,
        pages: Math.ceil((logResult.total ?? logs.length) / limit),
      },
      filters: {
        types: ['user', 'group', 'system'],
        severities: ['info', 'success', 'warning', 'error'],
      },
    };
  }
}