/**
 * AdminResourceTypeController — Admin API for managing per-endpoint custom
 * SCIM resource type registrations.
 *
 * Phase 8b: Provides CRUD endpoints to register, list, and remove custom
 * resource types scoped to individual SCIM endpoints. Changes are persisted
 * to the EndpointResourceType table and hydrated into the ScimSchemaRegistry.
 *
 * Gated behind the `CustomResourceTypesEnabled` per-endpoint config flag.
 *
 * Routes:
 *   POST   /admin/endpoints/:endpointId/resource-types        — Register a custom resource type
 *   GET    /admin/endpoints/:endpointId/resource-types        — List all custom resource types
 *   GET    /admin/endpoints/:endpointId/resource-types/:name  — Get a specific resource type
 *   DELETE /admin/endpoints/:endpointId/resource-types/:name  — Remove a custom resource type
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ENDPOINT_RESOURCE_TYPE_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointResourceTypeRepository } from '../../../domain/repositories/endpoint-resource-type.repository.interface';
import type { EndpointResourceTypeCreateInput } from '../../../domain/models/endpoint-resource-type.model';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import { CreateEndpointResourceTypeDto } from '../dto/create-endpoint-resource-type.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { getConfigBoolean, ENDPOINT_CONFIG_FLAGS } from '../../endpoint/endpoint-config.interface';

/** Built-in resource type names that cannot be registered as custom types */
const RESERVED_RESOURCE_TYPE_NAMES = new Set(['User', 'Group']);

/** Built-in SCIM endpoint paths that cannot be used by custom types */
const RESERVED_ENDPOINT_PATHS = new Set(['/Users', '/Groups', '/Schemas', '/ResourceTypes', '/ServiceProviderConfig', '/Bulk', '/Me']);

@Controller('admin/endpoints')
export class AdminResourceTypeController {
  private readonly logger = new Logger(AdminResourceTypeController.name);

