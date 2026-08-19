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
 * SCIMServer's historical behavior got BOTH wrong in opposite directions: it
 * recursed into complex sub-attributes with no depth cap (too permissive for
 * R1) and treated every sub-attribute as singular (too strict for R2).
 *
 * Only R1 is flag-gated, because only R1 TIGHTENS. R2 is a straight defect fix
 * - strict mode was rejecting payloads that CONFORM to the declared schema,
 * because it honoured `multiValued` at level 1 and ignored it at level 2 - so
 * it applies whenever strict validation runs, flag or not.
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

/**
 * STANDALONE contract. `RfcCompliantSubAttributes` is deliberately NOT gated on
 * `StrictSchemaValidation`. The two answer different questions:
 *
 *   StrictSchemaValidation  - "how carefully do I police an inbound payload?"
 *   RfcCompliantSubAttributes - "is this schema shape legal at all?"
 *
 * An endpoint running lenient for Entra interop must still be able to refuse a
 * schema shape RFC 7643 forbids. `validateSubAttributeNesting` is the dedicated
 * R1-only pass that runs on the NON-strict path, and it must not drag any of
 * strict mode's other checks (unknown attributes, type coercion, required)
 * along with it - doing so would silently turn strict mode on.
 */
describe('RfcCompliantSubAttributes - standalone pass (strict OFF)', () => {
  it('R1 fires with StrictSchemaValidation OFF', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      nestedPayload,
      schemaOf(nestedComplexAttr),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'address.geo')).toBe(true);
    expect(result.errors[0].scimType).toBe('invalidValue');
    expect(result.errors[0].message).toMatch(/2\.3\.8/);
  });

  it('does NOT report unknown attributes (that is strict mode is job, not ours)', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      { address: { street: '1 Main St', totallyUnknown: 'x' }, alsoUnknown: 1 },
      schemaOf(nestedComplexAttr),
    );

    expect(result.errors).toEqual([]);
  });

  it('does NOT report type mismatches', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      { address: { street: 12345 } },
      schemaOf(nestedComplexAttr),
    );

    expect(result.errors).toEqual([]);
  });

  it('does NOT report missing required attributes', () => {
    const requiredAttr: SchemaAttributeDefinition = {
      ...legalComplexAttr,
      subAttributes: [{ ...simpleSub('givenName'), required: true }, simpleSub('familyName')],
    };

    const result = SchemaValidator.validateSubAttributeNesting({ name: {} }, schemaOf(requiredAttr));

    expect(result.errors).toEqual([]);
  });

  it('accepts a legal complex attribute', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      { name: { givenName: 'Barbara' } },
      schemaOf(legalComplexAttr),
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a multi-valued SIMPLE sub-attribute (R2 shape must not trip R1)', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      multiValuedPayload,
      schemaOf(multiValuedSimpleSubAttr),
    );

    expect(result.errors).toEqual([]);
  });

  it('walks every element of a multi-valued complex attribute', () => {
    const multiValuedNested: SchemaAttributeDefinition = {
      ...nestedComplexAttr,
      name: 'addresses',
      multiValued: true,
    };

    const result = SchemaValidator.validateSubAttributeNesting(
      {
        addresses: [
          { street: 'ok' },
          { street: '1 Main St', geo: { lat: 47.6, lon: -122.3 } },
        ],
      },
      schemaOf(multiValuedNested),
    );

    expect(result.errors.some(e => e.path === 'addresses[1].geo')).toBe(true);
  });

  it('walks extension-schema attributes too, not just core', () => {
    const EXT = 'urn:example:params:scim:schemas:extension:2.0:User';
    const schemas: SchemaDefinition[] = [
      { id: CORE_URN, attributes: [legalComplexAttr] },
      { id: EXT, attributes: [nestedComplexAttr] },
    ];

    const result = SchemaValidator.validateSubAttributeNesting(
      { [EXT]: { address: { street: '1 Main St', geo: { lat: 1, lon: 2 } } } },
      schemas,
    );

    expect(result.errors.some(e => e.path.includes('geo'))).toBe(true);
  });

  it('ignores an unassigned (null) complex attribute', () => {
    const result = SchemaValidator.validateSubAttributeNesting(
      { address: null },
      schemaOf(nestedComplexAttr),
    );

    expect(result.errors).toEqual([]);
  });
});

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

    // R2 is deliberately NOT locked here: it is a defect fix, not a tightening,
    // so it applies with the flag off. See the base-behavior block below.
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

  /**
   * R2 is BASE strict behavior, not a flag. Every case is run at all three flag
   * settings, so a future change cannot quietly re-gate it on the flag: the
   * `undefined` and `false` rows would go red.
   */
  describe.each([
    ['flag absent', undefined],
    ['flag false', false],
    ['flag true', true],
  ])(
    'base strict behavior - R2: multi-valued SIMPLE sub-attributes are honoured (section 1.2) [%s]',
    (_label, flag) => {
      const opts = { strictMode: true, mode: 'create' as const, rfcCompliantSubAttributes: flag };

      it('accepts an array of primitives in a multi-valued simple sub-attribute', () => {
        const result = SchemaValidator.validate(
          multiValuedPayload,
          schemaOf(multiValuedSimpleSubAttr),
          opts,
        );

        expect(result.errors).toEqual([]);
      });

      it('still type-checks EACH element, and reports the offending index', () => {
        const result = SchemaValidator.validate(
          { licenses: [{ value: 'E5', skus: ['EXCHANGE', 42] }] },
          schemaOf(multiValuedSimpleSubAttr),
          opts,
        );

        // Honouring multiValued must not become "skip validation".
        expect(result.errors.some(e => e.path === 'licenses[0].skus[1]')).toBe(true);
      });

      it('leaves a SINGULAR sub-attribute untouched', () => {
        const result = SchemaValidator.validate(
          { licenses: [{ value: 'E5' }] },
          schemaOf(multiValuedSimpleSubAttr),
          opts,
        );

        expect(result.errors).toEqual([]);
      });

      it('does not treat null as an array (section 2.5 unassigned handling intact)', () => {
        const result = SchemaValidator.validate(
          { licenses: [{ value: 'E5', skus: null }] },
          schemaOf(multiValuedSimpleSubAttr),
          opts,
        );

        expect(result.errors).toEqual([]);
      });

      it('still rejects an array in a SINGULAR sub-attribute (cardinality still enforced)', () => {
        const result = SchemaValidator.validate(
          { licenses: [{ value: ['E5', 'E3'] }] },
          schemaOf(multiValuedSimpleSubAttr),
          opts,
        );

        expect(result.errors.some(e => e.path === 'licenses[0].value')).toBe(true);
      });
    },
  );
});
