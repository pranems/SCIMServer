import { InMemoryUserRepository } from './inmemory-user.repository';
import type { UserCreateInput } from '../../../domain/models/user.model';

describe('InMemoryUserRepository', () => {
  let repo: InMemoryUserRepository;

  const endpointId = 'ep-1';
  const otherEndpointId = 'ep-2';

  const makeInput = (overrides?: Partial<UserCreateInput>): UserCreateInput => ({
    endpointId,
    scimId: 'scim-user-1',
    externalId: 'ext-1',
    userName: 'Alice',
    userNameLower: 'alice',
    active: true,
    rawPayload: '{}',
    meta: '{"resourceType":"User"}',
    ...overrides,
  });

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  // ─── create ────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a user and return a complete record', async () => {
      const input = makeInput();
      const result = await repo.create(input);

      expect(result.id).toBeDefined();
      expect(result.endpointId).toBe(endpointId);
      expect(result.scimId).toBe('scim-user-1');
      expect(result.externalId).toBe('ext-1');
      expect(result.userName).toBe('Alice');
      expect(result.userNameLower).toBe('alice');
      expect(result.active).toBe(true);
      expect(result.rawPayload).toBe('{}');
      expect(result.meta).toBe('{"resourceType":"User"}');
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should assign a unique id to each created user', async () => {
      const r1 = await repo.create(makeInput({ scimId: 'u1' }));
      const r2 = await repo.create(makeInput({ scimId: 'u2' }));
      expect(r1.id).not.toBe(r2.id);
    });

    it('should return a detached copy (mutations do not affect storage)', async () => {
      const result = await repo.create(makeInput());
      result.userName = 'MUTATED';

      const fetched = await repo.findByScimId(endpointId, 'scim-user-1');
      expect(fetched!.userName).toBe('Alice');
    });
  });

  // ─── findByScimId ──────────────────────────────────────────────────

  describe('findByScimId', () => {
    it('should return the user when found', async () => {
      await repo.create(makeInput());
      const found = await repo.findByScimId(endpointId, 'scim-user-1');
      expect(found).not.toBeNull();
      expect(found!.scimId).toBe('scim-user-1');
    });

    it('should return null when the scimId does not exist', async () => {
      const found = await repo.findByScimId(endpointId, 'nonexistent');
      expect(found).toBeNull();
    });

    it('should isolate by endpointId', async () => {
      await repo.create(makeInput());
      const found = await repo.findByScimId(otherEndpointId, 'scim-user-1');
      expect(found).toBeNull();
    });

    it('should return a detached copy', async () => {
      await repo.create(makeInput());
      const a = await repo.findByScimId(endpointId, 'scim-user-1');
      const b = await repo.findByScimId(endpointId, 'scim-user-1');
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────

  describe('findAll', () => {
    beforeEach(async () => {
      await repo.create(makeInput({ scimId: 'u1', userName: 'Charlie', userNameLower: 'charlie' }));
      await repo.create(makeInput({ scimId: 'u2', userName: 'Alice', userNameLower: 'alice' }));
      await repo.create(makeInput({ scimId: 'u3', userName: 'Bob', userNameLower: 'bob' }));
      // Different endpoint
      await repo.create(makeInput({ scimId: 'u4', endpointId: otherEndpointId }));
    });

    it('should return only users for the given endpoint', async () => {
      const results = await repo.findAll(endpointId);
      expect(results).toHaveLength(3);
      results.forEach((u) => expect(u.endpointId).toBe(endpointId));
    });

    it('should return an empty array when no users exist', async () => {
      const results = await repo.findAll('nonexistent-ep');
      expect(results).toEqual([]);
    });

    it('should sort by createdAt ascending by default', async () => {
      const results = await repo.findAll(endpointId);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          results[i - 1].createdAt.getTime(),
        );
      }
    });

    it('should sort by a specified field ascending', async () => {
      const results = await repo.findAll(endpointId, undefined, {
        field: 'userNameLower',
        direction: 'asc',
      });
      const names = results.map((u) => u.userNameLower);
      expect(names).toEqual(['alice', 'bob', 'charlie']);
    });

    it('should sort by a specified field descending', async () => {
      const results = await repo.findAll(endpointId, undefined, {
        field: 'userNameLower',
        direction: 'desc',
      });
      const names = results.map((u) => u.userNameLower);
      expect(names).toEqual(['charlie', 'bob', 'alice']);
    });

    it('should apply a simple key-value filter', async () => {
      const results = await repo.findAll(endpointId, { userNameLower: 'alice' });
      expect(results).toHaveLength(1);
      expect(results[0].scimId).toBe('u2');
    });

    it('should return empty when filter matches nothing', async () => {
      const results = await repo.findAll(endpointId, { userNameLower: 'zzz' });
      expect(results).toHaveLength(0);
    });

    it('should return detached copies', async () => {
      const results = await repo.findAll(endpointId);
      results[0].userName = 'MUTATED';
      const fresh = await repo.findAll(endpointId);
      expect(fresh[0].userName).not.toBe('MUTATED');
    });
  });

  // ─── update ────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update specified fields and bump updatedAt', async () => {
      const created = await repo.create(makeInput());
      const updated = await repo.update(created.id, {
        userName: 'AliceUpdated',
        userNameLower: 'aliceupdated',
        active: false,
      });

      expect(updated.userName).toBe('AliceUpdated');
      expect(updated.userNameLower).toBe('aliceupdated');
      expect(updated.active).toBe(false);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime(),
      );
      // Unchanged fields preserved
      expect(updated.scimId).toBe(created.scimId);
      expect(updated.rawPayload).toBe(created.rawPayload);
    });

    it('should throw when the user does not exist', async () => {
      await expect(
        repo.update('nonexistent-id', { active: false }),
      ).rejects.toThrow('User with id nonexistent-id not found');
    });

    it('should return a detached copy', async () => {
      const created = await repo.create(makeInput());
      const updated = await repo.update(created.id, { active: false });
      updated.userName = 'MUTATED';

      const fetched = await repo.findByScimId(endpointId, created.scimId);
      expect(fetched!.userName).toBe('Alice');
    });
  });

  // ─── delete ────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should remove the user from storage', async () => {
      const created = await repo.create(makeInput());
      await repo.delete(created.id);

      const found = await repo.findByScimId(endpointId, created.scimId);
      expect(found).toBeNull();
    });

    it('should be idempotent (no error when deleting nonexistent id)', async () => {
      await expect(repo.delete('nonexistent-id')).resolves.toBeUndefined();
    });
  });

  // ─── findConflict ──────────────────────────────────────────────────

  describe('findConflict', () => {
    beforeEach(async () => {
      await repo.create(makeInput({
        scimId: 'existing-1',
        userName: 'ExistingUser',
        userNameLower: 'existinguser',
        externalId: 'ext-existing',
      }));
    });

    it('should detect a userName conflict (case-insensitive)', async () => {
      const conflict = await repo.findConflict(endpointId, 'EXISTINGUSER');
      expect(conflict).not.toBeNull();
      expect(conflict!.scimId).toBe('existing-1');
      expect(conflict!.userName).toBe('ExistingUser');
    });

    it('should detect an externalId conflict', async () => {
      const conflict = await repo.findConflict(endpointId, 'brand-new-name', 'ext-existing');
      expect(conflict).not.toBeNull();
      expect(conflict!.externalId).toBe('ext-existing');
    });

    it('should return null when no conflict exists', async () => {
      const conflict = await repo.findConflict(endpointId, 'UniqueUser', 'unique-ext');
      expect(conflict).toBeNull();
    });

    it('should exclude a record by scimId', async () => {
      const conflict = await repo.findConflict(
        endpointId,
        'ExistingUser',
        undefined,
        'existing-1',
      );
      expect(conflict).toBeNull();
    });

    it('should not cross endpoint boundaries', async () => {
      const conflict = await repo.findConflict(otherEndpointId, 'ExistingUser');
      expect(conflict).toBeNull();
    });

    it('should prioritize userName match over externalId', async () => {
      // Both match the same record — should still return that record
      const conflict = await repo.findConflict(
        endpointId,
        'ExistingUser',
        'ext-existing',
      );
      expect(conflict).not.toBeNull();
      expect(conflict!.scimId).toBe('existing-1');
    });

    it('should handle missing externalId gracefully', async () => {
      const conflict = await repo.findConflict(endpointId, 'NoMatch');
      expect(conflict).toBeNull();
    });
  });

  // ─── findByScimIds ─────────────────────────────────────────────────

  describe('findByScimIds', () => {
    beforeEach(async () => {
      await repo.create(makeInput({ scimId: 'u1' }));
      await repo.create(makeInput({ scimId: 'u2' }));
      await repo.create(makeInput({ scimId: 'u3' }));
      await repo.create(makeInput({ scimId: 'u4', endpointId: otherEndpointId }));
    });

    it('should resolve matching scimIds to id+scimId pairs', async () => {
      const results = await repo.findByScimIds(endpointId, ['u1', 'u3']);
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.scimId).sort()).toEqual(['u1', 'u3']);
      results.forEach((r) => expect(r.id).toBeDefined());
    });

    it('should return empty array for empty input', async () => {
      const results = await repo.findByScimIds(endpointId, []);
      expect(results).toEqual([]);
    });

    it('should skip scimIds not found', async () => {
      const results = await repo.findByScimIds(endpointId, ['u1', 'nonexistent']);
      expect(results).toHaveLength(1);
      expect(results[0].scimId).toBe('u1');
    });

    it('should isolate by endpointId', async () => {
      const results = await repo.findByScimIds(endpointId, ['u4']);
      expect(results).toHaveLength(0);
    });
  });

  // ─── clear ─────────────────────────────────────────────────────────

  describe('clear', () => {
    it('should remove all data', async () => {
      await repo.create(makeInput({ scimId: 'u1' }));
      await repo.create(makeInput({ scimId: 'u2' }));
      repo.clear();

      const results = await repo.findAll(endpointId);
      expect(results).toHaveLength(0);
    });
  });
});
