/**
 * SCIM Bulk Processor — RFC 7644 §3.7
 *
 * Processes multiple SCIM operations in a single HTTP request.
 * Supports bulkId cross-referencing: a POST operation assigns a bulkId,
 * and subsequent operations can reference it via "bulkId:<value>" in paths
 * and member value fields.
 *
 * Sequential processing — each operation completes before the next begins.
 * Errors are counted and processing stops when failOnErrors threshold is reached.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.7
 */
import { Injectable } from '@nestjs/common';
import { HttpException } from '@nestjs/common';

import { EndpointScimUsersService } from './endpoint-scim-users.service';
import { EndpointScimGroupsService } from './endpoint-scim-groups.service';
import { createScimError } from '../common/scim-errors';
import { SCIM_ERROR_SCHEMA, SCIM_ERROR_TYPE } from '../common/scim-constants';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import type {
  BulkOperationDto,
  BulkOperationResult,
  BulkResponse,
} from '../dto/bulk-request.dto';
import { SCIM_BULK_RESPONSE_SCHEMA, BULK_MAX_OPERATIONS } from '../dto/bulk-request.dto';
import { ScimLogger } from '../../logging/scim-logger.service';
import { LogCategory } from '../../logging/log-levels';

/** Regex to match "bulkId:<identifier>" references in JSON string values */
const BULK_ID_REF_PATTERN = /bulkId:([^\s"]+)/g;

/**
 * Parse a SCIM bulk operation path into resource type and optional resource ID.
 *
 * Valid path formats (RFC 7644 §3.7):
 *   - "/Users"           → { resourceType: "Users", resourceId: undefined }
 *   - "/Users/abc-123"   → { resourceType: "Users", resourceId: "abc-123" }
 *   - "/Groups"          → { resourceType: "Groups", resourceId: undefined }
 *   - "/Groups/xyz-456"  → { resourceType: "Groups", resourceId: "xyz-456" }
 */
export function parseBulkPath(path: string): { resourceType: string; resourceId?: string } {
  // Normalise: strip leading slash
  const normalised = path.startsWith('/') ? path.substring(1) : path;
  const slashIdx = normalised.indexOf('/');

  if (slashIdx === -1) {
    return { resourceType: normalised };
  }

  return {
    resourceType: normalised.substring(0, slashIdx),
    resourceId: normalised.substring(slashIdx + 1),
  };
}

@Injectable()
export class BulkProcessorService {
  constructor(
    private readonly usersService: EndpointScimUsersService,
    private readonly groupsService: EndpointScimGroupsService,
    private readonly logger: ScimLogger,
  ) {}

  /**
   * Process a SCIM Bulk request.
   *
   * @param endpointId  The endpoint scope for all operations
   * @param operations  Array of bulk operations from the request body
   * @param baseUrl     Base URL for Location headers
   * @param config      Endpoint configuration (flags)
   * @param failOnErrors  Stop after this many errors (0 = never stop)
   * @returns BulkResponse with per-operation results
   */
  async process(
    endpointId: string,
    operations: BulkOperationDto[],
    baseUrl: string,
    config: EndpointConfig,
    failOnErrors: number = 0,
  ): Promise<BulkResponse> {
    const bulkIdMap = new Map<string, string>();
    const results: BulkOperationResult[] = [];
    let errorCount = 0;

    this.logger.info(LogCategory.SCIM_BULK, 'Bulk request started', {
      opCount: operations.length,
      failOnErrors,
      endpointId,
    });

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];

      // Check failOnErrors threshold
      if (failOnErrors > 0 && errorCount >= failOnErrors) {
        // RFC 7644 §3.7: "the server stops processing and returns"
        break;
      }

      // Set bulk correlation context for this sub-operation
      this.logger.enrichContext({
        bulkOperationIndex: i,
        bulkId: op.bulkId,
        operation: op.method.toLowerCase(),
      });

      try {
        const result = await this.executeOperation(op, endpointId, baseUrl, config, bulkIdMap);
        results.push(result);
      } catch (error) {
        errorCount++;
        this.logger.warn(LogCategory.SCIM_BULK, `Bulk operation ${i} failed`, {
          bulkIndex: i,
          bulkId: op.bulkId,
          method: op.method,
          path: op.path,
          status: error instanceof HttpException ? error.getStatus() : 500,
        });
        results.push(this.buildErrorResult(op, error));
      }
    }

    const processed = results.length;
    const stopped = failOnErrors > 0 && errorCount >= failOnErrors;

    this.logger.info(LogCategory.SCIM_BULK, 'Bulk request completed', {
      total: operations.length,
      processed,
      success: processed - errorCount,
      errors: errorCount,
      stopped,
      endpointId,
    });

    return {
      schemas: [SCIM_BULK_RESPONSE_SCHEMA],
      Operations: results,
    };
  }

  /**
   * Execute a single bulk operation, resolving bulkId references.
   */
  private async executeOperation(
    op: BulkOperationDto,
    endpointId: string,
    baseUrl: string,
    config: EndpointConfig,
    bulkIdMap: Map<string, string>,
  ): Promise<BulkOperationResult> {
    // Resolve bulkId references in path and data
    const resolvedPath = this.resolveBulkIdInString(op.path, bulkIdMap);
    const resolvedData = op.data ? this.resolveBulkIdInData(op.data, bulkIdMap) : undefined;

    const { resourceType, resourceId } = parseBulkPath(resolvedPath);
    const method = op.method.toUpperCase();

    // Validate method + path consistency
    this.validateMethodPathConsistency(method, resourceType, resourceId);

    switch (resourceType) {
      case 'Users':
        return this.executeUserOperation(method, resourceId, resolvedData, op, endpointId, baseUrl, config, bulkIdMap);
      case 'Groups':
        return this.executeGroupOperation(method, resourceId, resolvedData, op, endpointId, baseUrl, config, bulkIdMap);
      default:
        throw createScimError({
          status: 400,
          detail: `Unsupported resource type in bulk path: "${resourceType}". Supported: Users, Groups.`,
          scimType: SCIM_ERROR_TYPE.INVALID_PATH,
        });
    }
  }

  /**
   * Execute a User operation within a bulk request.
   */
  private async executeUserOperation(
    method: string,
    resourceId: string | undefined,
    data: Record<string, unknown> | undefined,
    op: BulkOperationDto,
    endpointId: string,
    baseUrl: string,
    config: EndpointConfig,
    bulkIdMap: Map<string, string>,
  ): Promise<BulkOperationResult> {
    switch (method) {
      case 'POST': {
        if (!data) throw createScimError({ status: 400, detail: 'POST operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.usersService.createUserForEndpoint(data as any, baseUrl, endpointId, config);
        const location = `${baseUrl}/Users/${result.id}`;
        // Track bulkId → SCIM id for cross-references
        if (op.bulkId) {
          bulkIdMap.set(op.bulkId, result.id);
        }
        return {
          method: 'POST',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location,
          status: '201',
        };
      }

      case 'PUT': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'PUT operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        if (!data) throw createScimError({ status: 400, detail: 'PUT operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.usersService.replaceUserForEndpoint(resourceId, data as any, baseUrl, endpointId, config, op.version);
        return {
          method: 'PUT',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location: `${baseUrl}/Users/${result.id}`,
          status: '200',
        };
      }

      case 'PATCH': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'PATCH operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        if (!data) throw createScimError({ status: 400, detail: 'PATCH operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.usersService.patchUserForEndpoint(resourceId, data as any, baseUrl, endpointId, config, op.version);
        return {
          method: 'PATCH',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location: `${baseUrl}/Users/${result.id}`,
          status: '200',
        };
      }

      case 'DELETE': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'DELETE operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        await this.usersService.deleteUserForEndpoint(resourceId, endpointId, config, op.version);
        return {
          method: 'DELETE',
          bulkId: op.bulkId,
          location: `${baseUrl}/Users/${resourceId}`,
          status: '204',
        };
      }

      default:
        throw createScimError({ status: 400, detail: `Unsupported method: ${method}`, scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
    }
  }

  /**
   * Execute a Group operation within a bulk request.
   */
  private async executeGroupOperation(
    method: string,
    resourceId: string | undefined,
    data: Record<string, unknown> | undefined,
    op: BulkOperationDto,
    endpointId: string,
    baseUrl: string,
    config: EndpointConfig,
    bulkIdMap: Map<string, string>,
  ): Promise<BulkOperationResult> {
    switch (method) {
      case 'POST': {
        if (!data) throw createScimError({ status: 400, detail: 'POST operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.groupsService.createGroupForEndpoint(data as any, baseUrl, endpointId, config);
        const location = `${baseUrl}/Groups/${result.id}`;
        if (op.bulkId) {
          bulkIdMap.set(op.bulkId, result.id);
        }
        return {
          method: 'POST',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location,
          status: '201',
        };
      }

      case 'PUT': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'PUT operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        if (!data) throw createScimError({ status: 400, detail: 'PUT operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.groupsService.replaceGroupForEndpoint(resourceId, data as any, baseUrl, endpointId, config, op.version);
        return {
          method: 'PUT',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location: `${baseUrl}/Groups/${result.id}`,
          status: '200',
        };
      }

      case 'PATCH': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'PATCH operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        if (!data) throw createScimError({ status: 400, detail: 'PATCH operation requires data.', scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
        const result = await this.groupsService.patchGroupForEndpoint(resourceId, data as any, baseUrl, endpointId, config, op.version);
        return {
          method: 'PATCH',
          bulkId: op.bulkId,
          version: result.meta?.version,
          location: `${baseUrl}/Groups/${result.id}`,
          status: '200',
        };
      }

      case 'DELETE': {
        if (!resourceId) throw createScimError({ status: 400, detail: 'DELETE operation requires resource ID in path.', scimType: SCIM_ERROR_TYPE.INVALID_PATH });
        await this.groupsService.deleteGroupForEndpoint(resourceId, endpointId, config, op.version);
        return {
          method: 'DELETE',
          bulkId: op.bulkId,
          location: `${baseUrl}/Groups/${resourceId}`,
          status: '204',
        };
      }

      default:
        throw createScimError({ status: 400, detail: `Unsupported method: ${method}`, scimType: SCIM_ERROR_TYPE.INVALID_VALUE });
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Validate that method and path combination is valid.
   * POST requires collection path (no ID), others require resource path (with ID).
   */
  private validateMethodPathConsistency(
    method: string,
    resourceType: string,
    resourceId: string | undefined,
  ): void {
    if (method === 'POST' && resourceId) {
      throw createScimError({
        status: 400,
        detail: `POST operations must target a collection path (e.g., "/${resourceType}"), not a specific resource.`,
        scimType: SCIM_ERROR_TYPE.INVALID_PATH,
      });
    }
    if (method !== 'POST' && !resourceId) {
      throw createScimError({
        status: 400,
        detail: `${method} operations must target a specific resource (e.g., "/${resourceType}/{id}").`,
        scimType: SCIM_ERROR_TYPE.INVALID_PATH,
      });
    }
  }

  /**
   * Resolve "bulkId:<value>" references in a string.
   * Used for path resolution (e.g., "/Users/bulkId:u1" → "/Users/abc-123").
   */
  private resolveBulkIdInString(input: string, map: Map<string, string>): string {
    return input.replace(BULK_ID_REF_PATTERN, (match, id: string) => {
      const resolved = map.get(id);
      if (!resolved) {
        throw createScimError({
          status: 400,
          detail: `Unresolved bulkId reference: "${id}". Referenced bulkId must appear in a prior POST operation.`,
          scimType: SCIM_ERROR_TYPE.INVALID_VALUE,
        });
      }
      return resolved;
    });
  }

  /**
   * Deep-resolve "bulkId:<value>" references in operation data.
   * Walks all string values in the data object and replaces bulkId references.
   */
  private resolveBulkIdInData(
    data: Record<string, unknown>,
    map: Map<string, string>,
  ): Record<string, unknown> {
    if (map.size === 0) return data;

    const resolveValue = (val: unknown): unknown => {
      if (typeof val === 'string') {
        return this.resolveBulkIdInString(val, map);
      }
      if (Array.isArray(val)) {
        return val.map(resolveValue);
      }
      if (val !== null && typeof val === 'object') {
        const resolved: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          resolved[k] = resolveValue(v);
        }
        return resolved;
      }
      return val;
    };

    return resolveValue(data) as Record<string, unknown>;
  }

  /**
   * Build an error result from a caught exception.
   */
  private buildErrorResult(op: BulkOperationDto, error: unknown): BulkOperationResult {
    let status = 500;
    let detail = 'Internal server error';
    let scimType: string | undefined;

    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        detail = (resp.detail as string) ?? (resp.message as string) ?? detail;
        scimType = resp.scimType as string | undefined;
      } else if (typeof response === 'string') {
        detail = response;
      }
    } else if (error instanceof Error) {
      detail = error.message;
    }

    return {
      method: op.method,
      bulkId: op.bulkId,
      status: String(status),
      response: {
        schemas: [SCIM_ERROR_SCHEMA],
        scimType,
        detail,
        status: String(status),
      },
    };
  }
}
