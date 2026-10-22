/**
 * PrismaGroupRepository - Unit tests for Phase 3 PostgreSQL migration.
 *
 * Verifies that all queries target `scimResource` with `resourceType: 'Group'`,
 * that members use `resourceMember` (not `groupMember`), and that the mapping
 * from ScimResource/ResourceMember → GroupRecord/MemberRecord is correct.
 * PostgreSQL CITEXT handles case-insensitive displayName; payload stored as JSONB.
 */
import { PrismaGroupRepository } from './prisma-group.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';
import { RepositoryError } from '../../../domain/errors/repository-error';
import type { UniquenessPolicy } from '../../../domain/repositories/uniqueness-policy';

// ─── Factory helpers ──────────────────────────────────────────────────────────

function createMockPrismaService(): PrismaService {
  return {
    scimResource: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    resourceMember: {
      createMany: jest.fn(),
      createManyAndReturn: jest.fn(),
      deleteMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([fakeResourceMember()]),
        scimResource: {
          update: jest.fn().mockResolvedValue(fakeGroupResource({ version: 2 })),
        },
        resourceMember: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
          createManyAndReturn: jest.fn().mockResolvedValue([fakeResourceMember()]),
        },
      };
      return fn(tx);
    }),
  } as unknown as PrismaService;
}

// Valid UUID constants used in tests - PostgreSQL UUID columns reject non-UUID strings
const GRP_SCIM_ID = '10000000-0000-4000-a000-000000000001';

function fakeGroupResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    endpointId: 'ep-1',
    resourceType: 'Group',
    scimId: GRP_SCIM_ID,
    externalId: null,
    userName: null,
    displayName: 'Engineering',
    active: true,
    payload: {},
    version: 1,
    meta: '{"resourceType":"Group"}',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function fakeResourceMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    groupResourceId: 'grp-1',
    memberResourceId: 'user-res-1',
    value: 'user-scim-1',
    type: 'User',
    display: 'Alice',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('PrismaGroupRepository (Phase 2 - unified table)', () => {
  let repo: PrismaGroupRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new PrismaGroupRepository(prisma);
  });

  describe('single-statement group snapshot', () => {
    it('reads the scoped aggregate once without a second relation query', async () => {
      const createdAt = Date.parse('2025-01-01T00:00:00.123Z');
      const resource = fakeGroupResource({
        membersAsGroup: [fakeResourceMember({ createdAt, reference: 'urn:example:member:1' })],
      });
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([resource]);
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue({
        ...resource, membersAsGroup: [fakeResourceMember()],
      });

      const result = await repo.findWithMembers('ep-1', GRP_SCIM_ID);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [parts, scimId, endpointId] = (prisma.$queryRaw as jest.Mock).mock.calls[0] as [
        TemplateStringsArray, string, string,
      ];
      expect(parts.join('?')).toContain('r."resourceType" = \'Group\'');
      expect(parts.join('?')).toContain('m."groupResourceId" = r."id"');
      expect(scimId).toBe(GRP_SCIM_ID);
      expect(endpointId).toBe('ep-1');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 'grp-1', displayName: 'Engineering', version: 1,
        members: [{ id: 'mem-1', value: 'user-scim-1', reference: 'urn:example:member:1', createdAt: new Date(createdAt) }],
      });
    });

    it('returns empty persisted membership and not-found without a fallback query', async () => {
      (prisma.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([fakeGroupResource({ membersAsGroup: [] })])
        .mockResolvedValueOnce([]);
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(fakeGroupResource());

      expect((await repo.findWithMembers('ep-1', GRP_SCIM_ID))?.members).toEqual([]);
      expect(await repo.findWithMembers('ep-1', GRP_SCIM_ID)).toBeNull();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it.each([NaN, Number.MAX_VALUE])('surfaces invalid member timestamp %s', async (createdAt) => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        fakeGroupResource({ membersAsGroup: [fakeResourceMember({ createdAt })] }),
      ]);
      await expect(repo.findWithMembers('ep-1', GRP_SCIM_ID)).rejects.toThrow('invalid timestamps');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });
  });

  it('reconstructs the exact persisted reference and legacy null without a synthetic URL', async () => {
    const reference = 'https://scim.example.test/Users/user-scim-1?source=import';
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([fakeGroupResource({
      membersAsGroup: [fakeResourceMember({ reference, createdAt: Date.parse('2025-01-01T00:00:00Z') })],
    })]);
    expect((await repo.findWithMembers('ep-1', GRP_SCIM_ID))?.members).toMatchObject([{ reference }]);
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([fakeGroupResource({
      membersAsGroup: [fakeResourceMember({ reference: null, createdAt: Date.parse('2025-01-01T00:00:00Z') })],
    })]);
    expect((await repo.findWithMembers('ep-1', GRP_SCIM_ID))?.members).toMatchObject([{ reference: null }]);
  });

  // ─── create ──────────────────────────────────────────────────────────

  describe('uniqueness relation projection', () => {
    const input = {
      endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
      displayName: 'Engineering', rawPayload: '{}', meta: '{}',
    };
    const policy = (name: string, schemaUrn: string | null = null): UniquenessPolicy => [{
      schemaUrn,
      path: [{ name, multiValued: name.toLowerCase() === 'members' }],
      type: 'string',
      caseExact: false,
    }];

    beforeEach(() => {
      jest.spyOn(prisma, '$transaction').mockImplementation(async (work) => work(prisma));
      jest.spyOn(prisma.scimResource, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.scimResource, 'create').mockResolvedValue(fakeGroupResource());
    });

    it.each(['id', 'ID'])('delegates common %s uniqueness to the scoped UUID constraint without namespace scans', async name => {
      await repo.create(input, [], policy(name));
      expect(prisma.scimResource.findMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(prisma.scimResource.create).toHaveBeenCalledTimes(1);
    });

    it('retains software uniqueness for an extension id homonym', async () => {
      const schemaUrn = 'urn:example:external-id';
      await repo.create({ ...input, rawPayload: JSON.stringify({ [schemaUrn]: { id: 'partner-id' } }) },
        [], policy('id', schemaUrn));
      expect(prisma.scimResource.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('retains software uniqueness for a nested id path', async () => {
      const path = [{ name: 'parent', multiValued: false }, { name: 'id', multiValued: false }];
      await repo.create(input, [], [{ schemaUrn: null, path, type: 'string', caseExact: true }]);
      expect(prisma.scimResource.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('does not silently discard an incompatible multi-valued common id declaration', async () => {
      await expect(repo.create(input, [], [{
        schemaUrn: null, path: [{ name: 'id', multiValued: true }], type: 'string', caseExact: true,
      }])).rejects.toMatchObject({ code: 'INVALID_VALUE' });
      expect(prisma.scimResource.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.scimResource.create).not.toHaveBeenCalled();
    });

    it('retains software uniqueness for a differently typed id declaration', async () => {
      await repo.create(input, [], [{
        schemaUrn: null, path: [{ name: 'id', multiValued: false }], type: 'reference', caseExact: true,
      }]);
      expect(prisma.scimResource.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('retains the residual displayName policy when common id is database-enforced', async () => {
      jest.spyOn(prisma.scimResource, 'findMany').mockResolvedValue([fakeGroupResource({ id: 'existing-group' })]);
      await expect(repo.create(input,
        [], [...policy('id'), ...policy('displayName')])).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.scimResource.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.scimResource.create).not.toHaveBeenCalled();
    });

    it('does not fetch member relations for displayName uniqueness', async () => {
      await repo.create(input, [], policy('displayName'));
      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: { endpointId: 'ep-1', resourceType: 'Group' },
        include: { membersAsGroup: false },
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('still rejects a conflicting displayName without loading member relations', async () => {
      jest.spyOn(prisma.scimResource, 'findMany').mockResolvedValue([
        fakeGroupResource({ id: 'existing-group' }),
      ]);
      await expect(repo.create(input, [], policy('displayName'))).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.scimResource.create).not.toHaveBeenCalled();
    });

    it('does not load core members for an extension member-named attribute', async () => {
      const extension = 'urn:example:group';
      await repo.create({
        ...input,
        rawPayload: JSON.stringify({ [extension]: { members: ['external-value'] } }),
      }, [], policy('members', extension));
      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: { endpointId: 'ep-1', resourceType: 'Group' },
        include: { membersAsGroup: false },
      });
    });

    it.each(['members', 'MeMbErS'])('keeps %s relation uniqueness authoritative', async (name) => {
      const memberPolicy: UniquenessPolicy = [{
        ...policy(name)[0],
        path: [{ name, multiValued: true }, { name: 'value', multiValued: false }],
      }];
      jest.spyOn(prisma.scimResource, 'findMany').mockResolvedValue([
        fakeGroupResource({ id: 'existing-group', membersAsGroup: [fakeResourceMember()] }),
      ]);
      await expect(repo.create(input, [{
        userId: null, value: 'user-scim-1', type: 'User', display: 'Alice',
      }], memberPolicy)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: { endpointId: 'ep-1', resourceType: 'Group' },
        include: { membersAsGroup: true },
      });
      expect(prisma.scimResource.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates the Group and initial members using the same transaction client', async () => {
      const tx = {
        scimResource: { create: jest.fn().mockResolvedValue(fakeGroupResource()) },
        resourceMember: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (work: (client: unknown) => Promise<unknown>) => work(tx));
      const input = { endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', rawPayload: '{}', meta: '{}' };
      const members = [{ userId: null, value: 'external-member', type: 'User', display: 'Member' }];
      const result = await Reflect.apply(repo.create, repo, [input, members]);
      expect(result).toMatchObject({ id: 'grp-1', version: 1 });
      expect(prisma.scimResource.create).not.toHaveBeenCalled();
      expect(prisma.resourceMember.createMany).not.toHaveBeenCalled();
      expect(tx.scimResource.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        endpoint: { connect: { id: 'ep-1' } }, resourceType: 'Group', payload: {},
      }) });
      expect(tx.resourceMember.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ groupResourceId: 'grp-1', memberResourceId: null, value: 'external-member' })],
      });
    });

    it('propagates a typed membership constraint failure out of the create transaction', async () => {
      const tx = {
        scimResource: { create: jest.fn().mockResolvedValue(fakeGroupResource()) },
        resourceMember: { createMany: jest.fn().mockRejectedValue(Object.assign(new Error('constraint'), { code: 'P2002' })) },
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (work: (client: unknown) => Promise<unknown>) => work(tx));
      await expect(Reflect.apply(repo.create, repo, [{
        endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', rawPayload: '{}', meta: '{}',
      }, [{ userId: null, value: 'one', type: null, display: null }]]))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      expect(tx.scimResource.create).toHaveBeenCalledTimes(1);
      expect(tx.resourceMember.createMany).toHaveBeenCalledTimes(1);
    });

    it('should insert with resourceType "Group" into scimResource', async () => {
      const input = {
        endpointId: 'ep-1',
        scimId: GRP_SCIM_ID,
        externalId: null,
        displayName: 'Engineering',
        active: true,
        rawPayload: '{}',
        meta: '{}',
      };

      const dbRow = fakeGroupResource(input);
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create(input);

      expect(prisma.scimResource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: 'Group',
          displayName: 'Engineering',
          endpoint: { connect: { id: 'ep-1' } },
        }),
      });
      expect(result.displayName).toBe('Engineering');
    });

    it('should map ScimResource row to GroupRecord (no resourceType/version)', async () => {
      const dbRow = fakeGroupResource();
      (prisma.scimResource.create as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.create({
        endpointId: 'ep-1',
        scimId: GRP_SCIM_ID,
        externalId: null,
        displayName: 'Engineering',
        active: true,
        rawPayload: '{}',
        meta: '{}',
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'grp-1',
          displayName: 'Engineering',
        }),
      );
      expect(result).not.toHaveProperty('resourceType');
      expect(result).toHaveProperty('version', 1);
    });

    it('should throw RepositoryError CONFLICT on P2002 unique constraint', async () => {
      const prismaError = Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toThrow(RepositoryError);

      await expect(repo.create({
        endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('should throw RepositoryError CONNECTION on P1001 connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'CONNECTION' });
    });

    it('should throw RepositoryError UNKNOWN on unexpected Prisma error', async () => {
      const prismaError = Object.assign(new Error('Something bad'), { code: 'P9999' });
      (prisma.scimResource.create as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.create({
        endpointId: 'ep-1', scimId: GRP_SCIM_ID, externalId: null,
        displayName: 'Engineering', active: true,
        rawPayload: '{}', meta: '{}',
      })).rejects.toMatchObject({ code: 'UNKNOWN' });
    });
  });

  // ─── findByScimId ────────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should query scimResource with resourceType: Group', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(fakeGroupResource());

      await repo.findByScimId('ep-1', GRP_SCIM_ID);

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { scimId: GRP_SCIM_ID, endpointId: 'ep-1', resourceType: 'Group' },
      });
    });

    it('should return null for non-UUID scimId without hitting DB', async () => {
      expect(await repo.findByScimId('ep-1', 'nonexistent')).toBeNull();
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when not found (valid UUID)', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await repo.findByScimId('ep-1', GRP_SCIM_ID)).toBeNull();
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByScimId('ep-1', GRP_SCIM_ID))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findWithMembers ─────────────────────────────────────────────────

  describe('findWithMembers', () => {
    it('should return null for non-UUID scimId without hitting DB', async () => {
      expect(await repo.findWithMembers('ep-1', 'does-not-exist')).toBeNull();
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('should include membersAsGroup relation', async () => {
      const dbRow = {
        ...fakeGroupResource(),
        membersAsGroup: [fakeResourceMember({ createdAt: Date.parse('2025-01-01T00:00:00Z') })],
      };
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([dbRow]);

      const result = await repo.findWithMembers('ep-1', GRP_SCIM_ID);

      expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.any(Array), GRP_SCIM_ID, 'ep-1');
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();

      expect(result).not.toBeNull();
      expect(result!.members).toHaveLength(1);
    });

    it('should map ResourceMember → MemberRecord (groupResourceId → groupId, memberResourceId → userId)', async () => {
      const dbRow = {
        ...fakeGroupResource(),
        membersAsGroup: [
          fakeResourceMember({
            id: 'mem-42',
            groupResourceId: 'grp-1',
            memberResourceId: 'user-res-99',
            value: 'user-scim-99',
            type: 'User',
            display: 'Bob',
            createdAt: Date.parse('2025-01-01T00:00:00Z'),
          }),
        ],
      };
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([dbRow]);

      const result = await repo.findWithMembers('ep-1', GRP_SCIM_ID);
      const member = result!.members[0];

      expect(member.id).toBe('mem-42');
      expect(member.groupId).toBe('grp-1');
      expect(member.userId).toBe('user-res-99');
      expect(member.value).toBe('user-scim-99');
      expect(member.type).toBe('User');
      expect(member.display).toBe('Bob');
      expect(member.createdAt.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should handle null memberResourceId', async () => {
      const dbRow = {
        ...fakeGroupResource(),
        membersAsGroup: [fakeResourceMember({ memberResourceId: null, createdAt: Date.parse('2025-01-01T00:00:00Z') })],
      };
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([dbRow]);

      const result = await repo.findWithMembers('ep-1', GRP_SCIM_ID);
      expect(result!.members[0].userId).toBeNull();
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findWithMembers('ep-1', GRP_SCIM_ID))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findAllWithMembers ──────────────────────────────────────────────

  describe('findAllWithMembers', () => {
    it('should include resourceType: Group in where and include membersAsGroup', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAllWithMembers('ep-1');

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ endpointId: 'ep-1', resourceType: 'Group' }),
        orderBy: { createdAt: 'asc' },
        include: { membersAsGroup: true },
      });
    });

    it('should merge dbFilter with resourceType', async () => {
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue([]);

      await repo.findAllWithMembers('ep-1', { displayName: 'Engineering' });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          displayName: 'Engineering',
          resourceType: 'Group',
        }),
        orderBy: { createdAt: 'asc' },
        include: { membersAsGroup: true },
      });
    });

    it('should map all returned rows to GroupWithMembers[]', async () => {
      const rows = [
        { ...fakeGroupResource({ id: 'g1', displayName: 'Team A' }), membersAsGroup: [] },
        {
          ...fakeGroupResource({ id: 'g2', displayName: 'Team B' }),
          membersAsGroup: [fakeResourceMember()],
        },
      ];
      (prisma.scimResource.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await repo.findAllWithMembers('ep-1');
      expect(result).toHaveLength(2);
      expect(result[0].displayName).toBe('Team A');
      expect(result[0].members).toHaveLength(0);
      expect(result[1].displayName).toBe('Team B');
      expect(result[1].members).toHaveLength(1);
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.findMany as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findAllWithMembers('ep-1'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  describe('countByEndpoint', () => {
    it('aggregates total and active groups without loading group members', async () => {
      (prisma.scimResource.groupBy as jest.Mock).mockResolvedValue([
        { endpointId: 'ep-1', active: true, _count: { _all: 3 } },
        { endpointId: 'ep-1', active: false, _count: { _all: 2 } },
      ]);

      await expect(repo.countByEndpoint()).resolves.toEqual([
        { endpointId: 'ep-1', total: 5, active: 3 },
      ]);
      expect(prisma.scimResource.groupBy).toHaveBeenCalledWith({
        by: ['endpointId', 'active'],
        where: { resourceType: 'Group' },
        _count: { _all: true },
      });
      expect(prisma.scimResource.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update scimResource by id', async () => {
      const dbRow = fakeGroupResource({ displayName: 'Updated' });
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.update('grp-1', { displayName: 'Updated' });

      expect(prisma.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'grp-1' },
        data: { displayName: 'Updated', version: { increment: 1 } },
      });
      expect(result.displayName).toBe('Updated');
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete from scimResource by id', async () => {
      (prisma.scimResource.delete as jest.Mock).mockResolvedValue({});

      await repo.delete('grp-1');

      expect(prisma.scimResource.delete).toHaveBeenCalledWith({
        where: { id: 'grp-1' },
      });
    });
  });

  // ─── findByDisplayName ───────────────────────────────────────────────

  describe('findByDisplayName', () => {
    it('should scope to resourceType Group', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findByDisplayName('ep-1', 'engineering');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          endpointId: 'ep-1',
          resourceType: 'Group',
          displayName: 'engineering',
        }),
        select: { scimId: true, active: true },
      });
    });

    it('should exclude a specific scimId', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findByDisplayName('ep-1', 'engineering', 'exclude-me');

      const call = (prisma.scimResource.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where.NOT).toEqual({ scimId: 'exclude-me' });
    });

    it('should throw RepositoryError CONNECTION on Prisma connection error', async () => {
      const prismaError = Object.assign(new Error('Can\'t reach database'), { code: 'P1001' });
      (prisma.scimResource.findFirst as jest.Mock).mockRejectedValue(prismaError);

      await expect(repo.findByDisplayName('ep-1', 'engineering'))
        .rejects.toMatchObject({ code: 'CONNECTION' });
    });
  });

  // ─── findByExternalId ────────────────────────────────────────────────

  describe('findByExternalId', () => {
    it('should scope to resourceType Group', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findByExternalId('ep-1', 'ext-1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          endpointId: 'ep-1',
          resourceType: 'Group',
          externalId: 'ext-1',
        }),
      });
    });

    it('should return mapped GroupRecord when found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(
        fakeGroupResource({ externalId: 'ext-1' }),
      );

      const result = await repo.findByExternalId('ep-1', 'ext-1');
      expect(result).not.toBeNull();
      expect(result!.externalId).toBe('ext-1');
    });
  });

  // ─── addMembers ──────────────────────────────────────────────────────

  describe('addMembers', () => {
    it('should insert into resourceMember (not groupMember)', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (write: (tx: PrismaService) => Promise<void>) => write(prisma),
      );
      (prisma.resourceMember.createMany as jest.Mock).mockResolvedValue({ count: 2 });

      const members = [
        { userId: 'user-res-1', value: 'scim-1', type: 'User', display: 'Alice' },
        { userId: null, value: 'scim-2', type: 'User', display: 'Bob' },
      ];

      await repo.addMembers('grp-1', members, []);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'grp-1' }, data: { version: { increment: 1 } },
      });
      expect(prisma.resourceMember.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            groupResourceId: 'grp-1',
            memberResourceId: 'user-res-1',
            value: 'scim-1',
          }),
          expect.objectContaining({
            groupResourceId: 'grp-1',
            memberResourceId: null,
            value: 'scim-2',
          }),
        ]),
      });
    });

    it('should skip when members array is empty', async () => {
      await repo.addMembers('grp-1', [], []);
      expect(prisma.resourceMember.createMany).not.toHaveBeenCalled();
    });
  });

  // ─── updateGroupWithMembers ──────────────────────────────────────────

  describe('updateGroupWithMembers', () => {
    it('returns the written parent and inserted members without a post-write query', async () => {
      (prisma.$transaction as jest.Mock).mockImplementation(
        async (write: (tx: PrismaService) => Promise<unknown>) => write(prisma),
      );
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(
        fakeGroupResource({ displayName: 'Own commit', version: 2 }),
      );
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([fakeResourceMember()]);
      const result = await repo.updateGroupWithMembers('grp-1', { displayName: 'Own commit' }, [{
        userId: 'user-res-1', value: 'user-scim-1', type: 'User', display: 'Alice',
      }], 1);
      expect(result).toMatchObject({
        version: 2, displayName: 'Own commit', members: [{ id: 'mem-1', value: 'user-scim-1' }],
      });
      expect(prisma.scimResource.findUnique).not.toHaveBeenCalled();
      expect(prisma.scimResource.findFirst).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('should use transaction with scimResource and resourceMember', async () => {
      const data = { displayName: 'Updated' };
      const members = [
        { userId: 'user-res-1', value: 'scim-1', type: 'User', display: 'Alice' },
      ];

      await repo.updateGroupWithMembers('grp-1', data, members);

      expect(prisma.$transaction).toHaveBeenCalled();

      // The transaction function was called - verify its operations via the mock tx
      const txFn = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([fakeResourceMember()]),
        scimResource: { update: jest.fn().mockResolvedValue(fakeGroupResource({ version: 2 })) },
        resourceMember: { deleteMany: jest.fn(), createManyAndReturn: jest.fn().mockResolvedValue([fakeResourceMember()]) },
      };
      await txFn(tx);

      // Should update scimResource (not scimGroup)
      expect(tx.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'grp-1' },
        data: { ...data, version: { increment: 1 } },
      });

      expect(tx.resourceMember.deleteMany).not.toHaveBeenCalled();
      expect(tx.resourceMember.createManyAndReturn).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).toHaveBeenCalledWith(
        expect.anything(), 'grp-1', expect.stringContaining('"memberResourceId":"user-res-1"'),
      );
    });

    it('should not create members when array is empty', async () => {
      await repo.updateGroupWithMembers('grp-1', { displayName: 'X' }, []);

      const txFn = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      const tx = {
        scimResource: { update: jest.fn().mockResolvedValue(fakeGroupResource({ version: 2 })) },
        resourceMember: { deleteMany: jest.fn(), createManyAndReturn: jest.fn() },
      };
      await txFn(tx);

      expect(tx.resourceMember.createManyAndReturn).not.toHaveBeenCalled();
    });
  });
});
