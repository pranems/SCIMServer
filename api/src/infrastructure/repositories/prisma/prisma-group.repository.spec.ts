/**
 * PrismaGroupRepository — Unit tests for Phase 2 unified ScimResource table.
 *
 * Verifies that all queries target `scimResource` with `resourceType: 'Group'`,
 * that members use `resourceMember` (not `groupMember`), and that the mapping
 * from ScimResource/ResourceMember → GroupRecord/MemberRecord is correct.
 */
import { PrismaGroupRepository } from './prisma-group.repository';
import type { PrismaService } from '../../../modules/prisma/prisma.service';

// ─── Factory helpers ──────────────────────────────────────────────────────────

function createMockPrismaService(): PrismaService {
  return {
    scimResource: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    resourceMember: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        scimResource: {
          update: jest.fn(),
        },
        resourceMember: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };
      await fn(tx);
      return tx;
    }),
  } as unknown as PrismaService;
}

function fakeGroupResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grp-1',
    endpointId: 'ep-1',
    resourceType: 'Group',
    scimId: 'grp-scim-1',
    externalId: null,
    userName: null,
    userNameLower: null,
    displayName: 'Engineering',
    displayNameLower: 'engineering',
    active: true,
    rawPayload: '{}',
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

describe('PrismaGroupRepository (Phase 2 — unified table)', () => {
  let repo: PrismaGroupRepository;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    repo = new PrismaGroupRepository(prisma);
  });

  // ─── create ──────────────────────────────────────────────────────────

  describe('create', () => {
    it('should insert with resourceType "Group" into scimResource', async () => {
      const input = {
        endpointId: 'ep-1',
        scimId: 'grp-scim-1',
        externalId: null,
        displayName: 'Engineering',
        displayNameLower: 'engineering',
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
        scimId: 'grp-scim-1',
        externalId: null,
        displayName: 'Engineering',
        displayNameLower: 'engineering',
        rawPayload: '{}',
        meta: '{}',
      });

      expect(result).toEqual(
        expect.objectContaining({
          id: 'grp-1',
          displayName: 'Engineering',
          displayNameLower: 'engineering',
        }),
      );
      expect(result).not.toHaveProperty('resourceType');
      expect(result).not.toHaveProperty('version');
    });
  });

  // ─── findByScimId ────────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should query scimResource with resourceType: Group', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(fakeGroupResource());

      await repo.findByScimId('ep-1', 'grp-scim-1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { scimId: 'grp-scim-1', endpointId: 'ep-1', resourceType: 'Group' },
      });
    });

    it('should return null when not found', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await repo.findByScimId('ep-1', 'nonexistent')).toBeNull();
    });
  });

  // ─── findWithMembers ─────────────────────────────────────────────────

  describe('findWithMembers', () => {
    it('should include membersAsGroup relation', async () => {
      const dbRow = {
        ...fakeGroupResource(),
        membersAsGroup: [fakeResourceMember()],
      };
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.findWithMembers('ep-1', 'grp-scim-1');

      expect(prisma.scimResource.findFirst).toHaveBeenCalledWith({
        where: { scimId: 'grp-scim-1', endpointId: 'ep-1', resourceType: 'Group' },
        include: { membersAsGroup: true },
      });

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
          }),
        ],
      };
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.findWithMembers('ep-1', 'grp-scim-1');
      const member = result!.members[0];

      expect(member.id).toBe('mem-42');
      expect(member.groupId).toBe('grp-1');
      expect(member.userId).toBe('user-res-99');
      expect(member.value).toBe('user-scim-99');
      expect(member.type).toBe('User');
      expect(member.display).toBe('Bob');
    });

    it('should handle null memberResourceId', async () => {
      const dbRow = {
        ...fakeGroupResource(),
        membersAsGroup: [fakeResourceMember({ memberResourceId: null })],
      };
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.findWithMembers('ep-1', 'grp-scim-1');
      expect(result!.members[0].userId).toBeNull();
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

      await repo.findAllWithMembers('ep-1', { displayNameLower: 'engineering' });

      expect(prisma.scimResource.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          displayNameLower: 'engineering',
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
  });

  // ─── update ──────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update scimResource by id', async () => {
      const dbRow = fakeGroupResource({ displayName: 'Updated' });
      (prisma.scimResource.update as jest.Mock).mockResolvedValue(dbRow);

      const result = await repo.update('grp-1', { displayName: 'Updated' });

      expect(prisma.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'grp-1' },
        data: { displayName: 'Updated' },
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
          displayNameLower: 'engineering',
        }),
        select: { scimId: true },
      });
    });

    it('should exclude a specific scimId', async () => {
      (prisma.scimResource.findFirst as jest.Mock).mockResolvedValue(null);

      await repo.findByDisplayName('ep-1', 'engineering', 'exclude-me');

      const call = (prisma.scimResource.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where.NOT).toEqual({ scimId: 'exclude-me' });
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
      (prisma.resourceMember.createMany as jest.Mock).mockResolvedValue({ count: 2 });

      const members = [
        { userId: 'user-res-1', value: 'scim-1', type: 'User', display: 'Alice' },
        { userId: null, value: 'scim-2', type: 'User', display: 'Bob' },
      ];

      await repo.addMembers('grp-1', members);

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
      await repo.addMembers('grp-1', []);
      expect(prisma.resourceMember.createMany).not.toHaveBeenCalled();
    });
  });

  // ─── updateGroupWithMembers ──────────────────────────────────────────

  describe('updateGroupWithMembers', () => {
    it('should use transaction with scimResource and resourceMember', async () => {
      const data = { displayName: 'Updated', displayNameLower: 'updated' };
      const members = [
        { userId: 'user-res-1', value: 'scim-1', type: 'User', display: 'Alice' },
      ];

      await repo.updateGroupWithMembers('grp-1', data, members);

      expect(prisma.$transaction).toHaveBeenCalled();

      // The transaction function was called — verify its operations via the mock tx
      const txFn = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      const tx = {
        scimResource: { update: jest.fn() },
        resourceMember: { deleteMany: jest.fn(), createMany: jest.fn() },
      };
      await txFn(tx);

      // Should update scimResource (not scimGroup)
      expect(tx.scimResource.update).toHaveBeenCalledWith({
        where: { id: 'grp-1' },
        data,
      });

      // Should delete from resourceMember using groupResourceId (not groupId)
      expect(tx.resourceMember.deleteMany).toHaveBeenCalledWith({
        where: { groupResourceId: 'grp-1' },
      });

      // Should create resourceMember entries
      expect(tx.resourceMember.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            groupResourceId: 'grp-1',
            memberResourceId: 'user-res-1',
          }),
        ]),
      });
    });

    it('should not create members when array is empty', async () => {
      await repo.updateGroupWithMembers('grp-1', { displayName: 'X' }, []);

      const txFn = (prisma.$transaction as jest.Mock).mock.calls[0][0];
      const tx = {
        scimResource: { update: jest.fn() },
        resourceMember: { deleteMany: jest.fn(), createMany: jest.fn() },
      };
      await txFn(tx);

      expect(tx.resourceMember.createMany).not.toHaveBeenCalled();
    });
  });
});
