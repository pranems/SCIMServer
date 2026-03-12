/**
 * Unit Tests — Endpoint Profile Service / Orchestrator (Phase 13, Step 2.5)
 *
 * Tests the full pipeline: expand → inject → tighten-only → SPC → structural.
 * Tests preset validation, error aggregation, and edge cases.
 */
import { validateAndExpandProfile } from './endpoint-profile.service';
import { getBuiltInPreset, PRESET_NAMES } from './built-in-presets';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
} from '../common/scim-constants';
import type { ShorthandProfileInput } from './endpoint-profile.types';

/** Minimal valid input for a User-only endpoint */
const MINIMAL_VALID_INPUT: ShorthandProfileInput = {
  schemas: [{
    id: SCIM_CORE_USER_SCHEMA,
    name: 'User',
    attributes: [{ name: 'userName' }],
  }],
  resourceTypes: [{
    id: 'User', name: 'User', endpoint: '/Users', description: 'User',
    schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [],
  }],
  serviceProviderConfig: {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 100 },
    sort: { supported: false },
    etag: { supported: false },
    changePassword: { supported: false },
  },
};

describe('endpoint-profile.service (orchestrator)', () => {
  // ─── Happy Path ───────────────────────────────────────────────────────

  describe('happy path', () => {
    it('should validate and expand a minimal valid input', () => {
      const result = validateAndExpandProfile(MINIMAL_VALID_INPUT);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.profile).toBeDefined();
    });

    it('should return expanded profile with auto-injected attributes', () => {
      const result = validateAndExpandProfile(MINIMAL_VALID_INPUT);
      const userSchema = result.profile!.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      const names = userSchema.attributes.map(a => a.name);
      expect(names).toContain('id');          // RFC required
      expect(names).toContain('userName');     // RFC required
      expect(names).toContain('externalId');   // project default
      expect(names).toContain('meta');         // project default
    });

    it('should preserve settings from input', () => {
      const input = { ...MINIMAL_VALID_INPUT, settings: { SoftDeleteEnabled: 'True' } };
      const result = validateAndExpandProfile(input);
      expect(result.profile!.settings.SoftDeleteEnabled).toBe('True');
    });
  });

  // ─── All Built-in Presets ─────────────────────────────────────────────

  describe('all built-in presets validate successfully', () => {
    for (const presetName of PRESET_NAMES) {
      it(`should validate preset "${presetName}"`, () => {
        const preset = getBuiltInPreset(presetName);
        const result = validateAndExpandProfile(preset.profile);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
        expect(result.profile).toBeDefined();
        expect(result.profile!.schemas.length).toBeGreaterThan(0);
        expect(result.profile!.resourceTypes.length).toBeGreaterThan(0);
      });
    }
  });

  // ─── Preset Expansion Validation ──────────────────────────────────────

  describe('preset expansion', () => {
    it('should expand entra-id preset with 7 schemas and all attributes resolved', () => {
      const preset = getBuiltInPreset('entra-id');
      const result = validateAndExpandProfile(preset.profile);
      expect(result.profile!.schemas).toHaveLength(7);
      // User schema should have expanded attributes (not "all" shorthand)
      const user = result.profile!.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      expect(user.attributes.length).toBeGreaterThan(0);
      // Check auto-injected id
      const id = user.attributes.find(a => a.name === 'id');
      expect(id).toBeDefined();
      expect(id!.required).toBe(true);
    });

    it('should expand rfc-standard "all" to full attribute lists', () => {
      const preset = getBuiltInPreset('rfc-standard');
      const result = validateAndExpandProfile(preset.profile);
      const user = result.profile!.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      expect(user.attributes.length).toBeGreaterThanOrEqual(15);
    });

    it('should expand minimal preset with auto-injected attributes', () => {
      const preset = getBuiltInPreset('minimal');
      const result = validateAndExpandProfile(preset.profile);
      const user = result.profile!.schemas.find(s => s.id === SCIM_CORE_USER_SCHEMA)!;
      const names = user.attributes.map(a => a.name);
      expect(names).toContain('id');
      expect(names).toContain('externalId');
      expect(names).toContain('meta');
    });
  });

  // ─── Tighten-Only Violations ──────────────────────────────────────────

  describe('tighten-only violations', () => {
    it('should reject loosening userName.required from true to false', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName', required: false }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'TIGHTEN_ONLY_VIOLATION')).toBe(true);
      expect(result.errors.some(e => e.detail.includes('userName'))).toBe(true);
    });

    it('should reject changing emails.type from complex to string', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'emails', type: 'string' }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.detail.includes('type'))).toBe(true);
    });

    it('should reject changing emails.multiValued from true to false', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'emails', multiValued: false }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.detail.includes('multiValued'))).toBe(true);
    });

    it('should reject loosening id.mutability from readOnly to readWrite', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'id', mutability: 'readWrite' }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.detail.includes('mutability'))).toBe(true);
    });

    it('should reject making password returned (returned:never → default)', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'password', returned: 'default' }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.detail.includes('never'))).toBe(true);
    });

    it('should accept valid tightening: emails.required=true', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'emails', required: true }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(true);
    });

    it('should accept valid tightening: externalId.uniqueness=server', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'externalId', uniqueness: 'server' }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(true);
    });

    it('should accept valid tightening: externalId.mutability=immutable', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'externalId', mutability: 'immutable' }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(true);
    });
  });

  // ─── SPC Truthfulness ─────────────────────────────────────────────────

  describe('SPC truthfulness', () => {
    it('should reject changePassword.supported=true (not implemented)', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        serviceProviderConfig: {
          patch: { supported: true },
          bulk: { supported: false },
          filter: { supported: true, maxResults: 100 },
          sort: { supported: false },
          etag: { supported: false },
          changePassword: { supported: true },
        },
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SPC_UNIMPLEMENTED')).toBe(true);
    });

    it('should reject filter.maxResults=0', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        serviceProviderConfig: {
          ...MINIMAL_VALID_INPUT.serviceProviderConfig!,
          filter: { supported: true, maxResults: 0 },
        },
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'SPC_INVALID_VALUE')).toBe(true);
    });

    it('should reject filter.maxResults=99999', () => {
      const input: ShorthandProfileInput = {
        ...MINIMAL_VALID_INPUT,
        serviceProviderConfig: {
          ...MINIMAL_VALID_INPUT.serviceProviderConfig!,
          filter: { supported: true, maxResults: 99999 },
        },
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
    });

    it('should accept valid SPC', () => {
      const result = validateAndExpandProfile(MINIMAL_VALID_INPUT);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Structural Validation ────────────────────────────────────────────

  describe('structural validation', () => {
    it('should reject empty schemas', () => {
      const input: ShorthandProfileInput = {
        schemas: [],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_SCHEMAS')).toBe(true);
    });

    it('should reject empty resourceTypes', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_RESOURCE_TYPES')).toBe(true);
    });

    it('should reject RT referencing non-existent core schema', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{
          id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
          schema: SCIM_CORE_GROUP_SCHEMA, // not in schemas[]
          schemaExtensions: [],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'RT_MISSING_SCHEMA')).toBe(true);
    });

    it('should reject RT referencing non-existent extension schema', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [{
          id: 'User', name: 'User', endpoint: '/Users', description: 'User',
          schema: SCIM_CORE_USER_SCHEMA,
          schemaExtensions: [{ schema: 'urn:nonexistent:extension', required: false }],
        }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'RT_MISSING_EXTENSION_SCHEMA')).toBe(true);
    });

    it('should reject duplicate schema IDs', () => {
      const input: ShorthandProfileInput = {
        schemas: [
          { id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' },
          { id: SCIM_CORE_USER_SCHEMA, name: 'User2', attributes: 'all' },
        ],
        resourceTypes: [{ id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] }],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DUPLICATE_SCHEMA')).toBe(true);
    });

    it('should reject duplicate resource type names', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: SCIM_CORE_USER_SCHEMA, name: 'User', attributes: 'all' }],
        resourceTypes: [
          { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] },
          { id: 'User2', name: 'User', endpoint: '/Users2', description: 'User2', schema: SCIM_CORE_USER_SCHEMA, schemaExtensions: [] },
        ],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DUPLICATE_RT')).toBe(true);
    });
  });

  // ─── Error Aggregation ────────────────────────────────────────────────

  describe('error aggregation', () => {
    it('should report multiple errors from different validators', () => {
      const input: ShorthandProfileInput = {
        schemas: [{
          id: SCIM_CORE_USER_SCHEMA,
          name: 'User',
          attributes: [{ name: 'userName', required: false }], // tighten-only violation
        }],
        resourceTypes: [{
          id: 'User', name: 'User', endpoint: '/Users', description: 'User',
          schema: SCIM_CORE_USER_SCHEMA,
          schemaExtensions: [{ schema: 'urn:nonexistent', required: false }], // structural violation
        }],
        serviceProviderConfig: {
          ...MINIMAL_VALID_INPUT.serviceProviderConfig!,
          changePassword: { supported: true }, // SPC violation
        },
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      const codes = result.errors.map(e => e.code);
      expect(codes).toContain('TIGHTEN_ONLY_VIOLATION');
      expect(codes).toContain('RT_MISSING_EXTENSION_SCHEMA');
      expect(codes).toContain('SPC_UNIMPLEMENTED');
    });
  });

  // ─── Expand Error Handling ────────────────────────────────────────────

  describe('expand error handling', () => {
    it('should return EXPAND_ERROR for "all" on unknown schema', () => {
      const input: ShorthandProfileInput = {
        schemas: [{ id: 'urn:unknown:schema', name: 'Bad', attributes: 'all' }],
        resourceTypes: [],
      };
      const result = validateAndExpandProfile(input);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'EXPAND_ERROR')).toBe(true);
    });
  });
});
