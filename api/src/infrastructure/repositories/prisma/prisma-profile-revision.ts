import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { assertProfileRevision, type ProfileRevision } from '../../../domain/repositories/profile-revision';

export async function lockEndpointProfile(
  tx: Prisma.TransactionClient,
  endpointId: string,
): Promise<void> {
  const namespace = JSON.stringify(['scim-endpoint-profile', endpointId]);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
}

export async function assertEndpointProfileRevision(
  tx: Prisma.TransactionClient,
  endpointId: string,
  expectedRevision: ProfileRevision | undefined,
): Promise<void> {
  if (expectedRevision === undefined) return;
  await lockEndpointProfile(tx, endpointId);
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
