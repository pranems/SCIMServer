import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Param,
  NotFoundException,
  Req,
  Logger
} from '@nestjs/common';
import type { Request } from 'express';
import os from 'node:os';
import fs from 'node:fs';

import { LoggingService } from '../../logging/logging.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildBaseUrl } from '../common/base-url.util';
import { SCIM_CORE_GROUP_SCHEMA, SCIM_CORE_USER_SCHEMA } from '../common/scim-constants';
import type { ScimGroupResource, ScimUserResource } from '../common/scim-types';
import { CreateGroupDto } from '../dto/create-group.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { ManualGroupDto } from '../dto/manual-group.dto';
import { ManualUserDto } from '../dto/manual-user.dto';
import { EndpointScimGroupsService } from '../services/endpoint-scim-groups.service';
import { EndpointScimUsersService } from '../services/endpoint-scim-users.service';

interface VersionInfo {
  version: string;
  commit?: string;
  buildTime?: string; // ISO string
  service: {
    name: string;
    environment: string;
    apiPrefix: string;
    scimBasePath: string;
    now: string;
    startedAt: string;
    uptimeSeconds: number;
    timezone: string;
    utcOffset: string;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
    pid: number;
    hostname: string;
    cpus: number;
    containerized: boolean;
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    };
  };
  auth: {
    oauthClientId?: string;
    oauthClientSecretConfigured: boolean;
    jwtSecretConfigured: boolean;
    scimSharedSecretConfigured: boolean;
  };
  storage: {
    databaseUrl?: string;
    databaseProvider: 'postgresql';
    persistenceBackend: 'prisma' | 'inmemory';
    connectionPool?: {
      maxConnections: number;
    };
  };
  container?: {
    app: {
      id?: string;
      name?: string;
      image?: string;
      runtime: string;
      platform: string;
    };
    database?: {
      host: string;
      port: number;
      name: string;
      provider: string;
      version?: string;
    };
  };
  deployment?: {
    resourceGroup?: string;
    containerApp?: string;
    registry?: string;
    currentImage?: string;
    migratePhase: string;
  };
}

const serviceBootTime = new Date();

