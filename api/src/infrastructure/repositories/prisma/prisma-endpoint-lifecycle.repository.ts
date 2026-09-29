import { Injectable } from '@nestjs/common';
import type { IEndpointLifecycleRepository } from '../../../domain/repositories/endpoint-lifecycle.repository.interface';
import { PrismaService } from '../../../modules/prisma/prisma.service';

@Injectable()
export class PrismaEndpointLifecycleRepository implements IEndpointLifecycleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deleteEndpoint(endpointId: string): Promise<void> {
    // One FK-backed statement cascades resources, memberships and credentials.
    // RequestLog has no endpoint FK and remains an audit correlation record.
    await this.prisma.endpoint.delete({ where: { id: endpointId } });
  }
}
