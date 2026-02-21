import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async getUsers(query: UserQuery) {
    const { page, limit, search, active } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    
    if (search) {
      where.OR = [
        { userName: { contains: search, mode: 'insensitive' } },
        { scimId: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
        // Note: JSONB payload cannot be searched with simple contains
      ];
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
    };
  }
}