  constructor(
    @Inject(ENDPOINT_RESOURCE_TYPE_REPOSITORY)
    private readonly resourceTypeRepo: IEndpointResourceTypeRepository,
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Safely fetch an endpoint, throwing 404 if not found or if the ID format
   * is invalid (e.g. not a UUID — Prisma would throw a raw error).
   */
  private async requireEndpoint(endpointId: string) {
    let endpoint: { id: string; config: string | null } | null;
    try {
      endpoint = await this.prisma.endpoint.findUnique({
        where: { id: endpointId },
      });
    } catch {
      throw new NotFoundException(`Endpoint "${endpointId}" not found.`);
    }
    if (!endpoint) {
      throw new NotFoundException(`Endpoint "${endpointId}" not found.`);
    }
    return endpoint;
  }

  /**
   * POST /admin/endpoints/:endpointId/resource-types
   *
   * Register a new per-endpoint custom SCIM resource type.
   * Persists to the database and hydrates into the in-memory registry.
   */
  @Post(':endpointId/resource-types')
  async registerResourceType(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateEndpointResourceTypeDto,
  ) {
    // Validate endpoint exists
    const endpoint = await this.requireEndpoint(endpointId);

    // Check if custom resource types are enabled for this endpoint
    const config = endpoint.config ? JSON.parse(endpoint.config) : {};
    if (!getConfigBoolean(config, ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED)) {
      throw new ForbiddenException(
        `Custom resource types are not enabled for endpoint "${endpointId}". ` +
        `Set "${ENDPOINT_CONFIG_FLAGS.CUSTOM_RESOURCE_TYPES_ENABLED}" to "True" in the endpoint config.`,
      );
    }

    // Validate name is not a reserved built-in resource type
    if (RESERVED_RESOURCE_TYPE_NAMES.has(dto.name)) {
      throw new BadRequestException(
        `Resource type name "${dto.name}" is reserved for built-in types. ` +
        `Choose a different name (e.g., "Device", "Application").`,
      );
    }

    // Validate endpoint path is not a reserved SCIM path
    if (RESERVED_ENDPOINT_PATHS.has(dto.endpoint)) {
      throw new BadRequestException(
        `Endpoint path "${dto.endpoint}" is reserved for built-in SCIM endpoints. ` +
        `Choose a different path (e.g., "/Devices", "/Applications").`,
      );
    }

    // Check for duplicate name
    const existingByName = await this.resourceTypeRepo.findByEndpointAndName(endpointId, dto.name);
    if (existingByName) {
      throw new ConflictException(
        `Resource type "${dto.name}" already registered for endpoint "${endpointId}".`,
      );
    }

    // Persist to database
    const input: EndpointResourceTypeCreateInput = {
      endpointId,
      name: dto.name,
      description: dto.description ?? null,
      schemaUri: dto.schemaUri,
      endpoint: dto.endpoint,
      schemaExtensions: (dto.schemaExtensions ?? []).map((ext) => ({
        schema: ext.schema,
        required: ext.required ?? false,
      })),
    };

    const record = await this.resourceTypeRepo.create(input);

    // Hydrate into in-memory schema registry
    this.schemaRegistry.registerResourceType(
      {
        id: dto.name,
        name: dto.name,
        endpoint: dto.endpoint,
        description: dto.description ?? `Custom resource type: ${dto.name}`,
        schema: dto.schemaUri,
        schemaExtensions: (dto.schemaExtensions ?? []).map((ext) => ({
          schema: ext.schema,
          required: ext.required ?? false,
        })),
      },
      endpointId,
    );

    this.logger.log(
      `Registered custom resource type "${dto.name}" at "${dto.endpoint}" for endpoint "${endpointId}"`,
    );

    return {
      id: record.id,
      endpointId: record.endpointId,
      name: record.name,
      description: record.description,
      schemaUri: record.schemaUri,
      endpoint: record.endpoint,
      schemaExtensions: record.schemaExtensions,
      active: record.active,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/resource-types
   *
   * List all custom resource types registered for the given endpoint.
   */
  @Get(':endpointId/resource-types')
  async listResourceTypes(@Param('endpointId') endpointId: string) {
    // Validate endpoint exists
    await this.requireEndpoint(endpointId);

    const records = await this.resourceTypeRepo.findByEndpointId(endpointId);

    return {
      totalResults: records.length,
      resourceTypes: records.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        name: r.name,
        description: r.description,
        schemaUri: r.schemaUri,
        endpoint: r.endpoint,
        schemaExtensions: r.schemaExtensions,
        active: r.active,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/resource-types/:name
   *
   * Get a specific custom resource type by name for the given endpoint.
   */
  @Get(':endpointId/resource-types/:name')
  async getResourceType(
    @Param('endpointId') endpointId: string,
    @Param('name') name: string,
  ) {
    const record = await this.resourceTypeRepo.findByEndpointAndName(endpointId, name);
    if (!record) {
      throw new NotFoundException(
        `Custom resource type "${name}" not found for endpoint "${endpointId}".`,
      );
    }

    return {
      id: record.id,
      endpointId: record.endpointId,
      name: record.name,
      description: record.description,
      schemaUri: record.schemaUri,
      endpoint: record.endpoint,
      schemaExtensions: record.schemaExtensions,
      active: record.active,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * DELETE /admin/endpoints/:endpointId/resource-types/:name
   *
   * Remove a custom resource type from the endpoint. Deletes from the database
   * and removes from the in-memory registry.
   */
  @Delete(':endpointId/resource-types/:name')
  @HttpCode(204)
  async removeResourceType(
    @Param('endpointId') endpointId: string,
    @Param('name') name: string,
  ) {
    // Prevent deleting built-in types
    if (RESERVED_RESOURCE_TYPE_NAMES.has(name)) {
      throw new BadRequestException(
        `Cannot delete built-in resource type "${name}".`,
      );
    }

    const deleted = await this.resourceTypeRepo.deleteByEndpointAndName(endpointId, name);
    if (!deleted) {
      throw new NotFoundException(
        `Custom resource type "${name}" not found for endpoint "${endpointId}".`,
      );
    }

    // Remove from in-memory registry
    this.schemaRegistry.unregisterResourceType(name, endpointId);

    this.logger.log(
      `Removed custom resource type "${name}" from endpoint "${endpointId}"`,
    );
  }
}
