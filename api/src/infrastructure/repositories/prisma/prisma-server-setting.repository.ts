/**
 * Prisma-backed repository for the WI-7 server-global settings.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../modules/prisma/prisma.service';
import type { IServerSettingRepository } from '../../../domain/repositories/server-setting.repository.interface';

@Injectable()
export class PrismaServerSettingRepository implements IServerSettingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.serverSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.serverSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
