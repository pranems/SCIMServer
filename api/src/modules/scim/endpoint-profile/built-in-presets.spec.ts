/**
 * Unit Tests — Built-in Profile Presets (Phase 13, Step 1.4)
 *
 * Validates all 5 built-in presets have correct structure, the lookup
 * functions work, the default preset is entra-id, and each preset's
 * schemas/resourceTypes/serviceProviderConfig/settings are well-formed.
 */
import {
  PRESET_ENTRA_ID,
  PRESET_ENTRA_ID_MINIMAL,
  PRESET_RFC_STANDARD,
  PRESET_MINIMAL,
  PRESET_USER_ONLY,
  DEFAULT_PRESET_NAME,
  BUILT_IN_PRESETS,
  PRESET_NAMES,
  getBuiltInPreset,
  getAllPresetMetadata,
  loadPresetsFromDisk,
  reloadPresetsFromDisk,
  getLastLoadResult,
  getPresetsDir,
  validatePreset,
} from './built-in-presets';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
  MSFTTEST_CUSTOM_USER_SCHEMA,
  MSFTTEST_CUSTOM_GROUP_SCHEMA,
  MSFTTEST_IETF_USER_SCHEMA,
  MSFTTEST_IETF_GROUP_SCHEMA,
} from '../common/scim-constants';

