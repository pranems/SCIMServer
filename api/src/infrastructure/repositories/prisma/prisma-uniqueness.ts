import type { PrismaService } from '../../../modules/prisma/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { assertUnique, uniquenessPayload, type UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import { assertWritePrecondition, type ExpectedVersion } from '../../../domain/repositories/write-precondition';

type Candidate = {
  rawPayload?: string; scimId?: string; externalId?: string | null;
  displayName?: string | null; active?: boolean; userName?: string;
};
type Member = { value: string; type: string | null; display: string | null };
type Scope = { endpointId: string; resourceType: string };

/**
 * The lock is held by PostgreSQL, not this process. READ COMMITTED must read
 * candidates AFTER acquiring it so a waiter observes the previous commit.
 */
export async function withUniqueWrite<T>(
  prisma: PrismaService,
  policy: UniquenessPolicy,
  target: Scope | { id: string; expectedVersion?: ExpectedVersion },
  change: Candidate,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  members?: readonly Member[],
  transaction = false,
  appendMembers = false,
): Promise<T> {
  if (policy.length === 0) {
    return transaction ? prisma.$transaction(write, { maxWait: 10000, timeout: 30000 }) : write(prisma);
  }
  return prisma.$transaction(async (tx) => {
    let scope: Scope;
    if ('id' in target) {
      const identity = (await tx.scimResource.findUnique({ where: { id: target.id }, select: { endpointId: true, resourceType: true, version: true } })) ?? undefined;
      assertWritePrecondition(identity, target.expectedVersion);
      scope = { endpointId: identity.endpointId, resourceType: identity.resourceType };
    } else {
      scope = { endpointId: target.endpointId, resourceType: target.resourceType };
    }
    const namespace = JSON.stringify(['scim-uniqueness', scope.endpointId, scope.resourceType]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
    const resources = await tx.scimResource.findMany({ where: scope, include: { membersAsGroup: true } });
    const previous = 'id' in target ? resources.find((r) => r.id === target.id) : undefined;
    if ('id' in target) assertWritePrecondition(previous, target.expectedVersion);
    const document = (r: typeof resources[number]) => uniquenessPayload({
      ...r, rawPayload: JSON.stringify(r.payload), userName: r.userName ?? undefined,
    }, scope.resourceType === 'Group' ? r.membersAsGroup : undefined);
    const candidate = uniquenessPayload({
      scimId: previous?.scimId ?? '', externalId: previous?.externalId ?? null,
      displayName: previous?.displayName, active: previous?.active,
      userName: previous?.userName ?? undefined, rawPayload: JSON.stringify(previous?.payload ?? {}),
      ...change,
    }, appendMembers ? [...(previous?.membersAsGroup ?? []), ...(members ?? [])]
      : members ?? (scope.resourceType === 'Group' ? previous?.membersAsGroup ?? [] : undefined));
    assertUnique(policy, candidate, resources.filter((r) => r.id !== previous?.id).map(document));
    return write(tx);
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
}
