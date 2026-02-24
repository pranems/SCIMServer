import { GroupPatchEngine, type GroupPatchState } from './group-patch-engine';
import type { PatchOperation, GroupMemberPatchConfig, GroupMemberDto } from './patch-types';
import { PatchError } from './patch-error';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const defaultConfig: GroupMemberPatchConfig = {
  allowMultiMemberAdd: true,
  allowMultiMemberRemove: true,
  allowRemoveAllMembers: true,
};

const strictConfig: GroupMemberPatchConfig = {
  allowMultiMemberAdd: false,
  allowMultiMemberRemove: false,
  allowRemoveAllMembers: false,
};

function makeMembers(...ids: string[]): GroupMemberDto[] {
  return ids.map(id => ({ value: id, display: `User ${id}` }));
}

function makeState(overrides: Partial<GroupPatchState> = {}): GroupPatchState {
  return {
    displayName: 'Engineering',
    externalId: 'grp-001',
    members: makeMembers('user-1', 'user-2'),
    rawPayload: {},
    ...overrides,
  };
}

function apply(
  ops: PatchOperation[],
  state?: Partial<GroupPatchState>,
  config?: GroupMemberPatchConfig,
) {
  return GroupPatchEngine.apply(ops, makeState(state), config ?? defaultConfig);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GroupPatchEngine', () => {
  // ── Replace operations ─────────────────────────────────────────────

  describe('replace operations', () => {
    it('should replace displayName via path', () => {
      const result = apply([{ op: 'replace', path: 'displayName', value: 'Sales' }]);
      expect(result.displayName).toBe('Sales');
    });

    it('should replace displayName case-insensitively', () => {
      const result = apply([{ op: 'replace', path: 'DISPLAYNAME', value: 'Sales' }]);
      expect(result.displayName).toBe('Sales');
    });

    it('should replace displayName via no-path string value', () => {
      const result = apply([{ op: 'replace', value: 'Marketing' }]);
      expect(result.displayName).toBe('Marketing');
    });

    it('should replace externalId', () => {
      const result = apply([{ op: 'replace', path: 'externalId', value: 'ext-999' }]);
      expect(result.externalId).toBe('ext-999');
    });

    it('should set externalId to null for non-string value', () => {
      const result = apply([{ op: 'replace', path: 'externalId', value: 123 }]);
      expect(result.externalId).toBeNull();
    });

    it('should replace members array completely', () => {
      const result = apply([{
        op: 'replace',
        path: 'members',
        value: [{ value: 'user-99' }],
      }]);
      expect(result.members).toEqual([{ value: 'user-99' }]);
    });

    it('should deduplicate members on replace', () => {
      const result = apply([{
        op: 'replace',
        path: 'members',
        value: [{ value: 'user-1' }, { value: 'user-1' }],
      }]);
      expect(result.members).toHaveLength(1);
    });

    it('should replace multiple fields via no-path object', () => {
      const result = apply([{
        op: 'replace',
        value: {
          displayName: 'New Name',
          externalId: 'new-ext',
          members: [{ value: 'user-5' }],
        },
      }]);
      expect(result.displayName).toBe('New Name');
      expect(result.externalId).toBe('new-ext');
      expect(result.members).toEqual([{ value: 'user-5' }]);
    });

    it('should store extra attributes in rawPayload on no-path replace', () => {
      const result = apply([{
        op: 'replace',
        value: { displayName: 'Test', customField: 'data' },
      }]);
      expect(result.payload.customField).toBe('data');
    });

    it('should throw on non-string displayName replace', () => {
      expect(() => apply([{ op: 'replace', path: 'displayName', value: 123 }]))
        .toThrow(PatchError);
    });

    it('should throw on non-array members replace', () => {
      expect(() => apply([{ op: 'replace', path: 'members', value: 'bad' }]))
        .toThrow(PatchError);
    });

    it('should throw on unsupported path', () => {
      expect(() => apply([{ op: 'replace', path: 'unknownField', value: 'x' }]))
        .toThrow(PatchError);
    });

    it('should throw on no-path non-string non-object value', () => {
      expect(() => apply([{ op: 'replace', value: 42 }]))
        .toThrow(PatchError);
    });
  });

  // ── Add operations ─────────────────────────────────────────────────

  describe('add operations', () => {
    it('should add a single member', () => {
      const result = apply([{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }],
      }]);
      expect(result.members).toHaveLength(3);
      expect(result.members.map(m => m.value)).toContain('user-3');
    });

    it('should add member without explicit path', () => {
      const result = apply([{
        op: 'add',
        value: [{ value: 'user-4' }],
      }]);
      expect(result.members.map(m => m.value)).toContain('user-4');
    });

    it('should deduplicate when adding existing member', () => {
      const result = apply([{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-1' }],
      }]);
      expect(result.members.filter(m => m.value === 'user-1')).toHaveLength(1);
    });

    it('should add multiple members when allowed', () => {
      const result = apply([{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }, { value: 'user-4' }],
      }], undefined, defaultConfig);
      expect(result.members).toHaveLength(4);
    });

    it('should reject multiple members when not allowed', () => {
      expect(() => apply([{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }, { value: 'user-4' }],
      }], undefined, strictConfig)).toThrow(PatchError);
    });

    it('should allow single member add in strict mode', () => {
      const result = apply([{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }],
      }], undefined, strictConfig);
      expect(result.members).toHaveLength(3);
    });

    it('should wrap non-array value in array', () => {
      const result = apply([{
        op: 'add',
        path: 'members',
        value: { value: 'user-3' },
      }]);
      expect(result.members.map(m => m.value)).toContain('user-3');
    });

    it('should throw on unsupported add path', () => {
      expect(() => apply([{ op: 'add', path: 'displayName', value: 'x' }]))
        .toThrow(PatchError);
    });

    it('should throw on add without value', () => {
      expect(() => apply([{ op: 'add', path: 'members' }]))
        .toThrow(PatchError);
    });
  });

  // ── Remove operations ──────────────────────────────────────────────

  describe('remove operations', () => {
    it('should remove member by value array', () => {
      const result = apply([{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }],
      }]);
      expect(result.members.map(m => m.value)).toEqual(['user-2']);
    });

    it('should remove member by path filter', () => {
      const result = apply([{
        op: 'remove',
        path: 'members[value eq "user-2"]',
      }]);
      expect(result.members.map(m => m.value)).toEqual(['user-1']);
    });

    it('should remove all members when allowed', () => {
      const result = apply([{ op: 'remove', path: 'members' }]);
      expect(result.members).toHaveLength(0);
    });

    it('should reject remove-all when not allowed', () => {
      expect(() => apply(
        [{ op: 'remove', path: 'members' }],
        undefined,
        strictConfig,
      )).toThrow(PatchError);
    });

    it('should remove multiple members via value array when allowed', () => {
      const result = apply([{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }, { value: 'user-2' }],
      }]);
      expect(result.members).toHaveLength(0);
    });

    it('should reject multi-member remove when not allowed', () => {
      expect(() => apply([{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }, { value: 'user-2' }],
      }], undefined, strictConfig)).toThrow(PatchError);
    });

    it('should allow single member remove in strict mode', () => {
      const result = apply([{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }],
      }], undefined, strictConfig);
      expect(result.members.map(m => m.value)).toEqual(['user-2']);
    });

    it('should throw on unsupported remove path', () => {
      expect(() => apply([{ op: 'remove', path: 'displayName' }]))
        .toThrow(PatchError);
    });
  });

  // ── Multiple operations ────────────────────────────────────────────

  describe('multiple operations', () => {
    it('should apply mixed operations sequentially', () => {
      const result = apply([
        { op: 'replace', path: 'displayName', value: 'Team Alpha' },
        { op: 'add', path: 'members', value: [{ value: 'user-3' }] },
        { op: 'remove', path: 'members', value: [{ value: 'user-1' }] },
      ]);
      expect(result.displayName).toBe('Team Alpha');
      expect(result.members.map(m => m.value).sort()).toEqual(['user-2', 'user-3']);
    });

    it('should replace displayName + externalId then add member', () => {
      const result = apply([
        { op: 'replace', value: { displayName: 'New', externalId: 'e2' } },
        { op: 'add', path: 'members', value: [{ value: 'user-10' }] },
      ]);
      expect(result.displayName).toBe('New');
      expect(result.externalId).toBe('e2');
      expect(result.members).toHaveLength(3);
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw PatchError for unsupported op', () => {
      expect(() => apply([{ op: 'invalid' }])).toThrow(PatchError);
    });

    it('should throw PatchError for member without value property', () => {
      expect(() => apply([{
        op: 'add',
        path: 'members',
        value: [{ display: 'No Value' }],
      }])).toThrow(PatchError);
    });
  });

  // ── Utility methods ────────────────────────────────────────────────

  describe('toMemberDto', () => {
    it('should extract value, display, type', () => {
      const dto = GroupPatchEngine.toMemberDto({ value: 'u1', display: 'U1', type: 'User' });
      expect(dto).toEqual({ value: 'u1', display: 'U1', type: 'User' });
    });

    it('should throw on null input', () => {
      expect(() => GroupPatchEngine.toMemberDto(null)).toThrow(PatchError);
    });

    it('should throw on missing value', () => {
      expect(() => GroupPatchEngine.toMemberDto({ display: 'X' })).toThrow(PatchError);
    });
  });

  describe('ensureUniqueMembers', () => {
    it('should keep last duplicate', () => {
      const result = GroupPatchEngine.ensureUniqueMembers([
        { value: 'a', display: 'First' },
        { value: 'b' },
        { value: 'a', display: 'Second' },
      ]);
      expect(result).toHaveLength(2);
      expect(result.find(m => m.value === 'a')?.display).toBe('Second');
    });
  });

  // ── SCIM Validator: Multi-op scenarios ─────────────────────────────────

  describe('SCIM Validator: multi-op scenarios', () => {
    it('should apply add then remove member in a single patch (add→remove = empty)', () => {
      const result = apply(
        [
          { op: 'add', path: 'members', value: [{ value: 'user-new' }] },
          { op: 'remove', path: 'members[value eq "user-new"]' },
        ],
        { members: [] },
      );
      expect(result.members).toHaveLength(0);
    });

    it('should apply replace displayName via no-path object (Entra-style)', () => {
      const result = apply([{
        op: 'replace',
        value: { displayName: 'EntraReplacedName' },
      }]);
      expect(result.displayName).toBe('EntraReplacedName');
    });

    it('should apply replace externalId via no-path object', () => {
      const result = apply([{
        op: 'replace',
        value: { externalId: 'new-ext-from-entra' },
      }]);
      expect(result.externalId).toBe('new-ext-from-entra');
    });

    it('should apply replace members via path (full member replacement)', () => {
      const result = apply([{
        op: 'replace',
        path: 'members',
        value: [{ value: 'user-A' }],
      }], { members: makeMembers('user-1', 'user-2') });
      expect(result.members).toHaveLength(1);
      expect(result.members[0].value).toBe('user-A');
    });

    it('should handle remove member via value filter path', () => {
      const result = apply(
        [{ op: 'remove', path: 'members[value eq "user-1"]' }],
        { members: makeMembers('user-1', 'user-2') },
      );
      expect(result.members).toHaveLength(1);
      expect(result.members[0].value).toBe('user-2');
    });

    it('should apply combined displayName + externalId replace in single op', () => {
      const result = apply([{
        op: 'replace',
        value: { displayName: 'Combined', externalId: 'ext-combined' },
      }]);
      expect(result.displayName).toBe('Combined');
      expect(result.externalId).toBe('ext-combined');
    });
  });
});
