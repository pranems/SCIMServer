import { UserPatchEngine, type UserPatchState } from './user-patch-engine';
import type { PatchOperation, PatchConfig } from './patch-types';
import { PatchError } from './patch-error';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const defaultConfig: PatchConfig = { verbosePatch: false };
const verboseConfig: PatchConfig = { verbosePatch: true };

function makeState(overrides: Partial<UserPatchState> = {}): UserPatchState {
  return {
    userName: 'jdoe@example.com',
    displayName: 'John Doe',
    externalId: 'ext-001',
    active: true,
    rawPayload: {
      displayName: 'John Doe',
      name: { givenName: 'John', familyName: 'Doe' },
      emails: [
        { type: 'work', value: 'jdoe@example.com', primary: true },
      ],
    },
    ...overrides,
  };
}

function apply(
  ops: PatchOperation[],
  state?: Partial<UserPatchState>,
  config?: PatchConfig,
) {
  return UserPatchEngine.apply(ops, makeState(state), config ?? defaultConfig);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('UserPatchEngine', () => {
  // ── Replace simple attributes ──────────────────────────────────────

  describe('replace operations', () => {
    it('should replace active with boolean true', () => {
      const result = apply([{ op: 'replace', path: 'active', value: true }], { active: false });
      expect(result.extractedFields.active).toBe(true);
      // active is a reserved attribute — stripped from rawPayload (managed as DB column)
    });

    it('should replace active with string "True" (Entra compat)', () => {
      const result = apply([{ op: 'replace', path: 'active', value: 'True' }]);
      expect(result.extractedFields.active).toBe(true);
    });

    it('should replace active with string "False"', () => {
      const result = apply([{ op: 'replace', path: 'active', value: 'False' }]);
      expect(result.extractedFields.active).toBe(false);
    });

    it('should replace active when value is nested { active: boolean }', () => {
      const result = apply([{ op: 'replace', path: 'active', value: { active: false } }]);
      expect(result.extractedFields.active).toBe(false);
    });

    it('should replace userName', () => {
      const result = apply([{ op: 'replace', path: 'userName', value: 'new@example.com' }]);
      expect(result.extractedFields.userName).toBe('new@example.com');
    });

    it('should replace displayName', () => {
      const result = apply([{ op: 'replace', path: 'displayName', value: 'Jane Doe' }]);
      expect(result.extractedFields.displayName).toBe('Jane Doe');
      expect(result.payload.displayName).toBe('Jane Doe');
    });

    it('should replace displayName with null', () => {
      const result = apply([{ op: 'replace', path: 'displayName', value: null }]);
      expect(result.extractedFields.displayName).toBeNull();
    });

    it('should replace externalId', () => {
      const result = apply([{ op: 'replace', path: 'externalId', value: 'ext-999' }]);
      expect(result.extractedFields.externalId).toBe('ext-999');
    });

    it('should be case-insensitive on path', () => {
      const result = apply([{ op: 'replace', path: 'UserName', value: 'x@y.com' }]);
      expect(result.extractedFields.userName).toBe('x@y.com');
    });

    it('should replace arbitrary payload attribute', () => {
      const result = apply([{ op: 'replace', path: 'title', value: 'Manager' }]);
      expect(result.payload.title).toBe('Manager');
    });
  });

  // ── Add operations ─────────────────────────────────────────────────

  describe('add operations', () => {
    it('should add a new attribute to rawPayload', () => {
      const result = apply([{ op: 'add', path: 'nickName', value: 'Johnny' }]);
      expect(result.payload.nickName).toBe('Johnny');
    });

    it('should add active field', () => {
      const result = apply([{ op: 'add', path: 'active', value: false }]);
      expect(result.extractedFields.active).toBe(false);
    });

    it('should do no-path add (merge object)', () => {
      const result = apply([{
        op: 'add',
        value: { displayName: 'Updated', title: 'CTO' },
      }]);
      expect(result.extractedFields.displayName).toBe('Updated');
      expect(result.payload.title).toBe('CTO');
    });

    it('should normalize keys in no-path add (case-insensitive)', () => {
      const result = apply([{
        op: 'add',
        value: { UserName: 'norm@test.com', DisplayName: 'Norm' },
      }]);
      expect(result.extractedFields.userName).toBe('norm@test.com');
      expect(result.extractedFields.displayName).toBe('Norm');
    });
  });

  // ── Remove operations ──────────────────────────────────────────────

  describe('remove operations', () => {
    it('should remove active → sets to false', () => {
      const result = apply([{ op: 'remove', path: 'active' }], { active: true });
      expect(result.extractedFields.active).toBe(false);
    });

    it('should remove attribute from rawPayload by name', () => {
      const result = apply(
        [{ op: 'remove', path: 'emails' }],
        { rawPayload: { displayName: 'Test', emails: [{ value: 'a@b.c' }] } },
      );
      expect(result.payload.emails).toBeUndefined();
      expect(result.payload.displayName).toBe('Test');
    });

    it('should throw PatchError when remove has no path', () => {
      expect(() => apply([{ op: 'remove' }])).toThrow(PatchError);
      expect(() => apply([{ op: 'remove' }])).toThrow('Remove operation requires a path');
    });
  });

  // ── ValuePath expressions ──────────────────────────────────────────

  describe('valuePath handling', () => {
    it('should update a specific email via valuePath (replace)', () => {
      const result = apply([{
        op: 'replace',
        path: 'emails[type eq "work"].value',
        value: 'new@work.com',
      }]);
      const emails = result.payload.emails as Array<{ type: string; value: string }>;
      const work = emails.find(e => e.type === 'work');
      expect(work?.value).toBe('new@work.com');
    });

    it('should add entry via valuePath', () => {
      const result = apply([{
        op: 'add',
        path: 'emails[type eq "home"].value',
        value: 'home@test.com',
      }]);
      const emails = result.payload.emails as Array<{ type: string; value: string }>;
      expect(emails.some(e => e.type === 'home')).toBe(true);
    });

    it('should remove entry via valuePath', () => {
      const result = apply([{
        op: 'remove',
        path: 'emails[type eq "work"]',
      }]);
      const emails = result.payload.emails as Array<{ type: string }>;
      expect(emails.some(e => e.type === 'work')).toBe(false);
    });
  });

  // ── Extension URN paths ────────────────────────────────────────────

  describe('extension URN paths', () => {
    it('should update extension attribute (replace)', () => {
      const result = apply([{
        op: 'replace',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'mgr-001', displayName: 'Boss' },
      }]);
      const ext = result.payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      expect(ext?.manager).toEqual({ value: 'mgr-001', displayName: 'Boss' });
    });

    it('should remove extension attribute', () => {
      const state = makeState({
        rawPayload: {
          displayName: 'Test',
          'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
            manager: { value: 'mgr-001' },
            department: 'Engineering',
          },
        },
      });
      const result = UserPatchEngine.apply(
        [{ op: 'remove', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager' }],
        state,
        defaultConfig,
      );
      const ext = result.payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      expect(ext?.manager).toBeUndefined();
      expect(ext?.department).toBe('Engineering');
    });
  });

  // ── Dot-notation paths ─────────────────────────────────────────────

  describe('dot-notation paths (verbose patch)', () => {
    it('should update nested attribute with verbosePatch enabled', () => {
      const result = apply(
        [{ op: 'replace', path: 'name.givenName', value: 'Jane' }],
        undefined,
        verboseConfig,
      );
      const name = result.payload.name as Record<string, unknown>;
      expect(name.givenName).toBe('Jane');
      expect(name.familyName).toBe('Doe'); // unchanged
    });

    it('should create nested object if parent does not exist', () => {
      const result = apply(
        [{ op: 'replace', path: 'name.middleName', value: 'Q' }],
        { rawPayload: { displayName: 'Test' } },
        verboseConfig,
      );
      const name = result.payload.name as Record<string, unknown>;
      expect(name.middleName).toBe('Q');
    });

    it('should ignore dot-notation when verbosePatch is disabled', () => {
      const result = apply(
        [{ op: 'replace', path: 'name.givenName', value: 'Nope' }],
        undefined,
        defaultConfig,
      );
      // Stored as literal key (not navigated into nested)
      expect(result.payload['name.givenName']).toBe('Nope');
    });

    it('should remove nested attribute via dot-notation', () => {
      const result = apply(
        [{ op: 'remove', path: 'name.givenName' }],
        undefined,
        verboseConfig,
      );
      const name = result.payload.name as Record<string, unknown>;
      expect(name.givenName).toBeUndefined();
      expect(name.familyName).toBe('Doe');
    });
  });

  // ── Multiple operations ────────────────────────────────────────────

  describe('multiple operations', () => {
    it('should apply multiple operations sequentially', () => {
      const result = apply([
        { op: 'replace', path: 'active', value: false },
        { op: 'replace', path: 'displayName', value: 'Updated' },
        { op: 'add', path: 'title', value: 'VP' },
      ]);
      expect(result.extractedFields.active).toBe(false);
      expect(result.extractedFields.displayName).toBe('Updated');
      expect(result.payload.title).toBe('VP');
    });
  });

  // ── Reserved attribute stripping ───────────────────────────────────

  describe('reserved attribute stripping', () => {
    it('should strip id, userName, externalId, active from payload', () => {
      const result = apply([{
        op: 'add',
        value: { id: 'bad', userName: 'hack', active: true, title: 'OK' },
      }]);
      expect(result.payload.id).toBeUndefined();
      expect(result.payload.userName).toBeUndefined();
      expect(result.payload.externalId).toBeUndefined();
      // title is not reserved
      expect(result.payload.title).toBe('OK');
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw PatchError for unsupported op', () => {
      expect(() => apply([{ op: 'invalid', path: 'active', value: true }]))
        .toThrow(PatchError);
    });

    it('should throw PatchError for non-string userName', () => {
      expect(() => apply([{ op: 'replace', path: 'userName', value: 123 }]))
        .toThrow(PatchError);
    });

    it('should throw PatchError for non-boolean active', () => {
      expect(() => apply([{ op: 'replace', path: 'active', value: 'maybe' }]))
        .toThrow(PatchError);
    });

    it('should have correct status and scimType on PatchError', () => {
      try {
        apply([{ op: 'remove' }]);
        fail('expected PatchError');
      } catch (e) {
        expect(e).toBeInstanceOf(PatchError);
        expect((e as PatchError).status).toBe(400);
        expect((e as PatchError).scimType).toBe('noTarget');
      }
    });
  });

  // ── Helper methods ─────────────────────────────────────────────────

  describe('normalizeObjectKeys', () => {
    it('should map known SCIM attributes to camelCase', () => {
      const result = UserPatchEngine.normalizeObjectKeys({
        username: 'test',
        DISPLAYNAME: 'Test User',
        phonenumbers: ['+1-234'],
      });
      expect(result.userName).toBe('test');
      expect(result.displayName).toBe('Test User');
      expect(result.phoneNumbers).toEqual(['+1-234']);
    });

    it('should preserve unknown keys as-is', () => {
      const result = UserPatchEngine.normalizeObjectKeys({ customAttr: 'val' });
      expect(result.customAttr).toBe('val');
    });
  });

  describe('stripReservedAttributes', () => {
    it('should remove server-managed keys', () => {
      const result = UserPatchEngine.stripReservedAttributes({
        id: 'x', userName: 'y', externalId: 'z', active: true, title: 'VP',
      });
      expect(Object.keys(result)).toEqual(['title']);
    });
  });

  // ── PATCH on soft-deleted (active=false) users ─────────────────────

  describe('PATCH on soft-deleted state (active=false)', () => {
    it('should replace displayName while preserving active=false', () => {
      const result = apply(
        [{ op: 'replace', path: 'displayName', value: 'Updated Name' }],
        { active: false },
      );
      expect(result.extractedFields.displayName).toBe('Updated Name');
      // active is not changed by this op, but engine tracks initial state
    });

    it('should re-activate user via replace active=true from inactive state', () => {
      const result = apply(
        [{ op: 'replace', path: 'active', value: true }],
        { active: false },
      );
      expect(result.extractedFields.active).toBe(true);
    });

    it('should apply valuePath update on inactive user', () => {
      const result = apply(
        [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'reactivated@work.com' }],
        { active: false },
      );
      const emails = result.payload.emails as Array<{ type: string; value: string }>;
      const work = emails.find(e => e.type === 'work');
      expect(work?.value).toBe('reactivated@work.com');
    });

    it('should apply extension URN update on inactive user', () => {
      const result = apply(
        [{
          op: 'replace',
          path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department',
          value: 'NewDept',
        }],
        { active: false },
      );
      const ext = result.payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      expect(ext?.department).toBe('NewDept');
    });

    it('should apply multiple ops including reactivation', () => {
      const result = apply([
        { op: 'replace', path: 'active', value: true },
        { op: 'replace', path: 'displayName', value: 'Reactivated User' },
        { op: 'add', path: 'title', value: 'Restored' },
      ], { active: false });
      expect(result.extractedFields.active).toBe(true);
      expect(result.extractedFields.displayName).toBe('Reactivated User');
      expect(result.payload.title).toBe('Restored');
    });
  });

  // ── Additional valuePath patterns ──────────────────────────────────

  describe('additional valuePath patterns', () => {
    it('should add to phoneNumbers array via valuePath', () => {
      const result = apply([{
        op: 'add',
        path: 'phoneNumbers[type eq "mobile"].value',
        value: '+1-555-0199',
      }], {
        rawPayload: {
          displayName: 'Test',
          phoneNumbers: [{ type: 'work', value: '+1-555-0100' }],
        },
      });
      const phones = result.payload.phoneNumbers as Array<{ type: string; value: string }>;
      expect(phones.some(p => p.type === 'mobile' && p.value === '+1-555-0199')).toBe(true);
      expect(phones.some(p => p.type === 'work')).toBe(true);
    });

    it('should replace specific phoneNumber via valuePath', () => {
      const result = apply([{
        op: 'replace',
        path: 'phoneNumbers[type eq "work"].value',
        value: '+1-555-9999',
      }], {
        rawPayload: {
          displayName: 'Test',
          phoneNumbers: [
            { type: 'work', value: '+1-555-0100' },
            { type: 'mobile', value: '+1-555-0200' },
          ],
        },
      });
      const phones = result.payload.phoneNumbers as Array<{ type: string; value: string }>;
      const work = phones.find(p => p.type === 'work');
      expect(work?.value).toBe('+1-555-9999');
      const mobile = phones.find(p => p.type === 'mobile');
      expect(mobile?.value).toBe('+1-555-0200');
    });

    it('should remove specific address via valuePath', () => {
      const result = apply([{
        op: 'remove',
        path: 'addresses[type eq "home"]',
      }], {
        rawPayload: {
          displayName: 'Test',
          addresses: [
            { type: 'work', streetAddress: '100 Main St' },
            { type: 'home', streetAddress: '200 Elm St' },
          ],
        },
      });
      const addr = result.payload.addresses as Array<{ type: string }>;
      expect(addr.some(a => a.type === 'home')).toBe(false);
      expect(addr.some(a => a.type === 'work')).toBe(true);
    });

    it('should create array when valuePath target attribute does not exist', () => {
      const result = apply([{
        op: 'add',
        path: 'ims[type eq "skype"].value',
        value: 'john.doe.skype',
      }], {
        rawPayload: { displayName: 'Test' }, // no ims array
      });
      const ims = result.payload.ims as Array<{ type: string; value: string }>;
      expect(ims).toBeDefined();
      expect(ims.some(im => im.type === 'skype' && im.value === 'john.doe.skype')).toBe(true);
    });
  });

  // ── Dot-notation + valuePath combinations ──────────────────────────

  describe('dot-notation + valuePath combinations (verbose)', () => {
    it('should handle dot-notation after valuePath in sequence', () => {
      const result = apply([
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'combo@work.com' },
        { op: 'replace', path: 'name.givenName', value: 'ComboGiven' },
      ], undefined, verboseConfig);
      const emails = result.payload.emails as Array<{ type: string; value: string }>;
      expect(emails.find(e => e.type === 'work')?.value).toBe('combo@work.com');
      expect((result.payload.name as any).givenName).toBe('ComboGiven');
    });

    it('should handle extension URN + dot-notation in same request', () => {
      const result = apply([
        { op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Sales' },
        { op: 'replace', path: 'name.familyName', value: 'NewFamily' },
      ], undefined, verboseConfig);
      const ext = result.payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      expect(ext?.department).toBe('Sales');
      expect((result.payload.name as any).familyName).toBe('NewFamily');
    });
  });

  // ── Custom Extension URN support (BUG-001 fix) ──────────────────────

  describe('custom extension URN support', () => {
    const CUSTOM_URN = 'urn:example:custom:2.0:User';
    const customConfig: PatchConfig = {
      verbosePatch: true,
      extensionUrns: [CUSTOM_URN],
    };

    it('should replace a custom extension attribute via path', () => {
      const result = apply(
        [{ op: 'replace', path: `${CUSTOM_URN}:customField`, value: 'custom-value' }],
        undefined,
        customConfig,
      );
      const ext = result.payload[CUSTOM_URN] as Record<string, unknown>;
      expect(ext?.customField).toBe('custom-value');
    });

    it('should add a custom extension attribute via path', () => {
      const result = apply(
        [{ op: 'add', path: `${CUSTOM_URN}:newField`, value: 42 }],
        undefined,
        customConfig,
      );
      const ext = result.payload[CUSTOM_URN] as Record<string, unknown>;
      expect(ext?.newField).toBe(42);
    });

    it('should remove a custom extension attribute via path', () => {
      const state = makeState({
        rawPayload: {
          displayName: 'John Doe',
          [CUSTOM_URN]: { customField: 'to-remove', otherField: 'keep' },
        },
      });
      const result = UserPatchEngine.apply(
        [{ op: 'remove', path: `${CUSTOM_URN}:customField` }],
        state,
        customConfig,
      );
      const ext = result.payload[CUSTOM_URN] as Record<string, unknown>;
      expect(ext?.customField).toBeUndefined();
      expect(ext?.otherField).toBe('keep');
    });

    it('should resolve custom extension URN keys in no-path replace', () => {
      const result = apply(
        [{ op: 'replace', value: { [`${CUSTOM_URN}:customField`]: 'no-path-value' } }],
        undefined,
        customConfig,
      );
      const ext = result.payload[CUSTOM_URN] as Record<string, unknown>;
      expect(ext?.customField).toBe('no-path-value');
    });

    it('should NOT correctly resolve custom URN without extensionUrns config', () => {
      // Without the custom URN in config, the URN path contains "2.0" which
      // causes misparsing — this is the bug that BUG-001 fixes
      const result = apply(
        [{ op: 'replace', path: `${CUSTOM_URN}:customField`, value: 'val' }],
        undefined,
        { verbosePatch: true }, // No extensionUrns
      );
      // Should NOT create the correct extension namespace
      expect(result.payload[CUSTOM_URN]).toBeUndefined();
    });
  });
});
