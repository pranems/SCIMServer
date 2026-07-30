/**
 * RfcCompliantSubAttributes - RFC-correct sub-attribute handling.
 *
 * The flag turns on TWO orthogonal RFC 7643 rules together. Conflating them is
 * the most common way to get sub-attribute handling wrong, so both directions
 * are locked here:
 *
 *   R1 - section 2.3.8: "A complex attribute MUST NOT contain sub-attributes
 *        that have sub-attributes (i.e., that are complex)." Reinforced by
 *        erratum 8415 (Verified 2025-10-28), which struck "complex" from the
 *        legal values of subAttributes.type in section 8.7.1.
 *        => COMPLEXITY at level 2 is FORBIDDEN.
 *
 *   R2 - section 1.2: a simple attribute is "a singular or multi-valued
 *        attribute whose value is a primitive", so a multi-valued SIMPLE
 *        sub-attribute is legal. Erratum 5607 (Verified) confirms it for
 *        `referenceTypes` inside `subAttributes`.
 *        => MULTI-VALUEDNESS at level 2 is PERMITTED.
 *
 * SCIMServer's historical behavior gets BOTH wrong in opposite directions: it
 * recurses into complex sub-attributes with no depth cap (too permissive for
 * R1) and treats every sub-attribute as singular (too strict for R2). That
 * legacy behavior is the DEFAULT and is locked by the "flag OFF" block below,
 * so enabling the flag is the only thing that changes anything.
 *
 * @see docs/rfcs/SCIM_SUBATTRIBUTE_TYPE_RULES.md
 */
import { SchemaValidator } from './schema-validator';
import type { SchemaAttributeDefinition, SchemaDefinition } from './validation-types';

const CORE_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';

/** A legal level-2 simple sub-attribute. */
const simpleSub = (name: string, type = 'string'): SchemaAttributeDefinition => ({
  name,
  type,
  multiValued: false,
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
});

const schemaOf = (...attributes: SchemaAttributeDefinition[]): SchemaDefinition[] => [
  { id: CORE_URN, attributes },
];

/**
 * R1 violation: `geo` sits inside `address` and declares sub-attributes of its
 * own. Exactly the shape section 2.3.8 forbids, and exactly the shape
 * SCIMServer accepts today.
 */
const nestedComplexAttr: SchemaAttributeDefinition = {
  name: 'address',
  type: 'complex',
  multiValued: false,
  required: false,
  mutability: 'readWrite',
  returned: 'default',
  subAttributes: [
    simpleSub('street'),
    {
      name: 'geo',
      type: 'complex',
      multiValued: false,
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      subAttributes: [simpleSub('lat', 'decimal'), simpleSub('lon', 'decimal')],
    },
  ],
};

/** Legal: every sub-attribute is simple and singular. */
const legalComplexAttr: SchemaAttributeDefinition = {
  name: 'name',
  type: 'complex',
  multiValued: false,
  required: false,
  mutability: 'readWrite',
  returned: 'default',
  subAttributes: [simpleSub('givenName'), simpleSub('familyName')],
};

/** R2 case: `skus` is a multi-valued SIMPLE sub-attribute, which is legal. */
const multiValuedSimpleSubAttr: SchemaAttributeDefinition = {
  name: 'licenses',
  type: 'complex',
  multiValued: true,
  required: false,
  mutability: 'readWrite',
  returned: 'default',
  subAttributes: [simpleSub('value'), { ...simpleSub('skus'), multiValued: true }],
};

// lat/lon are declared `decimal`, so the payload must carry NUMBERS. Passing
// strings here would fail for an unrelated type reason and mask what is
// actually under test.
const nestedPayload = { address: { street: '1 Main St', geo: { lat: 47.6, lon: -122.3 } } };
const multiValuedPayload = { licenses: [{ value: 'E5', skus: ['EXCHANGE', 'TEAMS'] }] };

