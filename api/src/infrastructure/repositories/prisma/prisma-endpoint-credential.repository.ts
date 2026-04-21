/**
 * Prisma-backed repository for EndpointCredential (Phase 11).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IEndpointCredentialRepository } from '../../../domain/repositories/endpoint-credential.repository.interface';
import type { EndpointCredentialModel, EndpointCredentialCreateInput } from '../../../domain/models/endpoint-credential.model';

@Injectable()
export class PrismaEndpointCredentialRepository implements IEndpointCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: EndpointCredentialCreateInput): Promise<EndpointCredentialModel> {
    const row = await this.prisma.endpointCredential.create({
      data: {
        endpointId: input.endpointId,
        credentialType: input.credentialType,
        credentialHash: input.credentialHash,
        label: input.label ?? null,
        metadata: input.metadata ? (input.metadata as any) : undefined,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return this.toModel(row);
  }

  async findActiveByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]> {
    const rows = await this.prisma.endpointCredential.findMany({
      where: {
        endpointId,
        active: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    return rows.map((r) => this.toModel(r));
  }

  async findById(id: string): Promise<EndpointCredentialModel | null> {
    try {
      const row = await this.prisma.endpointCredential.findUnique({ where: { id } });
      return row ? this.toModel(row) : null;
    } catch (err) {
      // Invalid UUID format or DB connection error — return null (guard handles 401)
      if (process.env.NODE_ENV !== 'test') {
        console.debug?.('[credential-repo] findById error:', (err as Error).message);
      }
      return null;
    }
  }

  async findByEndpoint(endpointId: string): Promise<EndpointCredentialModel[]> {
    const rows = await this.prisma.endpointCredential.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toModel(r));
  }

  async deactivate(id: string): Promise<EndpointCredentialModel | null> {
    try {
      const row = await this.prisma.endpointCredential.update({
        where: { id },
        data: { active: false },
      });
      return this.toModel(row);
    } catch (err) {
      // Record not found or DB error — return null
      if (process.env.NODE_ENV !== 'test') {
        console.debug?.('[credential-repo] deactivate error:', (err as Error).message);
      }
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.endpointCredential.delete({ where: { id } });
    } catch (err) {
      // Already deleted or invalid ID — no-op, but log for observability
      if (process.env.NODE_ENV !== 'test') {
        console.debug?.('[credential-repo] delete error:', (err as Error).message);
      }
    }
  }

  private toModel(row: any): EndpointCredentialModel {
    return {
      id: row.id,
      endpointId: row.endpointId,
      credentialType: row.credentialType,
      credentialHash: row.credentialHash,
      label: row.label ?? null,
      metadata: row.metadata as Record<string, unknown> | null,
      active: row.active,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt ?? null,
    };
  }
}
