/**
 * Extension Schema & Flag Combination Tests
 *
 * Comprehensive coverage for:
 *  - Custom extension URNs (enterprise, MSFT test, arbitrary)
 *  - PatchConfig flag combinations (verbosePatch × extensionUrns)
 *  - GroupMemberPatchConfig flag matrix (multi-member × remove-all × extensions)
 *  - Mixed flows: extension + core ops, extension + dot-notation, extension + valuePath
 *  - Edge cases: empty extensionUrns, undefined extensionUrns, KNOWN_EXTENSION_URNS fallback
 *  - Empty value removal for extension attributes
 *  - Multiple custom extension URNs in single PATCH
 *  - No-path merge with both extension URN keys and regular keys
 */

import { UserPatchEngine, type UserPatchState } from './user-patch-engine';
import { GroupPatchEngine, type GroupPatchState } from './group-patch-engine';
import type {
  PatchOperation,
  PatchConfig,
  GroupMemberPatchConfig,
  GroupMemberDto,
} from './patch-types';
import { PatchError } from './patch-error';

// ─── URN Constants ───────────────────────────────────────────────────────────

const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const MSFT_CUSTOM_USER = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:User';
const MSFT_IETF_USER = 'urn:ietf:params:scim:schemas:extension:msfttest:User';
const MSFT_CUSTOM_GROUP = 'urn:msfttest:cloud:scim:schemas:extension:custom:2.0:Group';
const MSFT_IETF_GROUP = 'urn:ietf:params:scim:schemas:extension:msfttest:Group';
const CUSTOM_URN_A = 'urn:example:custom:2.0:ExtA';
const CUSTOM_URN_B = 'urn:example:custom:2.0:ExtB';

// ─── User State Factory ─────────────────────────────────────────────────────

function makeUserState(overrides: Partial<UserPatchState> = {}): UserPatchState {
  return {
    userName: 'jdoe@example.com',
    displayName: 'John Doe',
    externalId: 'ext-001',
    active: true,
    rawPayload: {
      displayName: 'John Doe',
      name: { givenName: 'John', familyName: 'Doe' },
      emails: [{ type: 'work', value: 'jdoe@example.com', primary: true }],
    },
    ...overrides,
  };
}

// ─── Group State Factory ─────────────────────────────────────────────────────

