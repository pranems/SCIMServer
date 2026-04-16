import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import type { IGroupRepository } from '../../domain/repositories/group.repository.interface';
import { USER_REPOSITORY, GROUP_REPOSITORY } from '../../domain/repositories/repository.tokens';
import { EndpointService } from '../endpoint/services/endpoint.service';
import { LoggingService } from '../logging/logging.service';
import { isValidUuid } from '../../infrastructure/repositories/prisma/uuid-guard';

interface UserQuery {
  page: number;
  limit: number;
  search?: string;
  active?: boolean;
}

interface GroupQuery {
  page: number;
  limit: number;
  search?: string;
}

@Injectable()
export class DatabaseService {
  private readonly isInMemoryBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() === 'inmemory';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(GROUP_REPOSITORY) private readonly groupRepo: IGroupRepository,
    @Optional() private readonly endpointService?: EndpointService,
    @Optional() private readonly loggingService?: LoggingService,
  ) {}

  async getUsers(query: UserQuery) {
    if (this.isInMemoryBackend) {
      return this.getUsersInMemory(query);
    }
    const { page, limit, search, active } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (search) {
      // Only search text-compatible columns — scimId is @db.Uuid and
      // cannot use 'contains' without crashing PostgreSQL.
      where.OR = [
        { userName: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
      ];
      // If the search term looks like a UUID, also search by scimId (exact match)
      if (isValidUuid(search)) {
        where.OR.push({ scimId: search });
      }
    }

    if (active !== undefined) {
      where.active = active;
    }

    where.resourceType = 'User';
    const [users, total] = await Promise.all([
      this.prisma.scimResource.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userName: true,
          scimId: true,
          externalId: true,
          active: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
          membersAsMember: {
            select: {
              group: {
                select: {
                  id: true,
                  displayName: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.scimResource.count({ where }),
    ]);

    return {
      users: users.map(user => {
        const parsedPayload = (user.payload && typeof user.payload === 'object')
          ? user.payload as Record<string, unknown>
          : { userName: user.userName, active: user.active };

        return {
          ...user,
          ...parsedPayload, // Include all fields from the raw SCIM payload
          groups: (user as any).membersAsMember?.map((rm: any) => rm.group) ?? [],
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getGroups(query: GroupQuery) {
    if (this.isInMemoryBackend) {
      return this.getGroupsInMemory(query);
    }
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { resourceType: 'Group' };
    
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [groups, total] = await Promise.all([
      this.prisma.scimResource.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          displayName: true,
          payload: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              membersAsGroup: true,
            },
          },
        },
      }),
      this.prisma.scimResource.count({ where }),
    ]);

    return {
      groups: groups.map(group => {
        const parsedPayload = (group.payload && typeof group.payload === 'object')
          ? group.payload as Record<string, unknown>
          : { displayName: group.displayName };

        return {
          ...group,
          ...parsedPayload,
          memberCount: (group as any)._count.membersAsGroup,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getUserDetails(id: string) {
    if (this.isInMemoryBackend) {
      // In inmemory mode, search across all endpoints
      const endpointIds = await this.getEndpointIds();
      for (const epId of endpointIds) {
        const user = await this.userRepo.findByScimId(epId, id);
        if (user) {
          const payload = typeof user.rawPayload === 'string' ? JSON.parse(user.rawPayload || '{}') : (user.rawPayload ?? {});
          return { ...user, ...payload, groups: [] };
        }
      }
      throw new Error('User not found');
    }
    // Guard: id column is @db.Uuid — reject non-UUID to avoid PostgreSQL crash
    if (!isValidUuid(id)) {
      throw new Error('User not found');
    }
    const user = await this.prisma.scimResource.findFirst({
      where: { id, resourceType: 'User' },
      include: {
        membersAsMember: {
          include: {
            group: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return {
      ...user,
      groups: user.membersAsMember.map((rm: any) => rm.group),
    };
  }

  async getGroupDetails(id: string) {
    if (this.isInMemoryBackend) {
      const endpointIds = await this.getEndpointIds();
      for (const epId of endpointIds) {
        const group = await this.groupRepo.findWithMembers(epId, id);
        if (group) {
          const payload = typeof group.rawPayload === 'string' ? JSON.parse(group.rawPayload || '{}') : (group.rawPayload ?? {});
          return { ...group, ...payload, members: group.members ?? [] };
        }
      }
      throw new Error('Group not found');
    }
    // Guard: id column is @db.Uuid
    if (!isValidUuid(id)) {
      throw new Error('Group not found');
    }
    const group = await this.prisma.scimResource.findFirst({
      where: { id, resourceType: 'Group' },
      include: {
        membersAsGroup: {
          include: {
            member: {
              select: {
                id: true,
                userName: true,
                active: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      throw new Error('Group not found');
    }

    return {
      ...group,
      members: group.membersAsGroup.map((rm: any) => rm.member),
    };
  }

  async getStatistics() {
    if (this.isInMemoryBackend) {
      return this.getStatisticsInMemory();
    }
    const [
      totalUsers,
      activeUsers,
      totalGroups,
      totalLogs,
      recentActivity,
    ] = await Promise.all([
      this.prisma.scimResource.count({ where: { resourceType: 'User' } }),
      this.prisma.scimResource.count({ where: { resourceType: 'User', active: true } }),
      this.prisma.scimResource.count({ where: { resourceType: 'Group' } }),
      this.prisma.requestLog.count(),
      this.prisma.requestLog.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
      },
      groups: {
        total: totalGroups,
      },
      activity: {
        totalRequests: totalLogs,
        last24Hours: recentActivity,
      },
      database: {
        type: 'PostgreSQL',
        persistenceBackend: 'prisma' as const,
      },
    };
  }

  // ─── InMemory fallback methods ────────────────────────────────────

  private async getEndpointIds(): Promise<string[]> {
    if (this.endpointService) {
      const result = await this.endpointService.listEndpoints();
      return result.endpoints.map((e: any) => e.id);
    }
    return [];
  }

  private async getUsersInMemory(query: UserQuery) {
    const { page, limit, search, active } = query;
    const endpointIds = await this.getEndpointIds();

    let allUsers: any[] = [];
    for (const epId of endpointIds) {
      const users = await this.userRepo.findAll(epId);
      allUsers.push(...users);
    }

    // Apply filters
    if (search) {
      const s = search.toLowerCase();
      allUsers = allUsers.filter(u =>
        (u.userName?.toLowerCase().includes(s)) ||
        (u.scimId?.toLowerCase().includes(s)) ||
        (u.externalId?.toLowerCase().includes(s))
      );
    }
    if (active !== undefined) {
      allUsers = allUsers.filter(u => u.active === active);
    }

    // Sort by creation date descending
    allUsers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = allUsers.length;
    const skip = (page - 1) * limit;
    const paged = allUsers.slice(skip, skip + limit);

    return {
      users: paged.map(u => {
        const payload = typeof u.rawPayload === 'string' ? JSON.parse(u.rawPayload || '{}') : (u.rawPayload ?? {});
        return { ...u, ...payload, groups: [] };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private async getGroupsInMemory(query: GroupQuery) {
    const { page, limit, search } = query;
    const endpointIds = await this.getEndpointIds();

    let allGroups: any[] = [];
    for (const epId of endpointIds) {
      const groups = await this.groupRepo.findAllWithMembers(epId);
      allGroups.push(...groups);
    }

    if (search) {
      const s = search.toLowerCase();
      allGroups = allGroups.filter(g => g.displayName?.toLowerCase().includes(s));
    }

    allGroups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = allGroups.length;
    const skip = (page - 1) * limit;
    const paged = allGroups.slice(skip, skip + limit);

    return {
      groups: paged.map(g => {
        const payload = typeof g.rawPayload === 'string' ? JSON.parse(g.rawPayload || '{}') : (g.rawPayload ?? {});
        return { ...g, ...payload, memberCount: g.members?.length ?? 0 };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  private async getStatisticsInMemory() {
    const endpointIds = await this.getEndpointIds();

    let totalUsers = 0;
    let activeUsers = 0;
    let totalGroups = 0;

    for (const epId of endpointIds) {
      const users = await this.userRepo.findAll(epId);
      totalUsers += users.length;
      activeUsers += users.filter(u => u.active).length;
      const groups = await this.groupRepo.findAllWithMembers(epId);
      totalGroups += groups.length;
    }

    return {
      users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers },
      groups: { total: totalGroups },
      activity: { totalRequests: 0, last24Hours: 0 },
      database: {
        type: 'In-Memory',
        persistenceBackend: 'inmemory' as const,
      },
    };
  }
}