describe('built-in-presets', () => {
  // ─── Preset Constants ─────────────────────────────────────────────────

  describe('preset name constants', () => {
    it('should have correct name values', () => {
      expect(PRESET_ENTRA_ID).toBe('entra-id');
      expect(PRESET_ENTRA_ID_MINIMAL).toBe('entra-id-minimal');
      expect(PRESET_RFC_STANDARD).toBe('rfc-standard');
      expect(PRESET_MINIMAL).toBe('minimal');
      expect(PRESET_USER_ONLY).toBe('user-only');
    });

    it('should default to entra-id (decision D5)', () => {
      expect(DEFAULT_PRESET_NAME).toBe('entra-id');
    });
  });

  // ─── BUILT_IN_PRESETS Map ─────────────────────────────────────────────

  describe('BUILT_IN_PRESETS', () => {
    it('should contain exactly 5 presets', () => {
      expect(BUILT_IN_PRESETS.size).toBe(5);
    });

    it('should contain all named presets', () => {
      expect(BUILT_IN_PRESETS.has(PRESET_ENTRA_ID)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_ENTRA_ID_MINIMAL)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_RFC_STANDARD)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_MINIMAL)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_USER_ONLY)).toBe(true);
    });

    it('should not contain "custom" (decision D13 — dropped)', () => {
      expect(BUILT_IN_PRESETS.has('custom')).toBe(false);
    });

    it('should not contain old "standard" name (decision D12 — renamed to rfc-standard)', () => {
      expect(BUILT_IN_PRESETS.has('standard')).toBe(false);
    });

    it('should not contain old "azure-ad" name (renamed to entra-id)', () => {
      expect(BUILT_IN_PRESETS.has('azure-ad')).toBe(false);
    });
  });

  describe('PRESET_NAMES', () => {
    it('should have 5 entries in display order', () => {
      expect(PRESET_NAMES).toHaveLength(5);
      expect(PRESET_NAMES[0]).toBe(PRESET_ENTRA_ID);
      expect(PRESET_NAMES[1]).toBe(PRESET_ENTRA_ID_MINIMAL);
    });
  });

  // ─── getBuiltInPreset() ───────────────────────────────────────────────

  describe('getBuiltInPreset()', () => {
    it('should return entra-id preset', () => {
      const preset = getBuiltInPreset('entra-id');
      expect(preset).toBeDefined();
      expect(preset.metadata.name).toBe('entra-id');
    });

    it('should return rfc-standard preset', () => {
      const preset = getBuiltInPreset('rfc-standard');
      expect(preset.metadata.name).toBe('rfc-standard');
    });

    it('should throw for unknown preset name', () => {
      expect(() => getBuiltInPreset('nonexistent')).toThrow('Unknown preset "nonexistent"');
    });

    it('should throw with list of valid presets in error message', () => {
      try {
        getBuiltInPreset('bad');
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('entra-id');
        expect(e.message).toContain('rfc-standard');
        expect(e.message).toContain('minimal');
      }
    });
  });

  // ─── getAllPresetMetadata() ────────────────────────────────────────────

  describe('getAllPresetMetadata()', () => {
    it('should return 5 metadata entries', () => {
      const metadata = getAllPresetMetadata();
      expect(metadata).toHaveLength(5);
    });

    it('should have name and description on each entry', () => {
      const metadata = getAllPresetMetadata();
      for (const m of metadata) {
        expect(m.name).toBeDefined();
        expect(typeof m.name).toBe('string');
        expect(m.description).toBeDefined();
        expect(typeof m.description).toBe('string');
        expect(m.description.length).toBeGreaterThan(0);
      }
    });

    it('should mark entra-id as default', () => {
      const metadata = getAllPresetMetadata();
      const entraId = metadata.find(m => m.name === 'entra-id');
      expect(entraId).toBeDefined();
      expect(entraId!.default).toBe(true);
    });

    it('should not mark other presets as default', () => {
      const metadata = getAllPresetMetadata();
      const nonDefault = metadata.filter(m => m.name !== 'entra-id');
      for (const m of nonDefault) {
        expect(m.default).toBeFalsy();
      }
    });
  });

  // ─── entra-id Preset Structure ────────────────────────────────────────

  describe('entra-id preset', () => {
    const preset = getBuiltInPreset('entra-id');
    const { profile } = preset;

    it('should have 7 schemas (User + EnterpriseUser + Group + 4 msfttest)', () => {
      expect(profile.schemas).toHaveLength(7);
    });

    it('should have User schema with scoped attributes (not "all")', () => {
      const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      expect(userSchema).toBeDefined();
      expect(Array.isArray(userSchema!.attributes)).toBe(true);
      // 20 attributes: userName, name, displayName, nickName, profileUrl, title, userType,
      // emails, active, externalId, addresses, phoneNumbers, ims, photos, roles, entitlements,
      // preferredLanguage, locale, timezone, password
      expect((userSchema!.attributes as any[]).length).toBe(20);
    });

    it('should have EnterpriseUser with fully expanded attributes (6 attrs from JSON)', () => {
      const eu = profile.schemas!.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA);
      expect(eu).toBeDefined();
      expect(Array.isArray(eu!.attributes)).toBe(true);
      expect((eu!.attributes as any[]).length).toBe(6);
    });

    it('should have Group with fully expanded attributes (loaded from JSON)', () => {
      const group = profile.schemas!.find(s => s.id === SCIM_CORE_GROUP_SCHEMA);
      expect(group).toBeDefined();
      expect(Array.isArray(group!.attributes)).toBe(true);
      expect((group!.attributes as any[]).length).toBe(6);
    });

    it('should include all 4 msfttest extension schemas (decision D10)', () => {
      const ids = profile.schemas!.map(s => s.id);
      expect(ids).toContain(MSFTTEST_CUSTOM_USER_SCHEMA);
      expect(ids).toContain(MSFTTEST_CUSTOM_GROUP_SCHEMA);
      expect(ids).toContain(MSFTTEST_IETF_USER_SCHEMA);
      expect(ids).toContain(MSFTTEST_IETF_GROUP_SCHEMA);
    });

    it('should have 2 resource types (User + Group)', () => {
      expect(profile.resourceTypes).toHaveLength(2);
      const names = profile.resourceTypes!.map(rt => rt.name);
      expect(names).toContain('User');
      expect(names).toContain('Group');
    });

    it('should have User RT with 3 extensions (Enterprise + 2 msfttest)', () => {
      const userRT = profile.resourceTypes!.find(rt => rt.name === 'User');
      expect(userRT!.schemaExtensions).toHaveLength(3);
    });

    it('should have Group RT with 2 msfttest extensions', () => {
      const groupRT = profile.resourceTypes!.find(rt => rt.name === 'Group');
      expect(groupRT!.schemaExtensions).toHaveLength(2);
    });

    it('should have tightened attributes: emails.required=true, displayName.required=true', () => {
      const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      const attrs = userSchema!.attributes as any[];
      expect(attrs.find((a: any) => a.name === 'emails')?.required).toBe(true);
      expect(attrs.find((a: any) => a.name === 'displayName')?.required).toBe(true);
    });

    it('should have active.returned=always', () => {
      const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      const active = (userSchema!.attributes as any[]).find((a: any) => a.name === 'active');
      expect(active?.returned).toBe('always');
    });

    it('should have externalId.uniqueness=server', () => {
      const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      const eid = (userSchema!.attributes as any[]).find((a: any) => a.name === 'externalId');
      expect(eid?.uniqueness).toBe('server');
    });

    it('should have SPC with patch=true, bulk=false, etag=true, sort=false', () => {
      expect(profile.serviceProviderConfig!.patch!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.bulk!.supported).toBe(false);
      expect(profile.serviceProviderConfig!.etag!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.sort!.supported).toBe(false);
    });

    it('should have AllowAndCoerceBooleanStrings=True in settings', () => {
      expect(profile.settings!.AllowAndCoerceBooleanStrings).toBe('True');
    });

    it('should have Entra-compatible PATCH settings', () => {
      expect(profile.settings!.MultiOpPatchRequestAddMultipleMembersToGroup).toBe('True');
      expect(profile.settings!.MultiOpPatchRequestRemoveMultipleMembersFromGroup).toBe('True');
      expect(profile.settings!.PatchOpAllowRemoveAllMembers).toBe('True');
      expect(profile.settings!.VerbosePatchSupported).toBe('True');
    });

    it('should NOT have StrictSchemaValidation in default preset (opt-in per-endpoint)', () => {
      expect(profile.settings!.StrictSchemaValidation).toBeUndefined();
    });

    it('should NOT have SoftDeleteEnabled in default preset (opt-in per-endpoint)', () => {
      expect(profile.settings!.SoftDeleteEnabled).toBeUndefined();
    });

    it('should have 5 settings total', () => {
      expect(Object.keys(profile.settings!)).toHaveLength(5);
    });
  });

  // ─── entra-id-minimal Preset ──────────────────────────────────────────

  describe('entra-id-minimal preset', () => {
    const preset = getBuiltInPreset('entra-id-minimal');
    const { profile } = preset;

    it('should have 7 schemas (core + enterprise + 4 msfttest)', () => {
      expect(profile.schemas).toHaveLength(7);
    });

    it('should have User with 6 core attributes only', () => {
      const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      expect(Array.isArray(userSchema!.attributes)).toBe(true);
      expect((userSchema!.attributes as any[]).length).toBe(6);
    });

    it('should include EnterpriseUser (decision D11)', () => {
      const eu = profile.schemas!.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA);
      expect(eu).toBeDefined();
    });

    it('should have AllowAndCoerceBooleanStrings=True', () => {
      expect(profile.settings!.AllowAndCoerceBooleanStrings).toBe('True');
    });

    it('should have Group with 3 scoped attributes', () => {
      const group = profile.schemas!.find(s => s.id === SCIM_CORE_GROUP_SCHEMA);
      expect(Array.isArray(group!.attributes)).toBe(true);
      expect((group!.attributes as any[]).length).toBe(3);
    });
  });

  // ─── rfc-standard Preset ──────────────────────────────────────────────

  describe('rfc-standard preset', () => {
    const preset = getBuiltInPreset('rfc-standard');
    const { profile } = preset;

    it('should have 3 schemas (User + EnterpriseUser + Group)', () => {
      expect(profile.schemas).toHaveLength(3);
    });

    it('should NOT include msfttest extensions (decision D10)', () => {
      const ids = profile.schemas!.map(s => s.id);
      expect(ids).not.toContain(MSFTTEST_CUSTOM_USER_SCHEMA);
      expect(ids).not.toContain(MSFTTEST_IETF_USER_SCHEMA);
    });

    it('should have all schemas with fully expanded attributes (loaded from JSON)', () => {
      for (const schema of profile.schemas!) {
        expect(Array.isArray(schema.attributes)).toBe(true);
        expect((schema.attributes as any[]).length).toBeGreaterThan(0);
      }
    });

    it('should include EnterpriseUser (decision D11)', () => {
      const eu = profile.schemas!.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA);
      expect(eu).toBeDefined();
    });

    it('should have User RT with 1 extension (EnterpriseUser only)', () => {
      const userRT = profile.resourceTypes!.find(rt => rt.name === 'User');
      expect(userRT!.schemaExtensions).toHaveLength(1);
      expect(userRT!.schemaExtensions[0].schema).toBe(SCIM_ENTERPRISE_USER_SCHEMA);
    });

    it('should have SPC with bulk=true, sort=true (all capabilities)', () => {
      expect(profile.serviceProviderConfig!.bulk!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.sort!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.etag!.supported).toBe(true);
    });

    it('should have empty settings', () => {
      expect(Object.keys(profile.settings!)).toHaveLength(0);
    });
  });

  // ─── minimal Preset ───────────────────────────────────────────────────

  describe('minimal preset', () => {
    const preset = getBuiltInPreset('minimal');
    const { profile } = preset;

    it('should have 2 schemas (User + Group — no extensions)', () => {
      expect(profile.schemas).toHaveLength(2);
    });

    it('should NOT include EnterpriseUser (decision D11 — minimal excluded)', () => {
      const eu = profile.schemas!.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA);
      expect(eu).toBeUndefined();
    });

    it('should NOT include msfttest extensions', () => {
      const ids = profile.schemas!.map(s => s.id);
      expect(ids).not.toContain(MSFTTEST_CUSTOM_USER_SCHEMA);
    });

    it('should have User with 6 core attributes', () => {
      const user = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
      expect(Array.isArray(user!.attributes)).toBe(true);
      expect((user!.attributes as any[]).length).toBe(6);
    });

    it('should have both RTs with empty schemaExtensions', () => {
      for (const rt of profile.resourceTypes!) {
        expect(rt.schemaExtensions).toHaveLength(0);
      }
    });

    it('should have SPC with bulk=false, sort=false, etag=false', () => {
      expect(profile.serviceProviderConfig!.bulk!.supported).toBe(false);
      expect(profile.serviceProviderConfig!.sort!.supported).toBe(false);
      expect(profile.serviceProviderConfig!.etag!.supported).toBe(false);
    });

    it('should have empty settings', () => {
      expect(Object.keys(profile.settings!)).toHaveLength(0);
    });
  });

  // ─── user-only Preset ─────────────────────────────────────────────────

  describe('user-only preset', () => {
    const preset = getBuiltInPreset('user-only');
    const { profile } = preset;

    it('should have 2 schemas (User + EnterpriseUser — no Group)', () => {
      expect(profile.schemas).toHaveLength(2);
      const ids = profile.schemas!.map(s => s.id);
      expect(ids).toContain(SCIM_CORE_USER_SCHEMA);
      expect(ids).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(ids).not.toContain(SCIM_CORE_GROUP_SCHEMA);
    });

    it('should have only 1 resource type (User — no Group)', () => {
      expect(profile.resourceTypes).toHaveLength(1);
      expect(profile.resourceTypes![0].name).toBe('User');
    });

    it('should include EnterpriseUser (decision D11)', () => {
      const eu = profile.schemas!.find(s => s.id === SCIM_ENTERPRISE_USER_SCHEMA);
      expect(eu).toBeDefined();
    });

    it('should have SPC with sort=true, etag=true', () => {
      expect(profile.serviceProviderConfig!.sort!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.etag!.supported).toBe(true);
    });

    it('should have empty settings', () => {
      expect(Object.keys(profile.settings!)).toHaveLength(0);
    });
  });

  // ─── Cross-preset structural validity ─────────────────────────────────

  describe('all presets — structural validity', () => {
    for (const presetName of PRESET_NAMES) {
      describe(`${presetName}`, () => {
        const preset = getBuiltInPreset(presetName);
        const { profile } = preset;

        it('should have at least one schema', () => {
          expect(profile.schemas!.length).toBeGreaterThan(0);
        });

        it('should have at least one resource type', () => {
          expect(profile.resourceTypes!.length).toBeGreaterThan(0);
        });

        it('should have serviceProviderConfig with all required capabilities', () => {
          const spc = profile.serviceProviderConfig!;
          expect(spc.patch).toBeDefined();
          expect(spc.bulk).toBeDefined();
          expect(spc.filter).toBeDefined();
          expect(spc.sort).toBeDefined();
          expect(spc.etag).toBeDefined();
          expect(spc.changePassword).toBeDefined();
        });

        it('should have settings object (may be empty)', () => {
          expect(profile.settings).toBeDefined();
          expect(typeof profile.settings).toBe('object');
        });

        it('should have every schema with id and name', () => {
          for (const schema of profile.schemas!) {
            expect(schema.id).toBeDefined();
            expect(typeof schema.id).toBe('string');
            expect(schema.id.length).toBeGreaterThan(0);
            expect(schema.name).toBeDefined();
          }
        });

        it('should have every resource type with required fields', () => {
          for (const rt of profile.resourceTypes!) {
            expect(rt.id).toBeDefined();
            expect(rt.name).toBeDefined();
            expect(rt.endpoint).toBeDefined();
            expect(rt.schema).toBeDefined();
            expect(rt.schemaExtensions).toBeDefined();
            expect(Array.isArray(rt.schemaExtensions)).toBe(true);
          }
        });

        it('should have every RT extension reference a schema that exists in the schemas array', () => {
          const schemaIds = new Set(profile.schemas!.map(s => s.id));
          for (const rt of profile.resourceTypes!) {
            for (const ext of rt.schemaExtensions) {
              expect(schemaIds.has(ext.schema)).toBe(true);
            }
          }
        });

        it('should have every RT core schema reference a schema that exists in the schemas array', () => {
          const schemaIds = new Set(profile.schemas!.map(s => s.id));
          for (const rt of profile.resourceTypes!) {
            expect(schemaIds.has(rt.schema)).toBe(true);
          }
        });

        it('should have SPC filter.maxResults > 0', () => {
          expect(profile.serviceProviderConfig!.filter!.maxResults).toBeGreaterThan(0);
        });
      });
    }
  });

  // ─── entra-id User attribute completeness (SCIM Validator compat) ─────

  describe('entra-id User schema — SCIM Validator attribute completeness', () => {
    const profile = getBuiltInPreset('entra-id').profile;
    const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
    const attrNames = (userSchema!.attributes as any[]).map((a: any) => a.name);

    // These are all attributes the Microsoft SCIM Validator sends on POST /Users
    const validatorAttributes = [
      'userName', 'displayName', 'title', 'emails', 'preferredLanguage',
      'name', 'addresses', 'phoneNumbers', 'roles', 'userType', 'nickName',
      'locale', 'timezone', 'profileUrl', 'active',
    ];

    for (const attr of validatorAttributes) {
      it(`should include '${attr}' (sent by Microsoft SCIM Validator)`, () => {
        expect(attrNames).toContain(attr);
      });
    }

    // Additional RFC 7643 §4.1 attributes for completeness
    const additionalRfcAttributes = ['ims', 'photos', 'entitlements', 'password'];
    for (const attr of additionalRfcAttributes) {
      it(`should include '${attr}' (RFC 7643 §4.1)`, () => {
        expect(attrNames).toContain(attr);
      });
    }
  });

  // ─── Preset settings differentiation ──────────────────────────────────

  describe('preset settings differentiation', () => {
    it('entra-id should have 5 non-empty settings (Entra-compatible defaults)', () => {
      const { settings } = getBuiltInPreset('entra-id').profile;
      expect(Object.keys(settings!).length).toBe(5);
      // Verify all are string "True" (Entra sends boolean strings)
      for (const [key, value] of Object.entries(settings!)) {
        if (key !== 'logLevel') {
          expect(typeof value).toBe('string');
        }
      }
    });

    it('entra-id-minimal should have AllowAndCoerceBooleanStrings only', () => {
      const { settings } = getBuiltInPreset('entra-id-minimal').profile;
      expect(Object.keys(settings!)).toEqual(['AllowAndCoerceBooleanStrings']);
    });

    it('rfc-standard should have empty settings (pure RFC defaults)', () => {
      const { settings } = getBuiltInPreset('rfc-standard').profile;
      expect(Object.keys(settings!)).toHaveLength(0);
    });

    it('minimal should have empty settings', () => {
      const { settings } = getBuiltInPreset('minimal').profile;
      expect(Object.keys(settings!)).toHaveLength(0);
    });

    it('user-only should have empty settings', () => {
      const { settings } = getBuiltInPreset('user-only').profile;
      expect(Object.keys(settings!)).toHaveLength(0);
    });
  });

  // ─── SPC capability matrix ────────────────────────────────────────────

  describe('SPC capability matrix across presets', () => {
    const matrix: Record<string, { patch: boolean; bulk: boolean; filter: boolean; sort: boolean; etag: boolean }> = {
      'entra-id':         { patch: true, bulk: false, filter: true, sort: false, etag: true },
      'entra-id-minimal': { patch: true, bulk: false, filter: true, sort: false, etag: true },
      'rfc-standard':     { patch: true, bulk: true,  filter: true, sort: true,  etag: true },
      'minimal':          { patch: true, bulk: false, filter: true, sort: false, etag: false },
      'user-only':        { patch: true, bulk: false, filter: true, sort: true,  etag: true },
    };

    for (const [presetName, expected] of Object.entries(matrix)) {
      it(`${presetName} SPC capabilities: patch=${expected.patch}, bulk=${expected.bulk}, sort=${expected.sort}, etag=${expected.etag}`, () => {
        const spc = getBuiltInPreset(presetName).profile.serviceProviderConfig!;
        expect(spc.patch!.supported).toBe(expected.patch);
        expect(spc.bulk!.supported).toBe(expected.bulk);
        expect(spc.filter!.supported).toBe(expected.filter);
        expect(spc.sort!.supported).toBe(expected.sort);
        expect(spc.etag!.supported).toBe(expected.etag);
      });
    }
  });

  // ─── Resource type matrix ─────────────────────────────────────────────

  describe('resource type matrix across presets', () => {
    it('entra-id should have User + Group', () => {
      const rts = getBuiltInPreset('entra-id').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User', 'Group']);
    });

    it('entra-id-minimal should have User + Group', () => {
      const rts = getBuiltInPreset('entra-id-minimal').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User', 'Group']);
    });

    it('rfc-standard should have User + Group', () => {
      const rts = getBuiltInPreset('rfc-standard').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User', 'Group']);
    });

    it('minimal should have User + Group', () => {
      const rts = getBuiltInPreset('minimal').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User', 'Group']);
    });

    it('user-only should have User only (no Group)', () => {
      const rts = getBuiltInPreset('user-only').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // JSON Load, Validate, and Reload flows
  // ═══════════════════════════════════════════════════════════════════════

  describe('validatePreset()', () => {
    it('should return empty array for a valid minimal preset', () => {
      const valid = {
        metadata: { name: 'test', description: 'Test preset' },
        profile: {
          schemas: [{
            id: 'urn:test:schema', name: 'Test',
            attributes: [{
              name: 'userName', type: 'string', multiValued: false, required: true,
              mutability: 'readWrite', returned: 'always', description: 'The user name.',
            }],
          }],
          resourceTypes: [{
            id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
            schema: 'urn:test:schema', schemaExtensions: [],
          }],
          serviceProviderConfig: {
            patch: { supported: true }, bulk: { supported: false },
            filter: { supported: true, maxResults: 100 }, sort: { supported: false },
            etag: { supported: false }, changePassword: { supported: false },
          },
          settings: {},
        },
      };
      expect(validatePreset(valid, 'test.json')).toHaveLength(0);
    });

    it('should reject null input', () => {
      const errors = validatePreset(null, 'bad.json');
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Not a valid JSON object');
    });

    it('should reject missing metadata.name', () => {
      const errors = validatePreset({ metadata: {}, profile: {} }, 'bad.json');
      expect(errors.some(e => e.includes('metadata.name'))).toBe(true);
    });

    it('should reject missing metadata.description', () => {
      const errors = validatePreset({ metadata: { name: 'x' }, profile: {} }, 'bad.json');
      expect(errors.some(e => e.includes('metadata.description'))).toBe(true);
    });

    it('should reject missing profile', () => {
      const errors = validatePreset({ metadata: { name: 'x', description: 'y' } }, 'bad.json');
      expect(errors.some(e => e.includes('profile is missing'))).toBe(true);
    });

    it('should reject empty schemas array', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: { schemas: [], resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'x', schemaExtensions: [] }], serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } } },
      }, 'bad.json');
      expect(errors.some(e => e.includes('non-empty array'))).toBe(true);
    });

    it('should reject "all" abbreviation in attributes', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: 'all' }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:test', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('"all" abbreviation'))).toBe(true);
    });

    it('should reject attribute missing required fields', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: [{ name: 'foo' }] }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:test', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('missing type'))).toBe(true);
      expect(errors.some(e => e.includes('missing multiValued'))).toBe(true);
      expect(errors.some(e => e.includes('missing required'))).toBe(true);
      expect(errors.some(e => e.includes('missing mutability'))).toBe(true);
      expect(errors.some(e => e.includes('missing returned'))).toBe(true);
      expect(errors.some(e => e.includes('missing description'))).toBe(true);
    });

    it('should reject complex attribute without subAttributes', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: [{
            name: 'name', type: 'complex', multiValued: false, required: false,
            mutability: 'readWrite', returned: 'default', description: 'A name.',
          }] }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:test', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('complex but missing subAttributes'))).toBe(true);
    });

    it('should reject resourceType referencing missing schema', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: [{ name: 'a', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'd' }] }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:missing', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true, maxResults: 100 }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('not found in schemas array'))).toBe(true);
    });

    it('should reject missing SPC capability', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: [{ name: 'a', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'd' }] }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:test', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('bulk'))).toBe(true);
      expect(errors.some(e => e.includes('filter'))).toBe(true);
      expect(errors.some(e => e.includes('sort'))).toBe(true);
    });

    it('should reject filter.supported=true without maxResults', () => {
      const errors = validatePreset({
        metadata: { name: 'x', description: 'y' },
        profile: {
          schemas: [{ id: 'urn:test', name: 'Test', attributes: [{ name: 'a', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'd' }] }],
          resourceTypes: [{ id: 'U', name: 'U', endpoint: '/U', description: 'U', schema: 'urn:test', schemaExtensions: [] }],
          serviceProviderConfig: { patch: { supported: true }, bulk: { supported: false }, filter: { supported: true }, sort: { supported: false }, etag: { supported: false }, changePassword: { supported: false } },
        },
      }, 'bad.json');
      expect(errors.some(e => e.includes('maxResults'))).toBe(true);
    });
  });

  describe('loadPresetsFromDisk()', () => {
    it('should load presets and return a result object', () => {
      const result = loadPresetsFromDisk();
      expect(result).toBeDefined();
      expect(result.dir).toBeDefined();
      expect(Array.isArray(result.loaded)).toBe(true);
      expect(Array.isArray(result.fallback)).toBe(true);
      expect(Array.isArray(result.custom)).toBe(true);
      expect(Array.isArray(result.validationErrors)).toBe(true);
    });

    it('should have all 5 built-in presets after load (from file or fallback)', () => {
      const result = loadPresetsFromDisk();
      const total = result.loaded.length + result.fallback.length;
      expect(total).toBe(5);
    });

    it('should have zero validation errors when JSON files are valid', () => {
      const result = loadPresetsFromDisk();
      if (result.loaded.length === 5) {
        // All loaded from valid JSON files
        expect(result.validationErrors).toHaveLength(0);
      }
    });

    it('should populate BUILT_IN_PRESETS after load', () => {
      loadPresetsFromDisk();
      expect(BUILT_IN_PRESETS.size).toBeGreaterThanOrEqual(5);
      for (const name of PRESET_NAMES) {
        expect(BUILT_IN_PRESETS.has(name)).toBe(true);
      }
    });
  });

  describe('reloadPresetsFromDisk()', () => {
    it('should return the same structure as loadPresetsFromDisk', () => {
      const result = reloadPresetsFromDisk();
      expect(result.dir).toBeDefined();
      expect(Array.isArray(result.loaded)).toBe(true);
      expect(Array.isArray(result.fallback)).toBe(true);
      expect(Array.isArray(result.validationErrors)).toBe(true);
    });

    it('should still have all presets after reload', () => {
      reloadPresetsFromDisk();
      for (const name of PRESET_NAMES) {
        expect(BUILT_IN_PRESETS.has(name)).toBe(true);
        const p = getBuiltInPreset(name);
        expect(p.metadata.name).toBe(name);
        expect(p.profile).toBeDefined();
      }
    });
  });

  describe('getLastLoadResult()', () => {
    it('should return the result of the last load', () => {
      loadPresetsFromDisk();
      const result = getLastLoadResult();
      expect(result).toBeDefined();
      expect(result!.dir).toBeDefined();
      expect(result!.loaded.length + result!.fallback.length).toBe(5);
    });
  });

  describe('getPresetsDir()', () => {
    it('should return a string path', () => {
      const dir = getPresetsDir();
      expect(typeof dir).toBe('string');
      expect(dir.length).toBeGreaterThan(0);
    });

    it('should respect PRESETS_DIR env var', () => {
      const orig = process.env.PRESETS_DIR;
      try {
        process.env.PRESETS_DIR = '/tmp/custom-presets';
        const dir = getPresetsDir();
        expect(dir).toContain('custom-presets');
      } finally {
        if (orig) process.env.PRESETS_DIR = orig;
        else delete process.env.PRESETS_DIR;
      }
    });
  });

  // ─── JSON completeness check across all loaded presets ────────────────

  describe('all loaded presets — JSON completeness (no abbreviations)', () => {
    for (const presetName of PRESET_NAMES) {
      describe(`${presetName}`, () => {
        const preset = getBuiltInPreset(presetName);

        it('should have attributes as arrays (not "all" shorthand)', () => {
          for (const schema of preset.profile.schemas!) {
            if (schema.attributes !== undefined) {
              expect(Array.isArray(schema.attributes)).toBe(true);
            }
          }
        });

        it('should have complete attribute definitions (name + type + description)', () => {
          for (const schema of preset.profile.schemas!) {
            if (Array.isArray(schema.attributes)) {
              for (const attr of schema.attributes as any[]) {
                expect(attr.name).toBeDefined();
                expect(attr.type).toBeDefined();
                expect(attr.description).toBeDefined();
              }
            }
          }
        });

        it('should pass full validatePreset() with zero errors', () => {
          const errors = validatePreset(preset, `${presetName}.json`);
          if (errors.length > 0) {
            fail(`validatePreset failed for ${presetName}: ${errors.join('; ')}`);
          }
        });
      });
    }
  });
});
