/**
 * Prisma-backed repository for the WI-15 JWKS host allowlist (persisted layer).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IJwksHostAllowlistRepository } from '../../../domain/repositories/jwks-host-allowlist.repository.interface';
import type { JwksHostAllowlistEntryModel } from '../../../domain/repositories/jwks-host-allowlist.repository.interface';

@Injectable()
export class PrismaJwksHostAllowlistRepository implements IJwksHostAllowlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<JwksHostAllowlistEntryModel[]> {
    const rows = await this.prisma.jwksHostAllowlistEntry.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toModel(r));
  }

  async add(host: string, label: string | null): Promise<JwksHostAllowlistEntryModel> {
    const normalized = host.trim().toLowerCase();
    // Idempotent on the unique host - upsert so a re-add is a no-op.
    const row = await this.prisma.jwksHostAllowlistEntry.upsert({
      where: { host: normalized },
      update: {},
      create: { host: normalized, label: label ?? null },
    });
    return this.toModel(row);
  }

  async removeByHost(host: string): Promise<boolean> {
    const normalized = host.trim().toLowerCase();
    const result = await this.prisma.jwksHostAllowlistEntry.deleteMany({
      where: { host: normalized },
    });
    return result.count > 0;
  }

  async update(id: string, host: string, label: string | null): Promise<JwksHostAllowlistEntryModel | null> {
    const normalized = host.trim().toLowerCase();
    const existing = await this.prisma.jwksHostAllowlistEntry.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.prisma.jwksHostAllowlistEntry.update({
      where: { id },
      data: { host: normalized, label: label ?? null },
    });
    return this.toModel(row);
  }

  private toModel(row: {
    id: string;
    host: string;
    label: string | null;
    createdAt: Date;
  }): JwksHostAllowlistEntryModel {
    return { id: row.id, host: row.host, label: row.label, createdAt: row.createdAt };
  }
}
