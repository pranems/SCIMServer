/**
 * Phase 8.1 Gap Tests - V19 (prototype pollution) & V20 (reserved attributes)
 *
 * Tests for:
 *  V19 - __proto__ / constructor / prototype guard in PATCH engines
 *  V20 - meta & schemas stripping from rawPayload via stripReservedAttributes
 */

import { UserPatchEngine, type UserPatchState } from './user-patch-engine';
import { GroupPatchEngine, type GroupPatchState } from './group-patch-engine';
import type { PatchOperation, PatchConfig, GroupMemberPatchConfig } from './patch-types';
import { PatchError } from './patch-error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultConfig: PatchConfig = { verbosePatch: false };
const groupConfig: GroupMemberPatchConfig = {
  allowMultiMemberAdd: true,
  allowMultiMemberRemove: true,
  allowRemoveAllMembers: true,
  extensionUrns: [],
};

function makeUserState(overrides: Partial<UserPatchState> = {}): UserPatchState {
  return {
    userName: 'alice@example.com',
    displayName: 'Alice',
    externalId: 'ext-001',
    active: true,
    rawPayload: {
      displayName: 'Alice',
      name: { givenName: 'Alice', familyName: 'Smith' },
    },
    ...overrides,
  };
}

function makeGroupState(overrides: Partial<GroupPatchState> = {}): GroupPatchState {
  return {
    displayName: 'Test Group',
    externalId: null,
    members: [],
    rawPayload: { displayName: 'Test Group' },
    ...overrides,
  };
}

// ─── V19: Prototype pollution guard (UserPatchEngine) ─────────────────────────

describe('V19 - prototype pollution guard (UserPatchEngine)', () => {
  it('should reject add op with __proto__ in dot-notation path', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: '__proto__.polluted', value: true },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), defaultConfig),
    ).toThrow(PatchError);
  });

  it('should reject replace op with constructor in path', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'constructor.name', value: 'Evil' },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), defaultConfig),
    ).toThrow(PatchError);
  });

  it('should reject replace op with prototype in path', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'prototype.isAdmin', value: true },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), defaultConfig),
    ).toThrow(PatchError);
  });

  it('should reject remove op with __proto__ in path', () => {
    const ops: PatchOperation[] = [
      { op: 'remove', path: '__proto__.polluted' },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), defaultConfig),
    ).toThrow(PatchError);
  });

  it('should reject __proto__ as a simple path (non-dot-notation)', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: '__proto__', value: { polluted: true } },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), defaultConfig),
    ).toThrow(PatchError);
  });

  it('should strip __proto__ from no-path merge objects', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'Bob',
          __proto__: { polluted: true },
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.extractedFields.displayName).toBe('Bob');
    // __proto__ should not appear as an own property in rawPayload
    expect(Object.getOwnPropertyNames(result.payload).includes('__proto__')).toBe(false);
  });

  it('should allow normal dot-notation paths', () => {
    const verboseConfig: PatchConfig = { verbosePatch: true };
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'name.givenName', value: 'Bob' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), verboseConfig);
    const name = result.payload.name as Record<string, unknown>;
    expect(name.givenName).toBe('Bob');
  });
});

// ─── V19: Prototype pollution guard (GroupPatchEngine) ────────────────────────

describe('V19 - prototype pollution guard (GroupPatchEngine)', () => {
  it('should strip __proto__ from no-path replace objects', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'New Name',
          __proto__: { polluted: true },
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(result.displayName).toBe('New Name');
    expect(Object.getOwnPropertyNames(result.payload).includes('__proto__')).toBe(false);
  });

  it('should strip constructor key from no-path replace objects', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'New Name',
          constructor: { polluted: true },
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(Object.getOwnPropertyNames(result.payload).includes('constructor')).toBe(false);
  });

  it('should strip prototype key from no-path replace objects', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'New Name',
          prototype: { polluted: true },
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(Object.getOwnPropertyNames(result.payload).includes('prototype')).toBe(false);
  });
});

// ─── V19: Deep dot-notation prototype pollution (UserPatchEngine) ─────────────

