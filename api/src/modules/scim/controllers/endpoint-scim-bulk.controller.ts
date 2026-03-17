/**
 * Endpoint-specific SCIM Bulk Controller — RFC 7644 §3.7
 *
 * POST /scim/endpoints/{endpointId}/Bulk
 *
 * Processes multiple SCIM operations in a single HTTP request.
 * Gated behind the BulkOperationsEnabled per-endpoint config flag.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.7
 */
import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  HttpCode,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { EndpointContextStorage } from '../../endpoint/endpoint-context.storage';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import { BulkProcessorService } from '../services/bulk-processor.service';
import { BulkRequestDto, SCIM_BULK_REQUEST_SCHEMA, BULK_MAX_PAYLOAD_SIZE } from '../dto/bulk-request.dto';
import { createScimError } from '../common/scim-errors';
import { SCIM_ERROR_TYPE } from '../common/scim-constants';
import { buildBaseUrl } from '../common/base-url.util';
import type { BulkResponse } from '../dto/bulk-request.dto';

@Controller('endpoints/:endpointId')
export class EndpointScimBulkController {
  constructor(
    private readonly endpointService: EndpointService,
    private readonly endpointContext: EndpointContextStorage,
    private readonly bulkProcessor: BulkProcessorService,
  ) {}

  /**
   * Validate endpoint exists, is active, and set context.
   * Returns baseUrl and parsed config for downstream use.
   */
  private async validateAndSetContext(
    endpointId: string,
    req: Request,
  ): Promise<{ baseUrl: string; config: EndpointConfig }> {
    const endpoint = await this.endpointService.getEndpoint(endpointId);

    if (!endpoint.active) {
      throw new ForbiddenException(
        `Endpoint "${endpoint.name}" is inactive. SCIM operations are not allowed.`,
      );
    }

    const profile = endpoint.profile;
    const config = (endpoint.profile?.settings ?? {}) as EndpointConfig;
    const baseUrl = `${buildBaseUrl(req)}/endpoints/${endpointId}`;
    this.endpointContext.setContext({ endpointId, baseUrl, profile, config });

    return { baseUrl, config };
  }

  /**
   * POST /scim/endpoints/{endpointId}/Bulk
   *
   * Process a batch of SCIM operations. Requires the BulkOperationsEnabled
   * config flag to be set on the endpoint; returns 403 otherwise.
   *
   * Request body: BulkRequest (RFC 7644 §3.7)
   * Response body: BulkResponse with per-operation results
   */
  @Post('Bulk')
  @HttpCode(200)
  async processBulk(
    @Param('endpointId') endpointId: string,
    @Body() dto: BulkRequestDto,
    @Req() req: Request,
  ): Promise<BulkResponse> {
    const { baseUrl, config } = await this.validateAndSetContext(endpointId, req);

    // ── Derive bulk enablement from profile SPC (D8) ─────────────────────
    const endpoint = await this.endpointService.getEndpoint(endpointId);
    if (!endpoint.profile?.serviceProviderConfig?.bulk?.supported) {
      throw new ForbiddenException(
        'Bulk operations are not enabled for this endpoint. ' +
        'Set bulk.supported=true in the endpoint profile serviceProviderConfig to enable.',
      );
    }

    // ── Validate schema URN ─────────────────────────────────────────────
    if (
      !dto.schemas ||
      !dto.schemas.includes(SCIM_BULK_REQUEST_SCHEMA)
    ) {
      throw createScimError({
        status: 400,
        detail: `Request must include schema "${SCIM_BULK_REQUEST_SCHEMA}" in the schemas array.`,
        scimType: SCIM_ERROR_TYPE.INVALID_VALUE,
      });
    }

    // ── Payload size guard (approximate — based on content-length) ─────
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > BULK_MAX_PAYLOAD_SIZE) {
      throw createScimError({
        status: 413,
        detail: `Bulk request payload (${contentLength} bytes) exceeds maximum allowed size (${BULK_MAX_PAYLOAD_SIZE} bytes).`,
        scimType: SCIM_ERROR_TYPE.TOO_LARGE,
      });
    }

    return this.bulkProcessor.process(
      endpointId,
      dto.Operations,
      baseUrl,
      config,
      dto.failOnErrors ?? 0,
    );
  }
}
