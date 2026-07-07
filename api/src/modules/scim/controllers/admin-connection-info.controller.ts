/**
 * AdminConnectionInfoController (WI-2) - the read-only admin endpoint that
 * assembles an endpoint's full connection-info shape (every absolute URL + the
 * per-method Entra field set) in one call, so no UI hand-builds URLs.
 *
 *   GET /admin/endpoints/:endpointId/connection-info
 *
 * Design: docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md Part 6. The host is
 * derived from the request exactly as the OAuth metadata controllers do
 * (X-Forwarded-Proto / X-Forwarded-Host, falling back to the request host), so
 * every surface agrees on the origin. No secrets are ever returned.
 */
import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../../domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import { EndpointService } from '../../endpoint/services/endpoint.service';
import {
  ConnectionInfoService,
  type ConnectionInfo,
  type ConnectionInfoEndpointInput,
} from '../services/connection-info.service';

@Controller('admin/endpoints')
export class AdminConnectionInfoController {
  constructor(
    private readonly endpointService: EndpointService,
    @Inject(ENDPOINT_CREDENTIAL_REPOSITORY)
    private readonly credentialRepo: IEndpointCredentialRepository,
    private readonly connectionInfo: ConnectionInfoService,
  ) {}

  @Get(':endpointId/connection-info')
  async getConnectionInfo(
    @Param('endpointId') endpointId: string,
    @Req() req: Request,
  ): Promise<ConnectionInfo> {
    let endpoint: ConnectionInfoEndpointInput;
    try {
      endpoint = (await this.endpointService.getEndpoint(endpointId)) as ConnectionInfoEndpointInput;
    } catch {
      throw new NotFoundException(`Endpoint "${endpointId}" not found.`);
    }

    const proto = req.headers['x-forwarded-proto']?.toString() ?? req.protocol;
    const host = req.headers['x-forwarded-host']?.toString() ?? req.get('host');
    const baseUrl = `${proto}://${host}`;

    const credentials = await this.credentialRepo.findByEndpoint(endpointId);
    return this.connectionInfo.assemble(endpoint, credentials, baseUrl);
  }
}
