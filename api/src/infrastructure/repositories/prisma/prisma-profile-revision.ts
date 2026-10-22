import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { assertProfileRevision, type ProfileRevision } from '../../../domain/repositories/profile-revision';

export async function lockEndpointProfile(
  tx: Prisma.TransactionClient,
  endpointId: string,
  additionalWriteNamespace?: string,
): Promise<void> {
  const namespace = JSON.stringify(['scim-endpoint-profile', endpointId]);
  if (additionalWriteNamespace === undefined) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
  } else {
    await tx.$executeRaw`
      WITH profile_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))
      )
      SELECT pg_advisory_xact_lock(hashtextextended(${additionalWriteNamespace}, 0))
      FROM profile_lock`;
  }
}

export async function assertEndpointProfileRevision(
  tx: Prisma.TransactionClient,
  endpointId: string,
  expectedRevision: ProfileRevision | undefined,
  additionalWriteNamespace?: string,
): Promise<void> {
  if (expectedRevision === undefined) return;
  await lockEndpointProfile(tx, endpointId, additionalWriteNamespace);
  // A separate statement lets a lock waiter observe the preceding commit.
  if (typeof expectedRevision === 'object') {
    const knownSnapshot = expectedRevision.endpointId === endpointId ? expectedRevision.snapshotRevision : null;
    const [endpoint] = await tx.$queryRaw<{
      profile: Prisma.JsonValue; snapshotRevision: string;
    }[]>`
      SELECT "snapshotRevision"::text AS "snapshotRevision",
             CASE WHEN "snapshotRevision" = ${knownSnapshot}::uuid
                  THEN NULL ELSE profile END AS profile
      FROM "Endpoint" WHERE id = ${endpointId}::uuid
    `;
    if (!endpoint) throw new EndpointNotFoundError();
    assertProfileRevision(endpoint.profile, expectedRevision, {
      endpointId, snapshotRevision: endpoint.snapshotRevision,
    });
    return;
  }
  const endpoint = await tx.endpoint.findUnique({
    where: { id: endpointId },
    select: { profile: true },
  });
  if (!endpoint) throw new EndpointNotFoundError();
  assertProfileRevision(endpoint.profile, expectedRevision);
}

export async function withEndpointProfileLock<T>(
  prisma: PrismaService,
  endpointId: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async tx => {
    await lockEndpointProfile(tx, endpointId);
    return write(tx);
  }, { maxWait: 10000, timeout: 30000 });
}
