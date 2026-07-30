/**
 * Prisma-backed repository for the WI-6 credential DEK (wrapped, persisted).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type {
  ICredentialDekRepository,
  CredentialDekModel,
  CredentialDekCreateInput,
} from '../../../domain/repositories/credential-dek.repository.interface';

@Injectable()
export class PrismaCredentialDekRepository implements ICredentialDekRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(): Promise<CredentialDekModel | null> {
    const row = await this.prisma.credentialDek.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toModel(row) : null;
  }

  async create(input: CredentialDekCreateInput): Promise<CredentialDekModel> {
    const row = await this.prisma.credentialDek.create({
      data: { wrappedDek: input.wrappedDek, kekSalt: input.kekSalt, active: true },
    });
    return this.toModel(row);
  }

  private toModel(row: {
    id: string;
    wrappedDek: string;
    kekSalt: string;
    active: boolean;
    createdAt: Date;
  }): CredentialDekModel {
    return {
      id: row.id,
      wrappedDek: row.wrappedDek,
      kekSalt: row.kekSalt,
      active: row.active,
      createdAt: row.createdAt,
    };
  }
}
