import type { PrismaService } from '../../../modules/prisma/prisma.service';
import type { Prisma, ScimResource } from '../../../generated/prisma/client';
import { EndpointNotFoundError } from '../../../domain/errors/endpoint-not-found.error';
import { assertUnique, uniquenessPayload, type UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';
import { assertWritePrecondition, observedWriteScope, type ExpectedVersion } from '../../../domain/repositories/write-precondition';
import { assertProfileRevision, type ProfileRevision } from '../../../domain/repositories/profile-revision';
import { assertEndpointProfileRevision, lockEndpointProfile } from './prisma-profile-revision';

type Candidate = {
  rawPayload?: string; scimId?: string; externalId?: string | null;
  displayName?: string | null; active?: boolean; userName?: string;
};
type Member = { value: string; type: string | null; display: string | null };
type Scope = { endpointId: string; resourceType: string };
type NamespaceResource = Pick<ScimResource,
  'id' | 'endpointId' | 'resourceType' | 'version' | 'scimId' | 'externalId' |
  'displayName' | 'active' | 'userName' | 'payload'> & { membersAsGroup?: Member[] };
interface UniqueWriteOptions {
  members?: readonly Member[];
  transaction?: boolean;
  appendMembers?: boolean;
  representation?: 'columns' | 'payload';
  expectedProfileRevision?: ProfileRevision;
}

async function readProfileAndNamespace(
  tx: Prisma.TransactionClient,
  scope: Scope,
  needsMembers: boolean,
  expectedRevision: ProfileRevision,
): Promise<NamespaceResource[]> {
  const knownSnapshot = typeof expectedRevision === 'object' && expectedRevision.endpointId === scope.endpointId
    ? expectedRevision.snapshotRevision : null;
  const [snapshot] = await tx.$queryRaw<{
    profile: Prisma.JsonValue;
    snapshotRevision: string;
    resources: NamespaceResource[];
  }[]>`
    SELECT e."snapshotRevision"::text AS "snapshotRevision",
      CASE WHEN e."snapshotRevision" = ${knownSnapshot}::uuid
           THEN NULL ELSE e."profile" END AS profile, COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r."id", 'endpointId', r."endpointId", 'resourceType', r."resourceType",
        'version', r."version", 'scimId', r."scimId", 'externalId', r."externalId",
        'displayName', r."displayName", 'active', r."active",
        'userName', r."userName", 'payload', r."payload"
      ) || CASE WHEN ${needsMembers} THEN jsonb_build_object('membersAsGroup', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'value', m."value", 'type', m."type", 'display', m."display"
        ))
        FROM "ResourceMember" m WHERE m."groupResourceId" = r."id"
      ), '[]'::jsonb)) ELSE '{}'::jsonb END)
      FROM "ScimResource" r
      WHERE r."endpointId" = e."id" AND r."resourceType" = ${scope.resourceType}
    ), '[]'::jsonb) AS resources
    FROM "Endpoint" e WHERE e."id" = ${scope.endpointId}::uuid`;
  if (!snapshot) throw new EndpointNotFoundError();
  assertProfileRevision(snapshot.profile, expectedRevision, {
    endpointId: scope.endpointId, snapshotRevision: snapshot.snapshotRevision,
  });
  return snapshot.resources;
}

/**
 * The lock is held by PostgreSQL, not this process. READ COMMITTED must read
 * candidates AFTER acquiring it so a waiter observes the previous commit.
 */
export async function withUniqueWrite<T>(
  prisma: PrismaService,
  declaredPolicy: UniquenessPolicy,
  target: Scope | { id: string; expectedVersion?: ExpectedVersion },
  change: Candidate,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  options: UniqueWriteOptions = {},
): Promise<T> {
  // The UUID unique constraint on (endpointId, scimId) is authoritative for the common id only.
  const policy = declaredPolicy.filter(attribute => !(attribute.schemaUrn === null &&
    attribute.type === 'string' && attribute.path.length === 1 &&
    attribute.path[0].name.toLowerCase() === 'id' && !attribute.path[0].multiValued));
  const {
    members,
    transaction = false,
    appendMembers = false,
    representation = 'columns',
    expectedProfileRevision,
  } = options;
  const execute = async (tx: Prisma.TransactionClient): Promise<T> => {
    try {
      return await write(tx);
    } catch (error) {
      if ('id' in target && typeof target.expectedVersion === 'object' &&
          target.expectedVersion.ifMatch === '*' &&
          error !== null && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        const current = await tx.scimResource.findUnique({
          where: { id: target.id, ...observedWriteScope(target.expectedVersion) },
          select: { version: true, endpointId: true, resourceType: true },
        });
        assertWritePrecondition(current ?? undefined, target.expectedVersion);
      }
      throw error;
    }
  };
  if (policy.length === 0 && expectedProfileRevision === undefined) {
    return transaction ? prisma.$transaction(execute, { maxWait: 10000, timeout: 30000 }) : execute(prisma);
  }
  return prisma.$transaction(async (tx) => {
    let scope: Scope;
    if ('id' in target) {
      const observed = observedWriteScope(target.expectedVersion);
      if (observed) {
        scope = { ...observed };
      } else {
        const identity = (await tx.scimResource.findUnique({ where: { id: target.id }, select: { endpointId: true, resourceType: true, version: true } })) ?? undefined;
        assertWritePrecondition(identity, target.expectedVersion);
        scope = { endpointId: identity.endpointId, resourceType: identity.resourceType };
      }
    } else {
      scope = { endpointId: target.endpointId, resourceType: target.resourceType };
    }
    const namespace = JSON.stringify(['scim-uniqueness', scope.endpointId, scope.resourceType]);
    const needsMembers = representation === 'columns' && scope.resourceType === 'Group' &&
      policy.some((attribute) => attribute.schemaUrn === null &&
        attribute.path[0]?.name.toLowerCase() === 'members');
    let resources: NamespaceResource[];
    if (expectedProfileRevision !== undefined && policy.length > 0) {
      await lockEndpointProfile(tx, scope.endpointId, namespace);
      // This post-lock statement gives waiters a fresh, shared data snapshot.
      resources = await readProfileAndNamespace(tx, scope, needsMembers, expectedProfileRevision);
    } else {
      await assertEndpointProfileRevision(tx, scope.endpointId, expectedProfileRevision);
      if (policy.length === 0) return execute(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${namespace}, 0))`;
      resources = await tx.scimResource.findMany({ where: scope, include: { membersAsGroup: needsMembers } });
    }
    const previous = 'id' in target ? resources.find((r) => r.id === target.id) : undefined;
    if ('id' in target) assertWritePrecondition(previous, target.expectedVersion);
    const document = (r: typeof resources[number]) => uniquenessPayload({
      ...r, rawPayload: JSON.stringify(r.payload), userName: r.userName ?? undefined,
    }, scope.resourceType === 'Group' ? r.membersAsGroup : undefined, representation);
    const candidate = uniquenessPayload({
      scimId: previous?.scimId ?? '', externalId: previous?.externalId ?? null,
      displayName: previous?.displayName, active: previous?.active,
      userName: previous?.userName ?? undefined, rawPayload: JSON.stringify(previous?.payload ?? {}),
      ...change,
    }, appendMembers ? [...(previous?.membersAsGroup ?? []), ...(members ?? [])]
      : members ?? (scope.resourceType === 'Group' ? previous?.membersAsGroup ?? [] : undefined), representation);
    assertUnique(policy, candidate, resources.filter((r) => r.id !== previous?.id).map(document));
    return execute(tx);
  }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 30000 });
}
