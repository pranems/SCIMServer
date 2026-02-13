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
  runtime: {
    node: string;
    platform: string;
  };
  deployment?: {
    resourceGroup?: string;
    containerApp?: string;
    registry?: string;
    currentImage?: string;
    backupMode?: 'blob' | 'azureFiles' | 'none';
    blobAccount?: string;
    blobContainer?: string;
  };
}

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
    const user = await this.prisma.scimUser.findFirst({
      where: { OR: [{ id }, { scimId: id }] },
      select: { id: true }
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.prisma.scimUser.delete({ where: { id: user.id } });
  }

  @Get('version')
  getVersion(): VersionInfo {
    // Prefer explicit env vars injected at build/deploy time
    const version = process.env.APP_VERSION || this.readPackageVersion();
    const commit = process.env.GIT_COMMIT;
    const buildTime = process.env.BUILD_TIME;
    const blobAccount = process.env.BLOB_BACKUP_ACCOUNT;
    const blobContainer = process.env.BLOB_BACKUP_CONTAINER;
    const backupMode: 'blob' | 'azureFiles' | 'none' = blobAccount ? 'blob' : 'none';

    // Image tag detection moved to frontend (see web build in Dockerfile)
    const currentImage = undefined;

    return {
      version,
      commit,
      buildTime,
      runtime: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`
      },
      deployment: {
        resourceGroup: process.env.SCIM_RG,
        containerApp: process.env.SCIM_APP,
        registry: process.env.SCIM_REGISTRY,
        currentImage,
        backupMode,
        blobAccount,
        blobContainer
      }
    };
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