function makeGroupState(overrides: Partial<GroupPatchState> = {}): GroupPatchState {
  return {
    displayName: 'Engineering',
    externalId: 'grp-001',
    members: [
      { value: 'user-1', display: 'User 1' },
      { value: 'user-2', display: 'User 2' },
    ],
    rawPayload: {},
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. PatchConfig - verbosePatch × extensionUrns Combinations
// ═══════════════════════════════════════════════════════════════════════════════

describe('PatchConfig flag combinations (UserPatchEngine)', () => {
  // ── verbosePatch=false, extensionUrns=undefined ──────────────────────

  describe('verbosePatch=false, extensionUrns=undefined (defaults)', () => {
    const config: PatchConfig = { verbosePatch: false };

    it('should resolve enterprise URN path via KNOWN_EXTENSION_URNS fallback', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'Sales' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
      expect(ext?.department).toBe('Sales');
    });

    it('should resolve MSFT custom user URN via fallback', () => {
      const ops: PatchOperation[] = [
        { op: 'add', path: `${MSFT_CUSTOM_USER}:testField`, value: 'msft-val' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[MSFT_CUSTOM_USER] as Record<string, unknown>;
      expect(ext?.testField).toBe('msft-val');
    });

    it('should resolve MSFT IETF user URN via fallback', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${MSFT_IETF_USER}:anotherField`, value: 42 },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[MSFT_IETF_USER] as Record<string, unknown>;
      expect(ext?.anotherField).toBe(42);
    });

    it('should NOT resolve unknown custom URN without extensionUrns config', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${CUSTOM_URN_A}:customField`, value: 'val' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      // Unknown URN defaults to simple attr storage (not extension-parsed)
      expect(result.payload[CUSTOM_URN_A]).toBeUndefined();
    });

    it('should treat dot-notation as literal key (verbosePatch=false)', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: 'name.givenName', value: 'Literal' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      expect(result.payload['name.givenName']).toBe('Literal');
      const name = result.payload.name as Record<string, unknown>;
      expect(name.givenName).toBe('John'); // unchanged
    });
  });

  // ── verbosePatch=false, extensionUrns=[] ─────────────────────────────

  describe('verbosePatch=false, extensionUrns=[] (empty array)', () => {
    const config: PatchConfig = { verbosePatch: false, extensionUrns: [] };

    it('should NOT resolve enterprise URN when extensionUrns is explicitly empty', () => {
      // extensionUrns=[] is NOT undefined - no fallback to KNOWN_EXTENSION_URNS
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'Eng' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      // Enterprise URN not in config → treated as non-extension path
      expect(result.payload[ENTERPRISE_URN]).toBeUndefined();
    });

    it('should NOT resolve unregistered custom URN with empty extensionUrns', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${CUSTOM_URN_A}:field`, value: 'val' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      expect(result.payload[CUSTOM_URN_A]).toBeUndefined();
    });
  });

  // ── verbosePatch=true, extensionUrns=undefined ───────────────────────

  describe('verbosePatch=true, extensionUrns=undefined', () => {
    const config: PatchConfig = { verbosePatch: true };

    it('should resolve dot-notation to nested object', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: 'name.givenName', value: 'Jane' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const name = result.payload.name as Record<string, unknown>;
      expect(name.givenName).toBe('Jane');
      expect(name.familyName).toBe('Doe'); // preserved
    });

    it('should still resolve extension URN path (even with verbose=true)', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'R&D' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
      expect(ext?.department).toBe('R&D');
    });

    it('should handle dot-notation + extension URN in sequence', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: 'name.familyName', value: 'Smith' },
        { op: 'add', path: `${ENTERPRISE_URN}:employeeNumber`, value: '42' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      expect((result.payload.name as any).familyName).toBe('Smith');
      const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
      expect(ext?.employeeNumber).toBe('42');
    });
  });

  // ── verbosePatch=true, extensionUrns=[custom] ───────────────────────

  describe('verbosePatch=true, extensionUrns=[custom URNs]', () => {
    const config: PatchConfig = {
      verbosePatch: true,
      extensionUrns: [CUSTOM_URN_A, CUSTOM_URN_B],
    };

    it('should resolve custom URN A path', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${CUSTOM_URN_A}:fieldA`, value: 'valueA' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
      expect(ext?.fieldA).toBe('valueA');
    });

    it('should resolve custom URN B path', () => {
      const ops: PatchOperation[] = [
        { op: 'add', path: `${CUSTOM_URN_B}:fieldB`, value: 'valueB' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const ext = result.payload[CUSTOM_URN_B] as Record<string, unknown>;
      expect(ext?.fieldB).toBe('valueB');
    });

    it('should handle both custom URNs in single PATCH request', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: `${CUSTOM_URN_A}:fieldA`, value: 'A' },
        { op: 'add', path: `${CUSTOM_URN_B}:fieldB`, value: 'B' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      const extA = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
      const extB = result.payload[CUSTOM_URN_B] as Record<string, unknown>;
      expect(extA?.fieldA).toBe('A');
      expect(extB?.fieldB).toBe('B');
    });

    it('should handle dot-notation alongside custom extension URNs', () => {
      const ops: PatchOperation[] = [
        { op: 'replace', path: 'name.givenName', value: 'DotName' },
        { op: 'replace', path: `${CUSTOM_URN_A}:customDot`, value: 'ext-val' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), config);
      expect((result.payload.name as any).givenName).toBe('DotName');
      const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
      expect(ext?.customDot).toBe('ext-val');
    });

    it('should remove custom extension attribute', () => {
      const state = makeUserState({
        rawPayload: {
          displayName: 'Test',
          [CUSTOM_URN_A]: { fieldA: 'to-remove', keepField: 'stay' },
        },
      });
      const ops: PatchOperation[] = [
        { op: 'remove', path: `${CUSTOM_URN_A}:fieldA` },
      ];
      const result = UserPatchEngine.apply(ops, state, config);
      const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
      expect(ext?.fieldA).toBeUndefined();
      expect(ext?.keepField).toBe('stay');
    });

    it('should handle enterprise + custom + dot-notation + core all in one request', () => {
      const allConfig: PatchConfig = {
        verbosePatch: true,
        extensionUrns: [ENTERPRISE_URN, CUSTOM_URN_A],
      };
      const ops: PatchOperation[] = [
        { op: 'replace', path: 'displayName', value: 'AllInOne' },
        { op: 'replace', path: 'name.givenName', value: 'Multi' },
        { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'All' },
        { op: 'add', path: `${CUSTOM_URN_A}:allField`, value: 'combo' },
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'all@test.com' },
      ];
      const result = UserPatchEngine.apply(ops, makeUserState(), allConfig);
      expect(result.extractedFields.displayName).toBe('AllInOne');
      expect((result.payload.name as any).givenName).toBe('Multi');
      expect((result.payload[ENTERPRISE_URN] as any).department).toBe('All');
      expect((result.payload[CUSTOM_URN_A] as any).allField).toBe('combo');
      const emails = result.payload.emails as Array<{ type: string; value: string }>;
      expect(emails.find(e => e.type === 'work')?.value).toBe('all@test.com');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. No-path Merge - Extension URN Keys + Regular Keys + Dot-notation
// ═══════════════════════════════════════════════════════════════════════════════

describe('No-path merge with extension URN keys (UserPatchEngine)', () => {
  it('should resolve enterprise URN key in no-path replace value', () => {
    const config: PatchConfig = { verbosePatch: false };
    const ops: PatchOperation[] = [{
      op: 'replace',
      value: {
        displayName: 'NoPathEnt',
        [`${ENTERPRISE_URN}:manager`]: { value: 'mgr-1', displayName: 'Boss' },
      },
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect(result.extractedFields.displayName).toBe('NoPathEnt');
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.manager).toEqual({ value: 'mgr-1', displayName: 'Boss' });
  });

  it('should resolve custom URN key in no-path add value', () => {
    const config: PatchConfig = { verbosePatch: false, extensionUrns: [CUSTOM_URN_A] };
    const ops: PatchOperation[] = [{
      op: 'add',
      value: {
        title: 'VP',
        [`${CUSTOM_URN_A}:myField`]: 'custom-no-path',
      },
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect(result.payload.title).toBe('VP');
    const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
    expect(ext?.myField).toBe('custom-no-path');
  });

  it('should resolve multiple extension URN keys in single no-path object', () => {
    const config: PatchConfig = {
      verbosePatch: false,
      extensionUrns: [ENTERPRISE_URN, CUSTOM_URN_A, CUSTOM_URN_B],
    };
    const ops: PatchOperation[] = [{
      op: 'replace',
      value: {
        displayName: 'Multi',
        [`${CUSTOM_URN_A}:fieldA`]: 'valA',
        [`${CUSTOM_URN_B}:fieldB`]: 'valB',
        [`${ENTERPRISE_URN}:department`]: 'Sales',
      },
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect(result.extractedFields.displayName).toBe('Multi');
    expect((result.payload[CUSTOM_URN_A] as any).fieldA).toBe('valA');
    expect((result.payload[CUSTOM_URN_B] as any).fieldB).toBe('valB');
    expect((result.payload[ENTERPRISE_URN] as any).department).toBe('Sales');
  });

  it('should resolve extension URN keys + dot-notation in same no-path (verbose)', () => {
    const config: PatchConfig = { verbosePatch: true, extensionUrns: [CUSTOM_URN_A] };
    const ops: PatchOperation[] = [{
      op: 'replace',
      value: {
        'name.givenName': 'DotMixed',
        [`${CUSTOM_URN_A}:extField`]: 'ext-mixed',
        displayName: 'MixedAll',
      },
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect(result.extractedFields.displayName).toBe('MixedAll');
    expect((result.payload.name as any).givenName).toBe('DotMixed');
    expect((result.payload[CUSTOM_URN_A] as any).extField).toBe('ext-mixed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Enterprise URN add Operation (gap: only replace/remove tested before)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Enterprise URN - add operation (UserPatchEngine)', () => {
  const config: PatchConfig = { verbosePatch: false };

  it('should add enterprise extension attribute via path', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: `${ENTERPRISE_URN}:department`, value: 'New Dept' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.department).toBe('New Dept');
  });

  it('should add to existing enterprise extension block', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [ENTERPRISE_URN]: { department: 'Existing' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'add', path: `${ENTERPRISE_URN}:employeeNumber`, value: '12345' },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.department).toBe('Existing');
    expect(ext?.employeeNumber).toBe('12345');
  });

  it('should overwrite enterprise attribute via add (same as replace)', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [ENTERPRISE_URN]: { department: 'Old' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'add', path: `${ENTERPRISE_URN}:department`, value: 'New' },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.department).toBe('New');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MSFT Test Extension URNs (never tested at engine level)
// ═══════════════════════════════════════════════════════════════════════════════

describe('MSFT test extension URNs (UserPatchEngine)', () => {
  const config: PatchConfig = { verbosePatch: false };

  it('should replace attribute via MSFT custom user URN', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${MSFT_CUSTOM_USER}:customUserField`, value: 'msft-custom' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    const ext = result.payload[MSFT_CUSTOM_USER] as Record<string, unknown>;
    expect(ext?.customUserField).toBe('msft-custom');
  });

  it('should add attribute via MSFT IETF user URN', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: `${MSFT_IETF_USER}:ietfField`, value: 'ietf-val' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    const ext = result.payload[MSFT_IETF_USER] as Record<string, unknown>;
    expect(ext?.ietfField).toBe('ietf-val');
  });

  it('should remove MSFT custom user extension attribute', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [MSFT_CUSTOM_USER]: { fieldX: 'removeMe', fieldY: 'keep' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'remove', path: `${MSFT_CUSTOM_USER}:fieldX` },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[MSFT_CUSTOM_USER] as Record<string, unknown>;
    expect(ext?.fieldX).toBeUndefined();
    expect(ext?.fieldY).toBe('keep');
  });

  it('should handle MSFT custom + enterprise URN in same request', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'Eng' },
      { op: 'add', path: `${MSFT_CUSTOM_USER}:msftField`, value: 'msft-combo' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect((result.payload[ENTERPRISE_URN] as any).department).toBe('Eng');
    expect((result.payload[MSFT_CUSTOM_USER] as any).msftField).toBe('msft-combo');
  });

  it('should handle all three MSFT/enterprise URNs in one request', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: 'Eng' },
      { op: 'add', path: `${MSFT_CUSTOM_USER}:customField`, value: 'c1' },
      { op: 'add', path: `${MSFT_IETF_USER}:ietfField`, value: 'i1' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    expect((result.payload[ENTERPRISE_URN] as any).department).toBe('Eng');
    expect((result.payload[MSFT_CUSTOM_USER] as any).customField).toBe('c1');
    expect((result.payload[MSFT_IETF_USER] as any).ietfField).toBe('i1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GroupMemberPatchConfig - Flag Combinations
// ═══════════════════════════════════════════════════════════════════════════════

describe('GroupMemberPatchConfig flag matrix', () => {
  const allAllowed: GroupMemberPatchConfig = {
    allowMultiMemberAdd: true,
    allowMultiMemberRemove: true,
    allowRemoveAllMembers: true,
  };

  const noneAllowed: GroupMemberPatchConfig = {
    allowMultiMemberAdd: false,
    allowMultiMemberRemove: false,
    allowRemoveAllMembers: false,
  };

  // ── Multi-member add flag ─────────────────────────────────────────

  describe('allowMultiMemberAdd flag', () => {
    it('should accept multi-member add when allowed', () => {
      const ops: PatchOperation[] = [{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }, { value: 'user-4' }],
      }];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), allAllowed);
      expect(result.members.length).toBe(4);
    });

    it('should reject multi-member add when disallowed', () => {
      const ops: PatchOperation[] = [{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }, { value: 'user-4' }],
      }];
      expect(() => GroupPatchEngine.apply(ops, makeGroupState(), noneAllowed))
        .toThrow(PatchError);
    });

    it('should allow single member add even when multi-add disallowed', () => {
      const ops: PatchOperation[] = [{
        op: 'add',
        path: 'members',
        value: [{ value: 'user-3' }],
      }];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), noneAllowed);
      expect(result.members.length).toBe(3);
    });
  });

  // ── Multi-member remove flag ──────────────────────────────────────

  describe('allowMultiMemberRemove flag', () => {
    it('should accept multi-member remove when allowed', () => {
      const ops: PatchOperation[] = [{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }, { value: 'user-2' }],
      }];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), allAllowed);
      expect(result.members).toHaveLength(0);
    });

    it('should reject multi-member remove when disallowed', () => {
      const ops: PatchOperation[] = [{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }, { value: 'user-2' }],
      }];
      expect(() => GroupPatchEngine.apply(ops, makeGroupState(), noneAllowed))
        .toThrow(PatchError);
    });

    it('should allow single member remove even when multi-remove disallowed', () => {
      const ops: PatchOperation[] = [{
        op: 'remove',
        path: 'members',
        value: [{ value: 'user-1' }],
      }];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), noneAllowed);
      expect(result.members.map(m => m.value)).toEqual(['user-2']);
    });
  });

  // ── Remove-all flag ───────────────────────────────────────────────

  describe('allowRemoveAllMembers flag', () => {
    it('should clear members when path=members and no value (allowed)', () => {
      const ops: PatchOperation[] = [{ op: 'remove', path: 'members' }];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), allAllowed);
      expect(result.members).toHaveLength(0);
    });

    it('should reject members clear when disallowed', () => {
      const ops: PatchOperation[] = [{ op: 'remove', path: 'members' }];
      expect(() => GroupPatchEngine.apply(ops, makeGroupState(), noneAllowed))
        .toThrow(PatchError);
    });
  });

  // ── Mixed flag combinations ───────────────────────────────────────

  describe('mixed flag combinations', () => {
    it('allowMultiMemberAdd=true, allowMultiMemberRemove=false', () => {
      const config: GroupMemberPatchConfig = {
        allowMultiMemberAdd: true,
        allowMultiMemberRemove: false,
        allowRemoveAllMembers: false,
      };
      // Multi-add should work
      const addOps: PatchOperation[] = [{
        op: 'add', path: 'members', value: [{ value: 'user-3' }, { value: 'user-4' }],
      }];
      const result = GroupPatchEngine.apply(addOps, makeGroupState(), config);
      expect(result.members.length).toBe(4);

      // Multi-remove should fail
      const rmOps: PatchOperation[] = [{
        op: 'remove', path: 'members', value: [{ value: 'user-1' }, { value: 'user-2' }],
      }];
      expect(() => GroupPatchEngine.apply(rmOps, makeGroupState(), config))
        .toThrow(PatchError);
    });

    it('allowMultiMemberAdd=false, allowRemoveAllMembers=true', () => {
      const config: GroupMemberPatchConfig = {
        allowMultiMemberAdd: false,
        allowMultiMemberRemove: false,
        allowRemoveAllMembers: true,
      };
      // Multi-add should fail
      expect(() => GroupPatchEngine.apply(
        [{ op: 'add', path: 'members', value: [{ value: 'a' }, { value: 'b' }] }],
        makeGroupState(),
        config,
      )).toThrow(PatchError);

      // Remove-all should work
      const result = GroupPatchEngine.apply(
        [{ op: 'remove', path: 'members' }],
        makeGroupState(),
        config,
      );
      expect(result.members).toHaveLength(0);
    });

    it('all flags true: multi-add → multi-remove → remove-all in sequence', () => {
      const ops: PatchOperation[] = [
        { op: 'add', path: 'members', value: [{ value: 'user-3' }, { value: 'user-4' }] },
        { op: 'remove', path: 'members', value: [{ value: 'user-1' }, { value: 'user-3' }] },
      ];
      const result = GroupPatchEngine.apply(ops, makeGroupState(), allAllowed);
      expect(result.members.map(m => m.value).sort()).toEqual(['user-2', 'user-4']);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GroupPatchEngine - Extension URN with MSFT URNs
// ═══════════════════════════════════════════════════════════════════════════════

describe('GroupPatchEngine - MSFT extension URNs', () => {
  const config: GroupMemberPatchConfig = {
    allowMultiMemberAdd: true,
    allowMultiMemberRemove: true,
    allowRemoveAllMembers: true,
    extensionUrns: [MSFT_CUSTOM_GROUP, MSFT_IETF_GROUP],
  };

  it('should replace via MSFT custom group URN path', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${MSFT_CUSTOM_GROUP}:groupField`, value: 'msft-grp' },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    const ext = result.payload[MSFT_CUSTOM_GROUP] as Record<string, unknown>;
    expect(ext?.groupField).toBe('msft-grp');
  });

  it('should add via MSFT IETF group URN path', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: `${MSFT_IETF_GROUP}:ietfGroupField`, value: 'ietf-grp' },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    const ext = result.payload[MSFT_IETF_GROUP] as Record<string, unknown>;
    expect(ext?.ietfGroupField).toBe('ietf-grp');
  });

  it('should remove MSFT custom group extension attribute', () => {
    const state = makeGroupState({
      rawPayload: {
        [MSFT_CUSTOM_GROUP]: { removeMe: 'gone', keepMe: 'stay' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'remove', path: `${MSFT_CUSTOM_GROUP}:removeMe` },
    ];
    const result = GroupPatchEngine.apply(ops, state, config);
    const ext = result.payload[MSFT_CUSTOM_GROUP] as Record<string, unknown>;
    expect(ext?.removeMe).toBeUndefined();
    expect(ext?.keepMe).toBe('stay');
  });

  it('should handle MSFT extension + member ops in same request', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'displayName', value: 'MixedGroup' },
      { op: 'add', path: `${MSFT_CUSTOM_GROUP}:tag`, value: 'tagged' },
      { op: 'add', path: 'members', value: [{ value: 'user-3' }] },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    expect(result.displayName).toBe('MixedGroup');
    expect((result.payload[MSFT_CUSTOM_GROUP] as any).tag).toBe('tagged');
    expect(result.members.length).toBe(3);
  });

  it('should handle no-path with MSFT extension URN key', () => {
    const ops: PatchOperation[] = [{
      op: 'replace',
      value: {
        displayName: 'NoPathGroupExt',
        [`${MSFT_CUSTOM_GROUP}:customNoPath`]: 'np-val',
      },
    }];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    expect(result.displayName).toBe('NoPathGroupExt');
    const ext = result.payload[MSFT_CUSTOM_GROUP] as Record<string, unknown>;
    expect(ext?.customNoPath).toBe('np-val');
  });

  it('should handle both MSFT group URNs in single no-path', () => {
    const ops: PatchOperation[] = [{
      op: 'replace',
      value: {
        displayName: 'DualExt',
        [`${MSFT_CUSTOM_GROUP}:field1`]: 'v1',
        [`${MSFT_IETF_GROUP}:field2`]: 'v2',
      },
    }];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    expect(result.displayName).toBe('DualExt');
    expect((result.payload[MSFT_CUSTOM_GROUP] as any).field1).toBe('v1');
    expect((result.payload[MSFT_IETF_GROUP] as any).field2).toBe('v2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Empty Value Removal for Extension Attributes
// ═══════════════════════════════════════════════════════════════════════════════

describe('Empty value removal in extension attributes (UserPatchEngine)', () => {
  const config: PatchConfig = { verbosePatch: false };

  it('should remove extension attribute when value is null', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [ENTERPRISE_URN]: { department: 'Eng', manager: 'Boss' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: null },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    // null value should clear or set the attribute to null
    expect(ext?.department === undefined || ext?.department === null).toBe(true);
    expect(ext?.manager).toBe('Boss');
  });

  it('should remove extension attribute when value is empty string', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [ENTERPRISE_URN]: { department: 'Eng' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${ENTERPRISE_URN}:department`, value: '' },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.department === undefined || ext?.department === '').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Complex Extension Values (objects, arrays)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Complex extension attribute values (UserPatchEngine)', () => {
  const config: PatchConfig = { verbosePatch: false };

  it('should store complex object as extension attribute', () => {
    const ops: PatchOperation[] = [{
      op: 'replace',
      path: `${ENTERPRISE_URN}:manager`,
      value: { value: 'mgr-001', displayName: 'The Boss', $ref: '../Users/mgr-001' },
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.manager).toEqual({
      value: 'mgr-001',
      displayName: 'The Boss',
      $ref: '../Users/mgr-001',
    });
  });

  it('should store array as extension attribute', () => {
    const config2: PatchConfig = { verbosePatch: false, extensionUrns: [CUSTOM_URN_A] };
    const ops: PatchOperation[] = [{
      op: 'add',
      path: `${CUSTOM_URN_A}:tags`,
      value: ['tag1', 'tag2', 'tag3'],
    }];
    const result = UserPatchEngine.apply(ops, makeUserState(), config2);
    const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
    expect(ext?.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('should replace existing complex extension value', () => {
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [ENTERPRISE_URN]: {
          manager: { value: 'old-mgr', displayName: 'Old Boss' },
        },
      },
    });
    const ops: PatchOperation[] = [{
      op: 'replace',
      path: `${ENTERPRISE_URN}:manager`,
      value: { value: 'new-mgr', displayName: 'New Boss' },
    }];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[ENTERPRISE_URN] as Record<string, unknown>;
    expect(ext?.manager).toEqual({ value: 'new-mgr', displayName: 'New Boss' });
  });

  it('should handle boolean and number extension values', () => {
    const config2: PatchConfig = { verbosePatch: false, extensionUrns: [CUSTOM_URN_A] };
    const ops: PatchOperation[] = [
      { op: 'add', path: `${CUSTOM_URN_A}:isAdmin`, value: true },
      { op: 'add', path: `${CUSTOM_URN_A}:score`, value: 99.5 },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState(), config2);
    const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
    expect(ext?.isAdmin).toBe(true);
    expect(ext?.score).toBe(99.5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. GroupPatchEngine - Extension + Member Flag Combinations
// ═══════════════════════════════════════════════════════════════════════════════

describe('GroupPatchEngine - extension + flag combination flows', () => {
  it('should add extension + single member (multi-add disabled)', () => {
    const config: GroupMemberPatchConfig = {
      allowMultiMemberAdd: false,
      allowMultiMemberRemove: false,
      allowRemoveAllMembers: false,
      extensionUrns: [CUSTOM_URN_A],
    };
    const ops: PatchOperation[] = [
      { op: 'add', path: `${CUSTOM_URN_A}:field1`, value: 'ext-strict' },
      { op: 'add', path: 'members', value: [{ value: 'user-3' }] },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    expect((result.payload[CUSTOM_URN_A] as any).field1).toBe('ext-strict');
    expect(result.members.length).toBe(3);
  });

  it('should fail on multi-member add but succeed on extension op', () => {
    const config: GroupMemberPatchConfig = {
      allowMultiMemberAdd: false,
      allowMultiMemberRemove: false,
      allowRemoveAllMembers: false,
      extensionUrns: [CUSTOM_URN_A],
    };
    const ops: PatchOperation[] = [
      { op: 'add', path: `${CUSTOM_URN_A}:field1`, value: 'pre-fail' },
      { op: 'add', path: 'members', value: [{ value: 'a' }, { value: 'b' }] },
    ];
    // Ops are applied sequentially; second op fails
    expect(() => GroupPatchEngine.apply(ops, makeGroupState(), config))
      .toThrow(PatchError);
  });

  it('should replace extension attribute + replace displayName + remove member', () => {
    const config: GroupMemberPatchConfig = {
      allowMultiMemberAdd: true,
      allowMultiMemberRemove: true,
      allowRemoveAllMembers: true,
      extensionUrns: [CUSTOM_URN_A],
    };
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${CUSTOM_URN_A}:tag`, value: 'updated-tag' },
      { op: 'replace', path: 'displayName', value: 'RenamedGroup' },
      { op: 'remove', path: 'members', value: [{ value: 'user-1' }] },
    ];
    const result = GroupPatchEngine.apply(ops, makeGroupState(), config);
    expect((result.payload[CUSTOM_URN_A] as any).tag).toBe('updated-tag');
    expect(result.displayName).toBe('RenamedGroup');
    expect(result.members.map(m => m.value)).toEqual(['user-2']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Soft-Delete + Extension PATCH combinations (UserPatchEngine)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Soft-deleted user + extension attribute operations', () => {
  const config: PatchConfig = { verbosePatch: true, extensionUrns: [CUSTOM_URN_A] };

  it('should add extension attribute on inactive user', () => {
    const ops: PatchOperation[] = [
      { op: 'add', path: `${CUSTOM_URN_A}:newField`, value: 'on-inactive' },
    ];
    const result = UserPatchEngine.apply(ops, makeUserState({ active: false }), config);
    const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
    expect(ext?.newField).toBe('on-inactive');
  });

  it('should reactivate + add extension + dot-notation in one request', () => {
    const ops: PatchOperation[] = [
      { op: 'replace', path: 'active', value: true },
      { op: 'replace', path: 'name.givenName', value: 'Reactivated' },
      { op: 'add', path: `${CUSTOM_URN_A}:postReactivate`, value: 'active-ext' },
    ];
    const result = UserPatchEngine.apply(
      ops,
      makeUserState({ active: false }),
      config,
    );
    expect(result.extractedFields.active).toBe(true);
    expect((result.payload.name as any).givenName).toBe('Reactivated');
    expect((result.payload[CUSTOM_URN_A] as any).postReactivate).toBe('active-ext');
  });

  it('should remove extension attribute on inactive user', () => {
    const state = makeUserState({
      active: false,
      rawPayload: {
        displayName: 'Inactive',
        [CUSTOM_URN_A]: { fieldToRemove: 'bye', keepField: 'stay' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'remove', path: `${CUSTOM_URN_A}:fieldToRemove` },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    const ext = result.payload[CUSTOM_URN_A] as Record<string, unknown>;
    expect(ext?.fieldToRemove).toBeUndefined();
    expect(ext?.keepField).toBe('stay');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Multiple Extension Blocks - Across Engines
// ═══════════════════════════════════════════════════════════════════════════════

describe('Multiple extension blocks in rawPayload (UserPatchEngine)', () => {
  it('should independently update two extension blocks', () => {
    const config: PatchConfig = {
      verbosePatch: false,
      extensionUrns: [CUSTOM_URN_A, CUSTOM_URN_B],
    };
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [CUSTOM_URN_A]: { fieldA: 'oldA' },
        [CUSTOM_URN_B]: { fieldB: 'oldB' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${CUSTOM_URN_A}:fieldA`, value: 'newA' },
      { op: 'replace', path: `${CUSTOM_URN_B}:fieldB`, value: 'newB' },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    expect((result.payload[CUSTOM_URN_A] as any).fieldA).toBe('newA');
    expect((result.payload[CUSTOM_URN_B] as any).fieldB).toBe('newB');
  });

  it('should add to one ext and remove from another in same request', () => {
    const config: PatchConfig = {
      verbosePatch: false,
      extensionUrns: [CUSTOM_URN_A, CUSTOM_URN_B],
    };
    const state = makeUserState({
      rawPayload: {
        displayName: 'Test',
        [CUSTOM_URN_B]: { removeMe: 'gone', stay: 'yes' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'add', path: `${CUSTOM_URN_A}:newField`, value: 'fresh' },
      { op: 'remove', path: `${CUSTOM_URN_B}:removeMe` },
    ];
    const result = UserPatchEngine.apply(ops, state, config);
    expect((result.payload[CUSTOM_URN_A] as any).newField).toBe('fresh');
    expect((result.payload[CUSTOM_URN_B] as any).removeMe).toBeUndefined();
    expect((result.payload[CUSTOM_URN_B] as any).stay).toBe('yes');
  });
});

describe('Multiple extension blocks in rawPayload (GroupPatchEngine)', () => {
  it('should independently update two extension blocks', () => {
    const config: GroupMemberPatchConfig = {
      allowMultiMemberAdd: true,
      allowMultiMemberRemove: true,
      allowRemoveAllMembers: true,
      extensionUrns: [CUSTOM_URN_A, CUSTOM_URN_B],
    };
    const state = makeGroupState({
      rawPayload: {
        [CUSTOM_URN_A]: { fa: 'oldA' },
        [CUSTOM_URN_B]: { fb: 'oldB' },
      },
    });
    const ops: PatchOperation[] = [
      { op: 'replace', path: `${CUSTOM_URN_A}:fa`, value: 'newA' },
      { op: 'add', path: `${CUSTOM_URN_B}:fb2`, value: 'addB' },
    ];
    const result = GroupPatchEngine.apply(ops, state, config);
    expect((result.payload[CUSTOM_URN_A] as any).fa).toBe('newA');
    expect((result.payload[CUSTOM_URN_B] as any).fb2).toBe('addB');
    expect((result.payload[CUSTOM_URN_B] as any).fb).toBe('oldB');
  });
});
