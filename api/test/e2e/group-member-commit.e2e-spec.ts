import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { PrismaGroupRepository } from '../../src/infrastructure/repositories/prisma/prisma-group.repository';
import { observeWriteVersion } from '../../src/domain/repositories/write-precondition';
import type { MemberCreateInput } from '../../src/domain/models/group.model';

const describePostgres = process.env.PERSISTENCE_BACKEND === 'inmemory' ? describe.skip : describe;

describePostgres('Atomic Group membership replacement statement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: PrismaGroupRepository;
  let endpointId: string;
  let groupId: string;
  const member: MemberCreateInput = {
    userId: null, value: 'external-member', type: 'User', display: 'Before',
    reference: 'https://example.test/Users/external-member',
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    repo = new PrismaGroupRepository(prisma);
  });

  beforeEach(async () => {
    const endpoint = await prisma.endpoint.create({ data: { name: `commit-${randomUUID()}` } });
    endpointId = endpoint.id;
    const group = await prisma.scimResource.create({
      data: {
        endpointId, resourceType: 'Group', scimId: randomUUID(),
        displayName: 'Before', payload: {}, meta: '{}',
      },
    });
    groupId = group.id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (endpointId) await prisma.endpoint.deleteMany({ where: { id: endpointId } });
  });

  afterAll(async () => { if (app) await app.close(); });

  it('uses two storage statements for parent CAS and populated membership replacement', async () => {
    const original = prisma.$transaction.bind(prisma);
    let statements = 0;
    let transactions = 0;
    jest.spyOn(prisma, '$transaction').mockImplementation((work, options) =>
      original(async tx => {
        transactions++;
        const update = jest.spyOn(tx.scimResource, 'update');
        const remove = jest.spyOn(tx.resourceMember, 'deleteMany');
        const insert = jest.spyOn(tx.resourceMember, 'createManyAndReturn');
        const raw = jest.spyOn(tx, '$queryRaw');
        try {
          return await work(tx);
        } finally {
          statements += update.mock.calls.length + remove.mock.calls.length +
            insert.mock.calls.length + raw.mock.calls.length;
          update.mockRestore();
          remove.mockRestore();
          insert.mockRestore();
          raw.mockRestore();
        }
      }, options));
    const committed = await repo.updateGroupWithMembers(groupId, { displayName: 'After' }, [member], 1);
    expect(committed).toMatchObject({ displayName: 'After', version: 2, members: [member] });
    expect(transactions).toBe(1);
    expect(statements).toBe(2);
  });

  it('deletes the old unique value before reinserting and returns this commit with native dates', async () => {
    const before = await repo.updateGroupWithMembers(groupId, {}, [member], 1);
    const changed = { ...member, type: 'Group', display: 'After', reference: null };
    const committed = await repo.updateGroupWithMembers(groupId, {
      displayName: 'After', externalId: 'external', active: false,
      rawPayload: '{"marker":"after"}', meta: '{"resourceType":"Group"}',
    }, [changed], observeWriteVersion(2, undefined, { endpointId, resourceType: 'Group' }));
    expect(committed).toMatchObject({
      displayName: 'After', externalId: 'external', active: false, version: 3,
      rawPayload: '{"marker":"after"}', meta: '{"resourceType":"Group"}', members: [changed],
    });
    expect(committed.members[0].id).not.toBe(before.members[0].id);
    expect(committed.createdAt).toBeInstanceOf(Date);
    expect(committed.updatedAt).toBeInstanceOf(Date);
    expect(committed.members[0].createdAt).toBeInstanceOf(Date);
    expect(Number.isFinite(committed.members[0].createdAt.getTime())).toBe(true);
    const stored = await prisma.resourceMember.findMany({ where: { groupResourceId: groupId } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: committed.members[0].id, groupResourceId: groupId,
      memberResourceId: null, value: member.value, type: 'Group', display: 'After', reference: null,
      createdAt: committed.members[0].createdAt,
    });
  });

  it('retains the empty-replacement path and removes every prior member', async () => {
    await repo.updateGroupWithMembers(groupId, {}, [member], 1);
    const committed = await repo.updateGroupWithMembers(groupId, { displayName: 'Empty' }, [], 2);
    expect(committed).toMatchObject({ displayName: 'Empty', version: 3, members: [] });
    expect(await prisma.resourceMember.count({ where: { groupResourceId: groupId } })).toBe(0);
  });

  it.each(['duplicate', 'foreign-key'] as const)(
    'rolls parent and children back together after a late %s failure',
    async kind => {
      await repo.updateGroupWithMembers(groupId, {}, [member], 1);
      const before = await prisma.scimResource.findUniqueOrThrow({
        where: { id: groupId }, include: { membersAsGroup: true },
      });
      const invalid = kind === 'duplicate' ? [member, member]
        : [{ ...member, userId: randomUUID() }];
      const attempt = repo.updateGroupWithMembers(groupId, {
        displayName: 'Must roll back',
      }, invalid, 2);
      if (kind === 'duplicate') await expect(attempt).rejects.toMatchObject({
        code: 'CONFLICT',
        cause: { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23505' } } } },
      });
      else await expect(attempt).rejects.toThrow();
      expect(await prisma.scimResource.findUniqueOrThrow({
        where: { id: groupId }, include: { membersAsGroup: true },
      })).toEqual(before);
    },
  );

  it.each(['version', 'scope'] as const)(
    'does not change parent or members when observed %s no longer matches',
    async kind => {
      await repo.updateGroupWithMembers(groupId, {}, [member], 1);
      const before = await prisma.scimResource.findUniqueOrThrow({
        where: { id: groupId }, include: { membersAsGroup: true },
      });
      const expected = observeWriteVersion(kind === 'version' ? 1 : 2, undefined, {
        endpointId: kind === 'scope' ? randomUUID() : endpointId, resourceType: 'Group',
      });
      await expect(repo.updateGroupWithMembers(groupId, {
        displayName: 'Must not commit',
      }, [], expected)).rejects.toMatchObject({ code: 'WRITE_CONFLICT' });
      expect(await prisma.scimResource.findUniqueOrThrow({
        where: { id: groupId }, include: { membersAsGroup: true },
      })).toEqual(before);
    },
  );
});
