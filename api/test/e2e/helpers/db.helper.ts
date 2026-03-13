import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../../src/modules/prisma/prisma.service';

/**
 * Truncates all SCIM data tables (Users, Groups, GroupMembers, Endpoints, RequestLogs).
 *
 * ⚠️  Global nuke — incompatible with parallel test execution.
 * Prefer `cleanupEndpoints()` for parallel-safe per-test isolation.
 * Kept for the 2 spec files that test cross-endpoint/admin behavior
 * and must run with `maxWorkers: 1` or in their own shard.
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

// ────────────────────── Parallel-safe cleanup ──────────────────────

/**
 * Deletes specific endpoints and all their child data (resources, members,
 * schemas, request logs) via CASCADE.
 *
 * Safe for parallel execution — only touches data owned by the calling test.
 */
export async function cleanupEndpoints(
  app: INestApplication,
  endpointIds: string[],
): Promise<void> {
  if (endpointIds.length === 0) return;
  const prisma = app.get(PrismaService);

  // RequestLog FK is SET NULL (not CASCADE), so delete explicitly first
  await prisma.$transaction([
    prisma.requestLog.deleteMany({
      where: { endpointId: { in: endpointIds } },
    }),
    prisma.endpoint.deleteMany({
      where: { id: { in: endpointIds } },
    }),
  ]);
}

/**
 * Tracks endpoint IDs created during a test for cleanup in `afterEach`.
 *
 * Usage:
 * ```ts
 * const tracker = new EndpointTracker();
 *
 * beforeEach(() => { tracker.reset(); });
 * afterEach(() => tracker.cleanup(app));
 *
 * // In tests:
 * const id = await createEndpoint(app, token);
 * tracker.track(id);
 * ```
 */
export class EndpointTracker {
  private ids: string[] = [];

  track(endpointId: string): string {
    this.ids.push(endpointId);
    return endpointId;
  }

  reset(): void {
    this.ids = [];
  }

  async cleanup(app: INestApplication): Promise<void> {
    await cleanupEndpoints(app, this.ids);
    this.ids = [];
  }
}
