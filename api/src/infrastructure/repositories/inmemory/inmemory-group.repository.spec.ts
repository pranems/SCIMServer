import { InMemoryGroupRepository } from './inmemory-group.repository';
import type {
  GroupCreateInput,
  MemberCreateInput,
} from '../../../domain/models/group.model';

describe('InMemoryGroupRepository', () => {
  let repo: InMemoryGroupRepository;

  const endpointId = 'ep-1';
  const otherEndpointId = 'ep-2';

  const makeGroupInput = (overrides?: Partial<GroupCreateInput>): GroupCreateInput => ({
    endpointId,
    scimId: 'scim-grp-1',
    externalId: 'ext-g1',
    displayName: 'Engineering',
    displayNameLower: 'engineering',
    rawPayload: '{}',
    meta: '{"resourceType":"Group"}',
    ...overrides,
  });

  const makeMemberInput = (overrides?: Partial<MemberCreateInput>): MemberCreateInput => ({
    userId: 'user-internal-1',
    value: 'scim-user-1',
    type: 'User',
    display: 'Alice',
    ...overrides,
  });

  beforeEach(() => {
    repo = new InMemoryGroupRepository();
  });

  // ─── create ────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a group and return a complete record', async () => {
      const result = await repo.create(makeGroupInput());

      expect(result.id).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.scimId).toBe('scim-grp-1');
      expect(result.externalId).toBe('ext-g1');
      expect(result.displayName).toBe('Engineering');
      expect(result.displayNameLower).toBe('engineering');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should assign unique ids', async () => {
      const g1 = await repo.create(makeGroupInput({ scimId: 'g1' }));
      const g2 = await repo.create(makeGroupInput({ scimId: 'g2' }));
      expect(g1.id).not.toBe(g2.id);
    });

    it('should return a detached copy', async () => {
      const result = await repo.create(makeGroupInput());
      result.displayName = 'MUTATED';

      const fetched = await repo.findByScimId(endpointId, 'scim-grp-1');
      expect(fetched!.displayName).toBe('Engineering');
    });
  });

  // ─── findByScimId ──────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should return the group when found', async () => {
      await repo.create(makeGroupInput());
      const found = await repo.findByScimId(endpointId, 'scim-grp-1');
      expect(found).not.toBeNull();
      expect(found!.scimId).toBe('scim-grp-1');
    });

    it('should return null when not found', async () => {
      expect(await repo.findByScimId(endpointId, 'nonexistent')).toBeNull();
    });

    it('should isolate by endpointId', async () => {
      await repo.create(makeGroupInput());
      expect(await repo.findByScimId(otherEndpointId, 'scim-grp-1')).toBeNull();
    });
  });

  // ─── findWithMembers ──────────────────────────────────────────────

  describe('findWithMembers', () => {
    it('should return group with empty members array when group has no members', async () => {
      await repo.create(makeGroupInput());
      const found = await repo.findWithMembers(endpointId, 'scim-grp-1');

      expect(found).not.toBeNull();
      expect(found!.scimId).toBe('scim-grp-1');
      expect(found!.members).toEqual([]);
    });

    it('should include members when they exist', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [
        makeMemberInput(),
        makeMemberInput({ userId: 'user-2', value: 'scim-user-2', display: 'Bob' }),
      ]);

      const found = await repo.findWithMembers(endpointId, 'scim-grp-1');
      expect(found!.members).toHaveLength(2);
      expect(found!.members.map((m) => m.display).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should return null when group does not exist', async () => {
      expect(await repo.findWithMembers(endpointId, 'nonexistent')).toBeNull();
    });

    it('should return detached member copies', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [makeMemberInput()]);

      const a = await repo.findWithMembers(endpointId, 'scim-grp-1');
      const b = await repo.findWithMembers(endpointId, 'scim-grp-1');
      expect(a!.members[0]).not.toBe(b!.members[0]);
      expect(a!.members[0]).toEqual(b!.members[0]);
    });
  });

  // ─── findAllWithMembers ────────────────────────────────────────────

  describe('findAllWithMembers', () => {
    beforeEach(async () => {
      const g1 = await repo.create(makeGroupInput({ scimId: 'g1', displayName: 'Zeta', displayNameLower: 'zeta' }));
      const g2 = await repo.create(makeGroupInput({ scimId: 'g2', displayName: 'Alpha', displayNameLower: 'alpha' }));
      await repo.create(makeGroupInput({ scimId: 'g3', endpointId: otherEndpointId }));

      await repo.addMembers(g1.id, [makeMemberInput()]);
      await repo.addMembers(g2.id, [
        makeMemberInput({ userId: 'u1', value: 'v1', display: 'One' }),
        makeMemberInput({ userId: 'u2', value: 'v2', display: 'Two' }),
      ]);
    });

    it('should return only groups for the given endpoint with members', async () => {
      const results = await repo.findAllWithMembers(endpointId);
      expect(results).toHaveLength(2);
      results.forEach((g) => expect(g.endpointId).toBe(endpointId));
    });

    it('should include correct member counts per group', async () => {
      const results = await repo.findAllWithMembers(endpointId);
      const g1 = results.find((g) => g.scimId === 'g1');
      const g2 = results.find((g) => g.scimId === 'g2');
      expect(g1!.members).toHaveLength(1);
      expect(g2!.members).toHaveLength(2);
    });

    it('should sort by displayNameLower ascending', async () => {
      const results = await repo.findAllWithMembers(endpointId, undefined, {
        field: 'displayNameLower',
        direction: 'asc',
      });
      expect(results.map((g) => g.displayNameLower)).toEqual(['alpha', 'zeta']);
    });

    it('should sort by displayNameLower descending', async () => {
      const results = await repo.findAllWithMembers(endpointId, undefined, {
        field: 'displayNameLower',
        direction: 'desc',
      });
      expect(results.map((g) => g.displayNameLower)).toEqual(['zeta', 'alpha']);
    });

    it('should apply a key-value filter', async () => {
      const results = await repo.findAllWithMembers(endpointId, { displayNameLower: 'alpha' });
      expect(results).toHaveLength(1);
      expect(results[0].scimId).toBe('g2');
    });

    it('should return empty array when no groups exist for endpoint', async () => {
      const results = await repo.findAllWithMembers('nonexistent-ep');
      expect(results).toEqual([]);
    });
  });

  // ─── update ────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update specified fields and bump updatedAt', async () => {
      const created = await repo.create(makeGroupInput());
      const updated = await repo.update(created.id, {
        displayName: 'Design',
        displayNameLower: 'design',
      });

      expect(updated.displayName).toBe('Design');
      expect(updated.displayNameLower).toBe('design');
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
      // Unchanged fields preserved
      expect(updated.scimId).toBe(created.scimId);
      expect(updated.externalId).toBe(created.externalId);
    });

    it('should throw when group does not exist', async () => {
      await expect(
        repo.update('nonexistent-id', { displayName: 'X' }),
      ).rejects.toThrow('Group with id nonexistent-id not found');
    });
  });

  // ─── delete ────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should remove the group from storage', async () => {
      const created = await repo.create(makeGroupInput());
      await repo.delete(created.id);

      expect(await repo.findByScimId(endpointId, created.scimId)).toBeNull();
    });

    it('should cascade-delete associated members', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [makeMemberInput(), makeMemberInput({ userId: 'u2' })]);

      await repo.delete(group.id);

      // Re-create same-named group to verify members are truly gone
      const newGroup = await repo.create(makeGroupInput({ scimId: 'scim-grp-new' }));
      const withMembers = await repo.findWithMembers(endpointId, 'scim-grp-new');
      expect(withMembers!.members).toHaveLength(0);
      // Also verify the old group's id is gone
      expect(await repo.findByScimId(endpointId, group.scimId)).toBeNull();
    });

    it('should be idempotent (no error on nonexistent id)', async () => {
      await expect(repo.delete('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ─── findByDisplayName ─────────────────────────────────────────────

  describe('findByDisplayName', () => {
    beforeEach(async () => {
      await repo.create(makeGroupInput({
        scimId: 'existing-g',
        displayName: 'Marketing',
        displayNameLower: 'marketing',
      }));
    });

    it('should return scimId when display name conflicts', async () => {
      const conflict = await repo.findByDisplayName(endpointId, 'marketing');
      expect(conflict).not.toBeNull();
      expect(conflict!.scimId).toBe('existing-g');
    });

    it('should return null when no conflict', async () => {
      expect(await repo.findByDisplayName(endpointId, 'sales')).toBeNull();
    });

    it('should exclude a record by scimId', async () => {
      const conflict = await repo.findByDisplayName(endpointId, 'marketing', 'existing-g');
      expect(conflict).toBeNull();
    });

    it('should not cross endpoint boundaries', async () => {
      expect(await repo.findByDisplayName(otherEndpointId, 'marketing')).toBeNull();
    });
  });

  // ─── findByExternalId ──────────────────────────────────────────────

  describe('findByExternalId', () => {
    beforeEach(async () => {
      await repo.create(makeGroupInput({
        scimId: 'g-ext',
        externalId: 'ext-unique',
      }));
    });

    it('should return the group when externalId matches', async () => {
      const found = await repo.findByExternalId(endpointId, 'ext-unique');
      expect(found).not.toBeNull();
      expect(found!.scimId).toBe('g-ext');
    });

    it('should return null when no match', async () => {
      expect(await repo.findByExternalId(endpointId, 'no-match')).toBeNull();
    });

    it('should exclude a record by scimId', async () => {
      const found = await repo.findByExternalId(endpointId, 'ext-unique', 'g-ext');
      expect(found).toBeNull();
    });

    it('should not cross endpoint boundaries', async () => {
      expect(await repo.findByExternalId(otherEndpointId, 'ext-unique')).toBeNull();
    });
  });

  // ─── addMembers ────────────────────────────────────────────────────

  describe('addMembers', () => {
    it('should add members to a group', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [
        makeMemberInput(),
        makeMemberInput({ userId: 'u2', value: 'v2', display: 'Bob' }),
      ]);

      const withMembers = await repo.findWithMembers(endpointId, group.scimId);
      expect(withMembers!.members).toHaveLength(2);
    });

    it('should assign unique ids to each member', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [
        makeMemberInput({ userId: 'u1' }),
        makeMemberInput({ userId: 'u2' }),
      ]);

      const withMembers = await repo.findWithMembers(endpointId, group.scimId);
      const ids = withMembers!.members.map((m) => m.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('should set createdAt on each member', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [makeMemberInput()]);

      const withMembers = await repo.findWithMembers(endpointId, group.scimId);
      expect(withMembers!.members[0].createdAt).toBeInstanceOf(Date);
    });

    it('should preserve member fields', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [
        makeMemberInput({ userId: null, value: 'v1', type: null, display: null }),
      ]);

      const m = (await repo.findWithMembers(endpointId, group.scimId))!.members[0];
      expect(m.groupId).toBe(group.id);
      expect(m.userId).toBeNull();
      expect(m.value).toBe('v1');
      expect(m.type).toBeNull();
      expect(m.display).toBeNull();
    });

    it('should handle empty member array', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, []);

      const withMembers = await repo.findWithMembers(endpointId, group.scimId);
      expect(withMembers!.members).toHaveLength(0);
    });
  });

  // ─── updateGroupWithMembers ────────────────────────────────────────

  describe('updateGroupWithMembers', () => {
    it('should update group fields and replace all members', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [
        makeMemberInput({ userId: 'old-u1', display: 'OldMember' }),
      ]);

      await repo.updateGroupWithMembers(
        group.id,
        { displayName: 'Updated', displayNameLower: 'updated' },
        [
          makeMemberInput({ userId: 'new-u1', display: 'NewMember1' }),
          makeMemberInput({ userId: 'new-u2', display: 'NewMember2' }),
        ],
      );

      const updated = await repo.findWithMembers(endpointId, group.scimId);
      expect(updated!.displayName).toBe('Updated');
      expect(updated!.members).toHaveLength(2);
      expect(updated!.members.map((m) => m.display).sort()).toEqual([
        'NewMember1',
        'NewMember2',
      ]);
    });

    it('should clear all members when new members array is empty', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [makeMemberInput()]);

      await repo.updateGroupWithMembers(group.id, {}, []);

      const updated = await repo.findWithMembers(endpointId, group.scimId);
      expect(updated!.members).toHaveLength(0);
    });

    it('should not affect members of other groups', async () => {
      const g1 = await repo.create(makeGroupInput({ scimId: 'g1' }));
      const g2 = await repo.create(makeGroupInput({ scimId: 'g2' }));

      await repo.addMembers(g1.id, [makeMemberInput({ userId: 'u1', display: 'G1Member' })]);
      await repo.addMembers(g2.id, [makeMemberInput({ userId: 'u2', display: 'G2Member' })]);

      // Update g1, replacing its members
      await repo.updateGroupWithMembers(g1.id, {}, [
        makeMemberInput({ userId: 'u3', display: 'NewG1Member' }),
      ]);

      // g2's members should be unaffected
      const g2WithMembers = await repo.findWithMembers(endpointId, 'g2');
      expect(g2WithMembers!.members).toHaveLength(1);
      expect(g2WithMembers!.members[0].display).toBe('G2Member');
    });
  });

  // ─── clear ─────────────────────────────────────────────────────────

  describe('clear', () => {
    it('should remove all groups and members', async () => {
      const group = await repo.create(makeGroupInput());
      await repo.addMembers(group.id, [makeMemberInput()]);

      repo.clear();

      expect(await repo.findAllWithMembers(endpointId)).toEqual([]);
    });
  });
});