describe('V19 - deep dot-notation prototype pollution (UserPatchEngine)', () => {
  const verboseConfig: PatchConfig = { verbosePatch: true };

  it('should reject deeply nested __proto__ in dot-notation path', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: 'name.__proto__.polluted', value: true },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), verboseConfig),
    ).toThrow(PatchError);
  });

  it('should reject constructor in second segment of dot-notation', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'x.constructor.y', value: true },
    ];
    expect(() =>
      UserPatchEngine.apply(ops, makeUserState(), verboseConfig),
    ).toThrow(PatchError);
  });

  it('should accept safe multi-segment dot-notation path', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'name.familyName', value: 'Jones' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), verboseConfig);
    const name = result.payload.name as Record<string, unknown>;
    expect(name.familyName).toBe('Jones');
  });
});

// ─── V20: Reserved attribute stripping (meta, schemas) ────────────────────────

describe('V20 - reserved attribute stripping (UserPatchEngine)', () => {
  it('should strip meta from rawPayload when injected via add op', () => {
    const ops: PatchOperation[] = [
      {
        op: 'add',
        value: {
          displayName: 'Alice',
          meta: { resourceType: 'Hacked' },
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('meta');
  });

  it('should strip schemas from rawPayload when injected via replace op', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'Alice',
          schemas: ['urn:evil:schema'],
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('schemas');
  });

  it('should strip id from rawPayload via reserved attribute protection', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'Alice',
          id: 'hacked-id',
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('id');
  });

  it('should allow non-reserved attributes through', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'Alice',
          nickName: 'Ally',
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).toHaveProperty('nickName', 'Ally');
  });
});

// ─── V20: Reserved attribute stripping (UserPatchEngine) - additional ─────────

describe('V20 - reserved attribute stripping - additional edge cases (UserPatchEngine)', () => {
  it('should strip multiple reserved attributes in a single no-path op', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'Alice',
          meta: { hacked: true },
          schemas: ['urn:evil'],
          id: 'evil-id',
          nickName: 'Ally',
        },
      },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('meta');
    expect(result.payload).not.toHaveProperty('schemas');
    expect(result.payload).not.toHaveProperty('id');
    expect(result.payload).toHaveProperty('nickName', 'Ally');
  });

  it('should strip meta injected via replace with path', () => {
    // meta as a direct path should be treated as a non-recognized field
    // and stripped by stripReservedAttributes at the end of apply()
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'meta', value: { resourceType: 'Evil' } },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('meta');
  });

  it('should strip schemas injected via add with path', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: 'schemas', value: ['urn:evil'] },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), defaultConfig);
    expect(result.payload).not.toHaveProperty('schemas');
  });
});

// ─── V20: meta stripping in GroupPatchEngine ──────────────────────────────────

describe('V20 - reserved attribute stripping (GroupPatchEngine)', () => {
  it('should strip meta from no-path replace in groups', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'NewGroup',
          meta: { resourceType: 'Hacked' },
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(result.payload).not.toHaveProperty('meta');
  });

  it('should strip schemas from no-path replace in groups', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'NewGroup',
          schemas: ['urn:evil'],
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(result.payload).not.toHaveProperty('schemas');
  });

  it('should pass id through in groups (not in group reserved list)', () => {
    // GroupPatchEngine allowlists displayName, externalId, members for
    // dedicated handling and filters schemas/meta/DANGEROUS_KEYS.
    // Other keys like 'id' pass through as generic attributes.
    // The service layer / DB will reject id injection.
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'NewGroup',
          id: 'injected-id',
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    // id flows through as a generic key - service layer handles rejection
    expect(result.payload).toHaveProperty('id', 'injected-id');
  });

  it('should allow non-reserved extra attributes through', () => {
    const ops: PatchOperation[] = [
      {
        op: 'replace',
        value: {
          displayName: 'NewGroup',
          customAttr: 'custom-value',
        },
      },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), groupConfig);
    expect(result.payload).toHaveProperty('customAttr', 'custom-value');
  });
});
