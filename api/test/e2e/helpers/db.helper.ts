import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../../src/modules/prisma/prisma.service';

/**
 * Truncates all SCIM data tables (Users, Groups, GroupMembers, Endpoints, RequestLogs).
 * Call this in `beforeEach()` to ensure full test isolation.
 *
 * Note: Order matters — delete child tables before parents to respect FK constraints.
 */
export async function resetDatabase(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);

  await prisma.$transaction([
    prisma.requestLog.deleteMany(),
    prisma.resourceMember.deleteMany(),
    prisma.scimResource.deleteMany(),
    prisma.endpoint.deleteMany(),
  ]);
}