@Controller('admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  constructor(
    private readonly loggingService: LoggingService,
    private readonly prisma: PrismaService,
    private readonly usersService: EndpointScimUsersService,
    private readonly groupsService: EndpointScimGroupsService
  ) {}

  /**
   * Get or create a default endpoint for admin operations.
   * Uses the first available endpoint, or creates one named "default".
   */
  private async getDefaultEndpointId(): Promise<string> {
    const existing = await this.prisma.endpoint.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing.id;

    const created = await this.prisma.endpoint.create({
      data: { name: 'default', active: true }
    });
    return created.id;
  }

  @Post('logs/clear')
  @HttpCode(204)
  async clearLogs(): Promise<void> {
    await this.loggingService.clearLogs();
  }

  @Get('logs')
  async listLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
    @Query('hasError') hasError?: string,
    @Query('urlContains') urlContains?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('search') search?: string,
    @Query('includeAdmin') includeAdmin?: string,
    @Query('hideKeepalive') hideKeepalive?: string
  ) {
    return this.loggingService.listLogs({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      method: method || undefined,
      status: status ? Number(status) : undefined,
      hasError: hasError === undefined ? undefined : hasError === 'true',
      urlContains: urlContains || undefined,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      search: search || undefined,
      includeAdmin: includeAdmin === 'true',
      hideKeepalive: hideKeepalive === 'true'
    });
  }

  @Get('logs/:id')
  async getLog(@Param('id') id: string) {
    const log = await this.loggingService.getLog(id);
    if (!log) throw new NotFoundException('Log not found');
    return log;
  }

  @Post('users/manual')
  @Header('Content-Type', 'application/scim+json')
  async createManualUser(
    @Body() dto: ManualUserDto,
    @Req() request: Request
  ): Promise<ScimUserResource> {
    const endpointId = await this.getDefaultEndpointId();
    const baseUrl = `${buildBaseUrl(request)}/endpoints/${endpointId}`;
    const userName = dto.userName.trim();
    const payload: CreateUserDto = {
      schemas: [SCIM_CORE_USER_SCHEMA],
      userName,
      active: dto.active ?? true
    };

    const externalId = dto.externalId?.trim();
    if (externalId) {
      payload.externalId = externalId;
    }

    const extras: Record<string, unknown> = {};

    const displayName = dto.displayName?.trim();
    if (displayName) {
      extras.displayName = displayName;
    }

    const name: Record<string, string> = {};
    if (dto.givenName) {
      name.givenName = dto.givenName.trim();
    }
    if (dto.familyName) {
      name.familyName = dto.familyName.trim();
    }
    if (displayName) {
      name.formatted = displayName;
    }
    if (Object.keys(name).length > 0) {
      extras.name = name;
    }

    const email = dto.email?.trim();
    if (email) {
      extras.emails = [
        {
          value: email,
          type: 'work',
          primary: true
        }
      ];
    }

    const phoneNumber = dto.phoneNumber?.trim();
    if (phoneNumber) {
      extras.phoneNumbers = [
        {
          value: phoneNumber,
          type: 'work'
        }
      ];
    }

    const department = dto.department?.trim();
    if (department) {
      extras['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] = {
        department
      };
    }

    const mergedPayload = {
      ...payload,
      ...extras
    } as CreateUserDto;

    return this.usersService.createUserForEndpoint(mergedPayload, baseUrl, endpointId);
  }

  @Post('groups/manual')
  @Header('Content-Type', 'application/scim+json')
  async createManualGroup(
    @Body() dto: ManualGroupDto,
    @Req() request: Request
  ): Promise<ScimGroupResource> {
    const endpointId = await this.getDefaultEndpointId();
    const baseUrl = `${buildBaseUrl(request)}/endpoints/${endpointId}`;
    const displayName = dto.displayName.trim();
    const members = dto.memberIds
      ?.map((member) => member.trim())
      .filter((member) => member.length > 0)
      .map((value) => ({ value }));

    const payload: CreateGroupDto = {
      schemas: [SCIM_CORE_GROUP_SCHEMA],
      displayName,
      ...(members && members.length > 0 ? { members } : {})
    };

    const scimId = dto.scimId?.trim();
    if (scimId) {
      (payload as Record<string, unknown>).id = scimId;
    }

    return this.groupsService.createGroupForEndpoint(payload, baseUrl, endpointId);
  }

  @Post('users/:id/delete')
  @HttpCode(204)
  async deleteUser(@Param('id') id: string): Promise<void> {
    // Search by Prisma PK (id) or SCIM identifier (scimId)
    const user = await this.prisma.scimResource.findFirst({
      where: { OR: [{ id }, { scimId: id }], resourceType: 'User' },
      select: { id: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.prisma.scimResource.delete({ where: { id: user.id } });
  }

  @Get('version')
  getVersion(): VersionInfo {
    // Prefer explicit env vars injected at build/deploy time
    const version = process.env.APP_VERSION || this.readPackageVersion();
    const commit = process.env.GIT_COMMIT;
    const buildTime = process.env.BUILD_TIME;
    const now = new Date();
    const persistenceBackend = (process.env.PERSISTENCE_BACKEND ?? 'prisma').toLowerCase() as 'prisma' | 'inmemory';
    const databaseUrl = this.maskSensitiveUrl(process.env.DATABASE_URL);
    const memory = process.memoryUsage();
    const apiPrefix = process.env.API_PREFIX ?? 'scim';

    // Image tag detection moved to frontend (see web build in Dockerfile)
    const currentImage = undefined;

    // Connection pool max from DATABASE_URL or default
    const poolMax = persistenceBackend === 'prisma' ? 5 : undefined;

    // Timezone: use TZ env if set, then Intl, then fall back to 'UTC'
    const ianaTimezone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const utcOffsetMinutes = -now.getTimezoneOffset();
    const offsetSign = utcOffsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(utcOffsetMinutes);
    const offsetHours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
    const offsetMins = String(absMinutes % 60).padStart(2, '0');
    const utcOffset = `${offsetSign}${offsetHours}:${offsetMins}`;

    // Container info — populated only when running in a container
    const containerized = this.isContainerized();
    const containerBlock = containerized ? this.buildContainerInfo(databaseUrl) : undefined;

    return {
      version,
      commit,
      buildTime,
      service: {
        name: 'SCIMServer API',
        environment: process.env.NODE_ENV ?? 'development',
        apiPrefix,
        scimBasePath: `/${apiPrefix}/v2`,
        now: now.toISOString(),
        startedAt: serviceBootTime.toISOString(),
        uptimeSeconds: Number(process.uptime().toFixed(3)),
        timezone: ianaTimezone,
        utcOffset
      },
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        hostname: os.hostname(),
        cpus: os.cpus().length,
        containerized,
        memory: {
          rss: memory.rss,
          heapTotal: memory.heapTotal,
          heapUsed: memory.heapUsed,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers
        }
      },
      auth: {
        oauthClientId: process.env.OAUTH_CLIENT_ID,
        oauthClientSecretConfigured: this.isConfigured(process.env.OAUTH_CLIENT_SECRET),
        jwtSecretConfigured: this.isConfigured(process.env.JWT_SECRET),
        scimSharedSecretConfigured: this.isConfigured(process.env.SCIM_SHARED_SECRET)
      },
      storage: {
        databaseUrl,
        databaseProvider: 'postgresql',
        persistenceBackend,
        ...(poolMax ? { connectionPool: { maxConnections: poolMax } } : {})
      },
      ...(containerBlock ? { container: containerBlock } : {}),
      deployment: {
        resourceGroup: process.env.SCIM_RG,
        containerApp: process.env.SCIM_APP,
        registry: process.env.SCIM_REGISTRY,
        currentImage,
        migratePhase: 'Phase 3 — PostgreSQL Migration'
      }
    };
  }

  private isConfigured(value: string | undefined): boolean {
    return Boolean(value && value.trim().length > 0);
  }

  private maskSensitiveUrl(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return value
      // Mask userinfo in connection strings: postgresql://user:password@host → postgresql://***:***@host
      .replace(/:\/\/([^:@]+):([^@]+)@/, '://***:***@')
      .replace(/(token|secret|password)=([^&]+)/gi, '$1=***')
      .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
  }

  private isContainerized(): boolean {
    return fs.existsSync('/.dockerenv') || this.isConfigured(process.env.CONTAINER_APP_NAME);
  }

  /**
   * Build container metadata block from available Docker / env sources.
   */
  private buildContainerInfo(databaseUrl: string | undefined): NonNullable<VersionInfo['container']> {
    // Container ID: hostname inside Docker is the short container ID
    const containerId = this.readContainerId();
    const containerName = process.env.HOSTNAME || undefined;

    // Docker image: injected via DOCKER_IMAGE env or label
    const image = process.env.DOCKER_IMAGE || process.env.CONTAINER_IMAGE || undefined;

    // Parse database host/port/name from raw DATABASE_URL (not the masked version)
    let dbInfo: NonNullable<VersionInfo['container']>['database'] | undefined = undefined;
    const rawDbUrl = process.env.DATABASE_URL;
    if (rawDbUrl) {
      try {
        const url = new URL(rawDbUrl);
        dbInfo = {
          host: url.hostname,
          port: parseInt(url.port, 10) || 5432,
          name: url.pathname.replace(/^\//, ''),
          provider: 'PostgreSQL 17-alpine',
          version: process.env.POSTGRES_VERSION || undefined,
        };
      } catch {
        // If URL parsing fails, provide what we can
        dbInfo = {
          host: 'unknown',
          port: 5432,
          name: 'scimdb',
          provider: 'PostgreSQL',
        };
      }
    }

    return {
      app: {
        id: containerId,
        name: containerName,
        image,
        runtime: `Node.js ${process.version}`,
        platform: `${process.platform}/${process.arch}`,
      },
      ...(dbInfo ? { database: dbInfo } : {}),
    };
  }

  /**
   * Read the Docker container ID from /proc/self/cgroup or hostname.
   */
  private readContainerId(): string | undefined {
    try {
      // On Linux Docker, /proc/self/cgroup contains the full container ID
      if (fs.existsSync('/proc/self/cgroup')) {
        const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
        const match = cgroup.match(/[0-9a-f]{64}/);
        if (match) return match[0].substring(0, 12); // short ID
      }
      // On Docker Desktop / newer cgroupv2, /proc/self/mountinfo may have it
      if (fs.existsSync('/proc/self/mountinfo')) {
        const mountinfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
        const match = mountinfo.match(/\/docker\/containers\/([0-9a-f]{64})/);
        if (match) return match[1].substring(0, 12);
      }
    } catch {
      // Ignore read errors — not every environment has /proc
    }
    // Fallback: hostname is the short container ID in Docker
    const hostname = os.hostname();
    return /^[0-9a-f]{12}$/.test(hostname) ? hostname : undefined;
  }

  private readPackageVersion(): string {
    try {
      // Lazy load to avoid startup cost if env already provided
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pkg = require('../../../../package.json');
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