describe('RfcCompliantSubAttributes', () => {
  describe('flag OFF (default) - legacy behavior is preserved exactly', () => {
    it('R1 legacy: ACCEPTS a payload whose schema declares a COMPLEX sub-attribute', () => {
      const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
        strictMode: true,
        mode: 'create',
      });

      expect(result.errors).toEqual([]);
    });

    it('R1 legacy: accepts it when the flag is explicitly false', () => {
      const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
        strictMode: true,
        mode: 'create',
        rfcCompliantSubAttributes: false,
      });

      expect(result.errors).toEqual([]);
    });

    it('R2 legacy: REJECTS a legal multi-valued simple sub-attribute', () => {
      const result = SchemaValidator.validate(
        multiValuedPayload,
        schemaOf(multiValuedSimpleSubAttr),
        { strictMode: true, mode: 'create' },
      );

      // Documents the historical defect this flag exists to correct.
      expect(result.errors.some(e => e.path === 'licenses[0].skus')).toBe(true);
    });
  });

  describe('flag ON - R1: complex sub-attributes are refused (section 2.3.8)', () => {
    it('rejects a payload whose schema declares a COMPLEX sub-attribute', () => {
      const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
        strictMode: true,
        mode: 'create',
        rfcCompliantSubAttributes: true,
      });

      const err = result.errors.find(e => e.path.includes('geo'));
      expect(err).toBeDefined();
      expect(err!.scimType).toBe('invalidValue');
      expect(err!.message).toMatch(/2\.3\.8/);
    });

    it('names the offending sub-attribute path, not just the parent', () => {
      const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
        strictMode: true,
        mode: 'create',
        rfcCompliantSubAttributes: true,
      });

      expect(result.errors.some(e => e.path === 'address.geo')).toBe(true);
    });

    it('emits exactly ONE error, not a cascade from recursing into the bad shape', () => {
      const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
        strictMode: true,
        mode: 'create',
        rfcCompliantSubAttributes: true,
      });

      expect(result.errors).toHaveLength(1);
    });

    it('still accepts a legal complex attribute with only simple sub-attributes', () => {
      const result = SchemaValidator.validate(
        { name: { givenName: 'Barbara', familyName: 'Jensen' } },
        schemaOf(legalComplexAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors).toEqual([]);
    });

    it('fires on a multi-valued complex attribute element too', () => {
      const multiValuedNested: SchemaAttributeDefinition = {
        ...nestedComplexAttr,
        name: 'addresses',
        multiValued: true,
      };

      const result = SchemaValidator.validate(
        { addresses: [{ street: '1 Main St', geo: { lat: 47.6, lon: -122.3 } }] },
        schemaOf(multiValuedNested),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors.some(e => /2\.3\.8/.test(e.message))).toBe(true);
    });

    it('does not fire when the payload omits the offending sub-attribute', () => {
      const result = SchemaValidator.validate(
        { address: { street: '1 Main St' } },
        schemaOf(nestedComplexAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors).toEqual([]);
    });

    it('applies on replace and patch modes, not just create', () => {
      for (const mode of ['replace', 'patch'] as const) {
        const result = SchemaValidator.validate(nestedPayload, schemaOf(nestedComplexAttr), {
          strictMode: true,
          mode,
          rfcCompliantSubAttributes: true,
        });

        expect(result.errors.some(e => /2\.3\.8/.test(e.message))).toBe(true);
      }
    });
  });

  describe('flag ON - R2: multi-valued SIMPLE sub-attributes are honoured (section 1.2)', () => {
    it('accepts an array of primitives in a multi-valued simple sub-attribute', () => {
      const result = SchemaValidator.validate(
        multiValuedPayload,
        schemaOf(multiValuedSimpleSubAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors).toEqual([]);
    });

    it('still type-checks EACH element, and reports the offending index', () => {
      const result = SchemaValidator.validate(
        { licenses: [{ value: 'E5', skus: ['EXCHANGE', 42] }] },
        schemaOf(multiValuedSimpleSubAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      // Honouring multiValued must not become "skip validation".
      expect(result.errors.some(e => e.path === 'licenses[0].skus[1]')).toBe(true);
    });

    it('leaves a SINGULAR sub-attribute untouched when the flag is on', () => {
      const result = SchemaValidator.validate(
        { licenses: [{ value: 'E5' }] },
        schemaOf(multiValuedSimpleSubAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors).toEqual([]);
    });

    it('does not treat null as an array (section 2.5 unassigned handling intact)', () => {
      const result = SchemaValidator.validate(
        { licenses: [{ value: 'E5', skus: null }] },
        schemaOf(multiValuedSimpleSubAttr),
        { strictMode: true, mode: 'create', rfcCompliantSubAttributes: true },
      );

      expect(result.errors).toEqual([]);
    });
  });
});
