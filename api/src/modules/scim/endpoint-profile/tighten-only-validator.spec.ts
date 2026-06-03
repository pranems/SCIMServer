/**
 * Unit Tests - Tighten-Only Validator (Phase 13, Step 2.3)
 *
 * Validates that attribute characteristic overrides are correctly
 * accepted (tightening) or rejected (loosening) for each dimension.
 */
import { validateAttributeTightenOnly } from './tighten-only-validator';
import type { ScimSchemaAttribute } from '../discovery/scim-schema-registry';

const SCHEMA_ID = 'urn:ietf:params:scim:schemas:core:2.0:User';

/** Helper: create a minimal baseline attribute */
function baseline(overrides: Partial<ScimSchemaAttribute> = {}): ScimSchemaAttribute {
  return {
    name: 'testAttr',
    type: 'string',
    multiValued: false,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    uniqueness: 'none',
    caseExact: false,
    ...overrides,
  } as ScimSchemaAttribute;
}

describe('tighten-only-validator', () => {
  // ─── type ──────────────────────────────────────────────────────────────

  describe('type', () => {
    it('should accept same type', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', type: 'string' }, baseline({ type: 'string' }));
      expect(errors).toHaveLength(0);
    });

    it('should reject type change string→boolean', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', type: 'boolean' }, baseline({ type: 'string' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('type');
      expect(errors[0].message).toContain('Cannot change');
    });

    it('should reject type change complex→string', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', type: 'string' }, baseline({ type: 'complex' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('type');
    });
  });

  // ─── multiValued ───────────────────────────────────────────────────────

  describe('multiValued', () => {
    it('should accept same multiValued', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', multiValued: true }, baseline({ multiValued: true }));
      expect(errors).toHaveLength(0);
    });

    it('should reject multiValued change true→false', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', multiValued: false }, baseline({ multiValued: true }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('multiValued');
    });

    it('should reject multiValued change false→true', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', multiValued: true }, baseline({ multiValued: false }));
      expect(errors).toHaveLength(1);
    });
  });

  // ─── required ──────────────────────────────────────────────────────────

  describe('required', () => {
    it('should accept tightening false→true', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', required: true }, baseline({ required: false }));
      expect(errors).toHaveLength(0);
    });

    it('should reject loosening true→false', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', required: false }, baseline({ required: true }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('required');
      expect(errors[0].message).toContain('loosen');
    });

    it('should accept same required=true', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', required: true }, baseline({ required: true }));
      expect(errors).toHaveLength(0);
    });

    it('should accept same required=false', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', required: false }, baseline({ required: false }));
      expect(errors).toHaveLength(0);
    });
  });

  // ─── mutability ────────────────────────────────────────────────────────

  describe('mutability', () => {
    it('should accept tightening readWrite→immutable', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'immutable' }, baseline({ mutability: 'readWrite' }));
      expect(errors).toHaveLength(0);
    });

    it('should accept tightening readWrite→readOnly', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'readOnly' }, baseline({ mutability: 'readWrite' }));
      expect(errors).toHaveLength(0);
    });

    it('should accept tightening immutable→readOnly', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'readOnly' }, baseline({ mutability: 'immutable' }));
      expect(errors).toHaveLength(0);
    });

    it('should reject loosening readOnly→readWrite', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'readWrite' }, baseline({ mutability: 'readOnly' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('mutability');
      expect(errors[0].message).toContain('loosen');
    });

    it('should reject loosening immutable→readWrite', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'readWrite' }, baseline({ mutability: 'immutable' }));
      expect(errors).toHaveLength(1);
    });

    it('should reject loosening readOnly→immutable', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'immutable' }, baseline({ mutability: 'readOnly' }));
      expect(errors).toHaveLength(1);
    });

    it('should accept same mutability', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', mutability: 'readWrite' }, baseline({ mutability: 'readWrite' }));
      expect(errors).toHaveLength(0);
    });
  });

  // ─── uniqueness ────────────────────────────────────────────────────────

  describe('uniqueness', () => {
    it('should accept tightening none→server', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'server' }, baseline({ uniqueness: 'none' }));
      expect(errors).toHaveLength(0);
    });

    it('should accept tightening server→global', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'global' }, baseline({ uniqueness: 'server' }));
      expect(errors).toHaveLength(0);
    });

    it('should accept tightening none→global', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'global' }, baseline({ uniqueness: 'none' }));
      expect(errors).toHaveLength(0);
    });

    it('should reject loosening server→none', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'none' }, baseline({ uniqueness: 'server' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('uniqueness');
    });

    it('should reject loosening global→server', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'server' }, baseline({ uniqueness: 'global' }));
      expect(errors).toHaveLength(1);
    });

    it('should accept same uniqueness', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', uniqueness: 'server' }, baseline({ uniqueness: 'server' }));
      expect(errors).toHaveLength(0);
    });
  });

  // ─── caseExact ─────────────────────────────────────────────────────────

  describe('caseExact', () => {
    it('should accept tightening false→true', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', caseExact: true }, baseline({ caseExact: false }));
      expect(errors).toHaveLength(0);
    });

    it('should reject loosening true→false', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', caseExact: false }, baseline({ caseExact: true }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('caseExact');
    });

    it('should accept same caseExact', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', caseExact: true }, baseline({ caseExact: true }));
      expect(errors).toHaveLength(0);
    });
  });

  // ─── returned ──────────────────────────────────────────────────────────

  describe('returned', () => {
    it('should accept changing default→always', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', returned: 'always' }, baseline({ returned: 'default' }));
      expect(errors).toHaveLength(0);
    });

    it('should accept changing default→request', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', returned: 'request' }, baseline({ returned: 'default' }));
      expect(errors).toHaveLength(0);
    });

    it('should reject loosening never→default', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', returned: 'default' }, baseline({ returned: 'never' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].characteristic).toBe('returned');
      expect(errors[0].message).toContain('never');
    });

    it('should reject loosening never→always', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', returned: 'always' }, baseline({ returned: 'never' }));
      expect(errors).toHaveLength(1);
    });

    it('should accept same returned', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x', returned: 'default' }, baseline({ returned: 'default' }));
      expect(errors).toHaveLength(0);
    });
  });

  // ─── No override (undefined fields) ───────────────────────────────────

  describe('no override', () => {
    it('should accept when no characteristics are overridden', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'x' }, baseline());
      expect(errors).toHaveLength(0);
    });
  });

  // ─── Multiple violations ──────────────────────────────────────────────

  describe('multiple violations', () => {
    it('should report all violations at once', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, {
        name: 'x',
        type: 'boolean',     // violation: type change
        required: false,      // violation: loosening
        multiValued: true,    // violation: multiValued change
      }, baseline({ type: 'string', required: true, multiValued: false }));
      expect(errors).toHaveLength(3);
      const characteristics = errors.map(e => e.characteristic);
      expect(characteristics).toContain('type');
      expect(characteristics).toContain('required');
      expect(characteristics).toContain('multiValued');
    });
  });

  // ─── Error structure ──────────────────────────────────────────────────

  describe('error structure', () => {
    it('should include schemaId, attributeName, characteristic, values, and message', () => {
      const errors = validateAttributeTightenOnly(SCHEMA_ID, { name: 'emails', type: 'boolean' }, baseline({ name: 'emails', type: 'string' }));
      expect(errors).toHaveLength(1);
      expect(errors[0].schemaId).toBe(SCHEMA_ID);
      expect(errors[0].attributeName).toBe('emails');
      expect(errors[0].characteristic).toBe('type');
      expect(errors[0].baselineValue).toBe('string');
      expect(errors[0].providedValue).toBe('boolean');
      expect(errors[0].message.length).toBeGreaterThan(0);
    });
  });
});
