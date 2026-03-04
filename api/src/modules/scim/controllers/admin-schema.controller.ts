/**
 * AdminSchemaController — Admin API for managing per-endpoint SCIM schema extensions.
 *
 * Phase 6: Provides CRUD endpoints to register, list, and remove schema extension
 * definitions scoped to individual SCIM endpoints. Changes are persisted to the
 * EndpointSchema table and hydrated into the in-memory ScimSchemaRegistry.
 *
 * Routes:
 *   POST   /admin/endpoints/:endpointId/schemas        — Register a new schema extension
 *   GET    /admin/endpoints/:endpointId/schemas        — List all extensions for an endpoint
 *   GET    /admin/endpoints/:endpointId/schemas/:urn   — Get a specific extension by URN
 *   DELETE /admin/endpoints/:endpointId/schemas/:urn   — Remove a schema extension
 */
import {
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
} from '@nestjs/common';
import { ENDPOINT_SCHEMA_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointSchemaRepository } from '../../../domain/repositories/endpoint-schema.repository.interface';
import type { EndpointSchemaCreateInput } from '../../../domain/models/endpoint-schema.model';
import { ScimSchemaRegistry } from '../discovery/scim-schema-registry';
import type { ScimSchemaDefinition } from '../discovery/scim-schema-registry';
import { CreateEndpointSchemaDto } from '../dto/create-endpoint-schema.dto';
import { EndpointService } from '../../endpoint/services/endpoint.service';

@Controller('admin/endpoints')
export class AdminSchemaController {
  private readonly logger = new Logger(AdminSchemaController.name);

  constructor(
    @Inject(ENDPOINT_SCHEMA_REPOSITORY)
    private readonly schemaRepo: IEndpointSchemaRepository,
    private readonly schemaRegistry: ScimSchemaRegistry,
    private readonly endpointService: EndpointService,
  ) {}

  /**
   * Safely fetch an endpoint, throwing 404 if not found or if the ID format
   * is invalid. Works with both inmemory and Prisma backends.
   */
  private async requireEndpoint(endpointId: string) {
    return this.endpointService.getEndpoint(endpointId);
  }

  /**
   * POST /admin/endpoints/:endpointId/schemas
   *
   * Register a new per-endpoint SCIM schema extension.
   * Persists to the database and hydrates into the in-memory registry.
   */
  @Post(':endpointId/schemas')
  async registerSchema(
    @Param('endpointId') endpointId: string,
    @Body() dto: CreateEndpointSchemaDto,
  ) {
    // Validate endpoint exists (works with both inmemory and Prisma backends)
    await this.requireEndpoint(endpointId);

    // Check for duplicate
    const existing = await this.schemaRepo.findByEndpointAndUrn(endpointId, dto.schemaUrn);
    if (existing) {
      throw new ConflictException(
        `Schema extension "${dto.schemaUrn}" already registered for endpoint "${endpointId}".`,
      );
    }

    // Persist to database
    const input: EndpointSchemaCreateInput = {
      endpointId,
      schemaUrn: dto.schemaUrn,
      name: dto.name,
      description: dto.description ?? null,
      resourceTypeId: dto.resourceTypeId ?? null,
      required: dto.required ?? false,
      attributes: dto.attributes as unknown[],
    };

    const record = await this.schemaRepo.create(input);

    // Hydrate into in-memory registry
    const definition: ScimSchemaDefinition = {
      id: dto.schemaUrn,
      name: dto.name,
      description: dto.description ?? '',
      attributes: dto.attributes,
      meta: {
        resourceType: 'Schema',
        location: `/Schemas/${dto.schemaUrn}`,
      },
    };

    this.schemaRegistry.registerExtension(
      definition,
      dto.resourceTypeId,
      dto.required ?? false,
      endpointId,
    );

    this.logger.log(
      `Registered schema extension "${dto.schemaUrn}" for endpoint "${endpointId}"`,
    );

    return {
      id: record.id,
      endpointId: record.endpointId,
      schemaUrn: record.schemaUrn,
      name: record.name,
      description: record.description,
      resourceTypeId: record.resourceTypeId,
      required: record.required,
      attributes: record.attributes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/schemas
   *
   * List all schema extensions registered for the given endpoint.
   */
  @Get(':endpointId/schemas')
  async listSchemas(@Param('endpointId') endpointId: string) {
    // Validate endpoint exists (works with both inmemory and Prisma backends)
    await this.requireEndpoint(endpointId);

    const records = await this.schemaRepo.findByEndpointId(endpointId);

    return {
      totalResults: records.length,
      schemas: records.map((r) => ({
        id: r.id,
        endpointId: r.endpointId,
        schemaUrn: r.schemaUrn,
        name: r.name,
        description: r.description,
        resourceTypeId: r.resourceTypeId,
        required: r.required,
        attributes: r.attributes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /**
   * GET /admin/endpoints/:endpointId/schemas/:urn
   *
   * Get a specific schema extension by URN for the given endpoint.
   */
  @Get(':endpointId/schemas/:urn')
  async getSchema(
    @Param('endpointId') endpointId: string,
    @Param('urn') urn: string,
  ) {
    const record = await this.schemaRepo.findByEndpointAndUrn(endpointId, urn);
    if (!record) {
      throw new NotFoundException(
        `Schema extension "${urn}" not found for endpoint "${endpointId}".`,
      );
    }

    return {
      id: record.id,
      endpointId: record.endpointId,
      schemaUrn: record.schemaUrn,
      name: record.name,
      description: record.description,
      resourceTypeId: record.resourceTypeId,
      required: record.required,
      attributes: record.attributes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * DELETE /admin/endpoints/:endpointId/schemas/:urn
   *
   * Remove a schema extension from the endpoint. Deletes from the database
   * and removes from the in-memory registry.
   */
  @Delete(':endpointId/schemas/:urn')
  @HttpCode(204)
  async removeSchema(
    @Param('endpointId') endpointId: string,
    @Param('urn') urn: string,
  ) {
    const deleted = await this.schemaRepo.deleteByEndpointAndUrn(endpointId, urn);
    if (!deleted) {
      throw new NotFoundException(
        `Schema extension "${urn}" not found for endpoint "${endpointId}".`,
      );
    }

    // Remove from in-memory registry
    this.schemaRegistry.unregisterExtension(urn, endpointId);

    this.logger.log(
      `Removed schema extension "${urn}" from endpoint "${endpointId}"`,
    );
  }
}
