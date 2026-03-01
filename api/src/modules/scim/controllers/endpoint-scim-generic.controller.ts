/**
 * EndpointScimGenericController — Phase 8b Wildcard SCIM Controller
 *
 * Handles SCIM CRUD operations for custom resource types registered via the
 * Admin API. Routes are matched by a wildcard `:resourceType` param that
 * must match a registered custom resource type for the endpoint.
 *
 * IMPORTANT: This controller must be registered LAST in the NestJS module's
 * controllers array so that built-in routes (Users, Groups, Schemas, etc.)
 * take precedence over the wildcard match.
 *
 * Routes:
 *   POST   /endpoints/:endpointId/:resourceType
 *   GET    /endpoints/:endpointId/:resourceType
 *   GET    /endpoints/:endpointId/:resourceType/:id
 *   PUT    /endpoints/:endpointId/:resourceType/:id
 *   PATCH  /endpoints/:endpointId/:resourceType/:id
 *   DELETE /endpoints/:endpointId/:resourceType/:id
 *   POST   /endpoints/:endpointId/:resourceType/.search
 *
 * Gated behind the `CustomResourceTypesEnabled` per-endpoint config flag.
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import {
  getConfigBoolean,
  ENDPOINT_CONFIG_FLAGS,
  type EndpointConfig,
} from '../../endpoint/endpoint-config.interface';
import { SCIM_WARNING_URN } from '../common/scim-service-helpers';
import { EndpointScimGenericService } from '../services/endpoint-scim-generic.service';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { ScimSchemaRegistry, type ScimResourceType } from '../discovery/scim-schema-registry';
import { buildBaseUrl } from '../common/base-url.util';

@Controller('endpoints/:endpointId')
export class EndpointScimGenericController {
  private readonly logger = new Logger(EndpointScimGenericController.name);

  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly genericService: EndpointScimGenericService,
    private readonly schemaRegistry: ScimSchemaRegistry,
  ) {}

  /**
   * Attach readOnly-stripping warnings to a write response when
   * IncludeWarningAboutIgnoredReadOnlyAttribute is enabled.
   */
  private attachWarnings(result: Record<string, unknown>, config?: EndpointConfig): Record<string, unknown> {
    const warnings = this.endpointContext.getWarnings();
    if (warnings.length === 0) return result;
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE)) return result;

    const schemas = [...((result.schemas as string[]) ?? [])];
    if (!schemas.includes(SCIM_WARNING_URN)) {
      schemas.push(SCIM_WARNING_URN);
    }

    return {
      ...result,
      schemas,
      [SCIM_WARNING_URN]: { warnings },
    };
  }

  /**
   * Validate endpoint, check custom resource types flag, and resolve the resource type.
   */
  private async resolveContext(
    endpointId: string,
    resourceTypePath: string,
    req: Request,
  ): Promise<{ baseUrl: string; config: EndpointConfig; resourceType: ScimResourceType }> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);

    if (!endpoint.active) {
      throw new ForbiddenException(
        `Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`,
      );
    }

    const config: EndpointConfig = endpoint.config || {};
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, config });

    // Check if custom resource types are enabled
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED)) {
      throw new NotFoundException(
        `Resource type at "/${resourceTypePath}" is not available. Custom resource types are not enabled for this endpoint.`,
      );
    }

    // Resolve the custom resource type by endpoint path
    const rt = this.schemaRegistry.findResourceTypeByEndpointPath(
      `/${resourceTypePath}`,
      endpointId,
    );

    if (!rt) {
      throw new NotFoundException(
        `No custom resource type registered at "/${resourceTypePath}" for this endpoint.`,
      );
    }

    return { baseUrl, config, resourceType: rt };
  }

  // ===== CRUD Endpoints =====

  /**
   * POST /endpoints/:endpointId/:resourceType
   * Create a custom resource
   */
  @Post(':resourceType')
  async createResource(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    const result = await this.genericService.createResource(body, baseUrl, endpointId, resourceType, config);
    return this.attachWarnings(result, config);
  }

  /**
   * GET /endpoints/:endpointId/:resourceType
   * List custom resources
   */
  @Get(':resourceType')
  async listResources(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Req() req: Request,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ascending' | 'descending',
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    return this.genericService.listResources(
      {
        filter,
        startIndex: startIndex ? parseInt(startIndex, 10) : undefined,
        count: count ? parseInt(count, 10) : undefined,
        sortBy,
        sortOrder,
      },
      baseUrl,
      endpointId,
      resourceType,
      config,
    );
  }

  /**
   * POST /endpoints/:endpointId/:resourceType/.search
   * Search custom resources using POST body
   */
  @Post(':resourceType/.search')
  @HttpCode(200)
  async searchResources(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Body() body: { filter?: string; startIndex?: number; count?: number; sortBy?: string; sortOrder?: 'ascending' | 'descending' },
    @Req() req: Request,
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    return this.genericService.listResources(
      {
        filter: body.filter,
        startIndex: body.startIndex,
        count: body.count,
        sortBy: body.sortBy,
        sortOrder: body.sortOrder,
      },
      baseUrl,
      endpointId,
      resourceType,
      config,
    );
  }

  /**
   * GET /endpoints/:endpointId/:resourceType/:id
   * Get a specific custom resource
   */
  @Get(':resourceType/:id')
  async getResource(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    return this.genericService.getResource(id, baseUrl, endpointId, resourceType, config);
  }

  /**
   * PUT /endpoints/:endpointId/:resourceType/:id
   * Replace a custom resource
   */
  @Put(':resourceType/:id')
  async replaceResource(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.genericService.replaceResource(
      id,
      body,
      baseUrl,
      endpointId,
      resourceType,
      config,
      ifMatch,
    );
    return this.attachWarnings(result, config);
  }

  /**
   * PATCH /endpoints/:endpointId/:resourceType/:id
   * Patch a custom resource
   */
  @Patch(':resourceType/:id')
  async patchResource(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const { baseUrl, config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    const ifMatch = req.headers['if-match'] as string | undefined;
    const result = await this.genericService.patchResource(
      id,
      body,
      baseUrl,
      endpointId,
      resourceType,
      config,
      ifMatch,
    );
    return this.attachWarnings(result, config);
  }

  /**
   * DELETE /endpoints/:endpointId/:resourceType/:id
   * Delete a custom resource
   */
  @Delete(':resourceType/:id')
  @HttpCode(204)
  async deleteResource(
    @Param('endpointId') endpointId: string,
    @Param('resourceType') resourceTypePath: string,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    const { config, resourceType } = await this.resolveContext(
      endpointId,
      resourceTypePath,
      req,
    );
    const ifMatch = req.headers['if-match'] as string | undefined;
    return this.genericService.deleteResource(
      id,
      endpointId,
      resourceType,
      config,
      ifMatch,
    );
  }
}
