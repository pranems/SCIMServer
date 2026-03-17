/**
 * Unit Tests — Built-in Profile Presets (compile-time embedded)
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
  PRESET_LEXMARK,
  DEFAULT_PRESET_NAME,
  BUILT_IN_PRESETS,
  PRESET_NAMES,
  getBuiltInPreset,
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
      expect(PRESET_LEXMARK).toBe('lexmark');
    });

    it('should default to entra-id (decision D5)', () => {
      expect(DEFAULT_PRESET_NAME).toBe('entra-id');
    });
  });

  // ─── BUILT_IN_PRESETS Map ─────────────────────────────────────────────

  describe('BUILT_IN_PRESETS', () => {
    it('should contain exactly 6 presets', () => {
      expect(BUILT_IN_PRESETS.size).toBe(6);
    });

    it('should contain all named presets', () => {
      expect(BUILT_IN_PRESETS.has(PRESET_ENTRA_ID)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_ENTRA_ID_MINIMAL)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_RFC_STANDARD)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_MINIMAL)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_USER_ONLY)).toBe(true);
      expect(BUILT_IN_PRESETS.has(PRESET_LEXMARK)).toBe(true);
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
    it('should have 6 entries in display order', () => {
      expect(PRESET_NAMES).toHaveLength(6);
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

    it('should have all schemas with fully expanded attributes', () => {
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

  describe('lexmark preset', () => {
    const preset = getBuiltInPreset('lexmark');
    const { profile } = preset;

    it('should have 3 schemas (User + EnterpriseUser + CustomUser)', () => {
      expect(profile.schemas).toHaveLength(3);
      const ids = profile.schemas!.map(s => s.id);
      expect(ids).toContain(SCIM_CORE_USER_SCHEMA);
      expect(ids).toContain(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(ids).toContain('urn:ietf:params:scim:schemas:extension:custom:2.0:User');
      expect(ids).not.toContain(SCIM_CORE_GROUP_SCHEMA);
    });

    it('should have only 1 resource type (User — no Group)', () => {
      expect(profile.resourceTypes).toHaveLength(1);
      expect(profile.resourceTypes![0].name).toBe('User');
    });

    it('should have EnterpriseUser as required extension', () => {
      const rt = profile.resourceTypes![0];
      const entExt = rt.schemaExtensions!.find(
        (e: any) => e.schema === SCIM_ENTERPRISE_USER_SCHEMA,
      );
      expect(entExt).toBeDefined();
      expect(entExt!.required).toBe(true);
    });

    it('should have CustomUser as optional extension', () => {
      const rt = profile.resourceTypes![0];
      const customExt = rt.schemaExtensions!.find(
        (e: any) => e.schema === 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
      );
      expect(customExt).toBeDefined();
      expect(customExt!.required).toBe(false);
    });

    it('should have SPC with patch=true, bulk=false, sort=true, etag=false', () => {
      expect(profile.serviceProviderConfig!.patch!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.bulk!.supported).toBe(false);
      expect(profile.serviceProviderConfig!.sort!.supported).toBe(true);
      expect(profile.serviceProviderConfig!.etag!.supported).toBe(false);
    });

    it('should have empty settings', () => {
      expect(Object.keys(profile.settings!)).toHaveLength(0);
    });

    it('should have CustomUser writeOnly/never attributes', () => {
      const customSchema = profile.schemas!.find(
        s => s.id === 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
      );
      expect(customSchema).toBeDefined();
      const attrs = customSchema!.attributes as any[];
      const badge = attrs.find((a: any) => a.name === 'badgeCode');
      expect(badge.mutability).toBe('writeOnly');
      expect(badge.returned).toBe('never');
      const pin = attrs.find((a: any) => a.name === 'pin');
      expect(pin.mutability).toBe('writeOnly');
      expect(pin.returned).toBe('never');
    });
  });

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

        it('should have attributes as arrays (not "all" shorthand)', () => {
          for (const schema of profile.schemas!) {
            if (schema.attributes !== undefined) {
              expect(Array.isArray(schema.attributes)).toBe(true);
            }
          }
        });

        it('should have complete attribute definitions (name + type + description)', () => {
          for (const schema of profile.schemas!) {
            if (Array.isArray(schema.attributes)) {
              for (const attr of schema.attributes as any[]) {
                expect(attr.name).toBeDefined();
                expect(attr.type).toBeDefined();
                expect(attr.description).toBeDefined();
              }
            }
          }
        });
      });
    }
  });

  // ─── entra-id User attribute completeness (SCIM Validator compat) ─────

  describe('entra-id User schema — SCIM Validator attribute completeness', () => {
    const profile = getBuiltInPreset('entra-id').profile;
    const userSchema = profile.schemas!.find(s => s.id === SCIM_CORE_USER_SCHEMA);
    const attrNames = (userSchema!.attributes as any[]).map((a: any) => a.name);

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
      'lexmark':          { patch: true, bulk: false, filter: true, sort: true,  etag: false },
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

    it('lexmark should have User only (no Group)', () => {
      const rts = getBuiltInPreset('lexmark').profile.resourceTypes!.map(rt => rt.name);
      expect(rts).toEqual(['User']);
    });
  });
});
