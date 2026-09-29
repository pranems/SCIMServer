import { SchemaValidator } from './schema-validator';
import type { SchemaAttributeDefinition, SchemaDefinition } from './validation-types';

const core = 'urn:ietf:params:scim:schemas:core:2.0:User';
const extension = 'urn:example:params:scim:schemas:extension:tests:2.0:User';
const attribute = (overrides: Record<string, unknown> = {}): SchemaAttributeDefinition => ({
  name: 'sample', type: 'string', multiValued: false, required: false, ...overrides,
});
const validate = (value: unknown, definition: SchemaAttributeDefinition, mode: 'create' | 'replace' = 'create') =>
  SchemaValidator.validate({ schemas: [core], sample: value }, [{ id: core, attributes: [definition] }],
    { strictMode: true, mode });

describe('P7 schema value contracts', () => {
  it('does not treat an absent property materialized by a DTO as an unknown attribute', () => {
    expect(SchemaValidator.validate({ active: undefined }, [{ id: core, attributes: [] }],
      { strictMode: true, mode: 'create' })).toEqual({ valid: true, errors: [] });
  });
  it.each([
    ['string', 'outside canonical suggestions'], ['boolean', false], ['integer', 42],
    ['decimal', -1.25e12], ['binary', '+/8='], ['binary', '-_8='],
    ['reference', '../Users/123'], ['reference', 'urn:example:123'],
    ['reference', 'https://example.test/Users/123'],
    ['dateTime', '2024-02-29T21:30:59.123+05:30'],
    ['dateTime', '2024-02-29T21:30:59'], ['dateTime', '2024-02-29T24:00:00Z'],
    ['dateTime', '-0001-01-01T00:00:00Z'],
    ['complex', { child: 'ok' }],
  ])('accepts valid %s scalar and multivalued data: %j', (type, value) => {
    for (const multiValued of [false, true]) {
      expect(validate(multiValued ? [value] : value, attribute({ type, multiValued }))).toEqual({ valid: true, errors: [] });
    }
  });

  it.each([
    ['binary', 'not base64!'], ['binary', 'a'], ['binary', 'a==='], ['binary', 'AA=A'],
    ['reference', 'https://exa mple.test'], ['reference', 'https://[bad'],
    ['reference', 'https://example.test/%GG'], ['reference', '\nhttps://example.test'],
    ['reference', 'Users/[123]'], ['reference', '1invalid:relative'],
    ['dateTime', '2023-02-29T12:00:00Z'], ['dateTime', '2024-02-30T12:00:00Z'],
    ['dateTime', '2024-01-01T25:00:00Z'], ['dateTime', '2024-01-01T00:00:00+15:00'],
    ['integer', Number.POSITIVE_INFINITY], ['integer', 1.5],
    ['decimal', Number.NaN], ['decimal', Number.POSITIVE_INFINITY],
  ])('rejects malformed %s scalar and array element: %j', (type, value) => {
    for (const multiValued of [false, true]) {
      const result = validate(multiValued ? [value] : value, attribute({ type, multiValued }));
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([expect.objectContaining({
        path: multiValued ? 'sample[0]' : 'sample', scimType: 'invalidValue', message: expect.any(String),
      })]);
    }
  });

  it.each(['create', 'replace'] as const)('ignores even malformed readOnly values on %s', mode => {
    expect(validate({ not: 'a number' }, attribute({ type: 'integer', mutability: 'readOnly' }), mode).valid).toBe(true);
    expect(validate({ child: 42 }, attribute({ type: 'complex', subAttributes: [
      attribute({ name: 'child', required: true, mutability: 'readOnly' }),
    ] }), mode).valid).toBe(true);
    expect(validate({}, attribute({ type: 'complex', subAttributes: [
      attribute({ name: 'child', required: true, mutability: 'readOnly' }),
    ] }), mode).valid).toBe(true);
  });

  it('treats canonicalValues as recommendations, preserving caseExact data', () => {
    expect(validate('Home', attribute({ canonicalValues: ['work'], caseExact: true }))).toEqual({ valid: true, errors: [] });
  });

  it.each([null, [], ''])('rejects unassigned required values: %j', value => {
    for (const strictMode of [false, true]) {
      const schemas = [{ id: core, attributes: [attribute({ required: true, multiValued: Array.isArray(value) })] }];
      const result = strictMode
        ? SchemaValidator.validate({ sample: value }, schemas, { strictMode, mode: 'create' })
        : SchemaValidator.validateRequired({ sample: value }, schemas, 'create');
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatchObject({ path: 'sample', scimType: 'invalidValue' });
    }
  });

  it.each([true, false])('enforces required children with strict=%s', strictMode => {
    const schemas = [{ id: core, attributes: [attribute({ type: 'complex', multiValued: true,
      subAttributes: [attribute({ name: 'child', required: true })] })] }];
    const payload = { sample: [{}] };
    const result = strictMode
      ? SchemaValidator.validate(payload, schemas, { strictMode, mode: 'create' })
      : SchemaValidator.validateRequired(payload, schemas, 'create');
    expect(result.errors).toEqual([expect.objectContaining({ path: 'sample[0].child', scimType: 'invalidValue' })]);
  });

  it('applies cardinality and mutability to simple children using the same rules as root attributes', () => {
    expect(validate({ child: 'not an array' }, attribute({ type: 'complex',
      subAttributes: [attribute({ name: 'child', multiValued: true })] })).errors)
      .toEqual([expect.objectContaining({ path: 'sample.child', scimType: 'invalidSyntax' })]);
  });

  it('uses RFC string default for omitted type instead of skipping value validation', () => {
    const omitted = { name: 'sample' } as SchemaAttributeDefinition;
    expect(validate('ok', omitted).valid).toBe(true);
    expect(validate(42, omitted).valid).toBe(false);
  });

  it('rejects a malformed extension block, not just its attributes', () => {
    const schemas: SchemaDefinition[] = [{ id: core, attributes: [] }, { id: extension, attributes: [attribute()] }];
    expect(SchemaValidator.validate({ schemas: [core, extension], [extension]: [] }, schemas,
      { strictMode: true, mode: 'create' }).errors)
      .toEqual([expect.objectContaining({ path: extension, scimType: 'invalidValue' })]);
  });

  it('retains readonly and omitted immutable values in a PUT candidate without touching the stored snapshot', () => {
    const schemas = [{ id: core, attributes: [
      attribute({ name: 'server', mutability: 'readOnly' }),
      attribute({ name: 'fixed', mutability: 'immutable' }),
      attribute({ name: 'parent', type: 'complex', subAttributes: [
        attribute({ name: 'fixed', mutability: 'immutable' }), attribute({ name: 'editable' }),
      ] }),
    ] }];
    const existing = { server: 'owned', fixed: 'first', parent: { fixed: 'nested', editable: 'old' } };
    const snapshot = structuredClone(existing);
    const candidate = { server: 'spoofed', parent: { editable: 'new' } };
    SchemaValidator.prepareReplacement(existing, candidate, schemas);
    expect(candidate).toEqual({ server: 'owned', fixed: 'first', parent: { fixed: 'nested', editable: 'new' } });
    expect(existing).toEqual(snapshot);
  });

  it('preserves immutable values behind undefined DTO properties, including matched list children', () => {
    const schemas = [{ id: core, attributes: [
      attribute({ name: 'fixed', mutability: 'immutable' }),
      attribute({ name: 'members', type: 'complex', multiValued: true, subAttributes: [
        attribute({ name: 'value', mutability: 'immutable' }), attribute({ name: 'display', mutability: 'immutable' }),
      ] }),
    ] }];
    const existing = { fixed: 'first', members: [{ value: 'u1', display: 'Alice' }] };
    const candidate = { fixed: undefined, members: [{ value: 'u1', display: undefined }] };
    SchemaValidator.prepareReplacement(existing, candidate, schemas);
    expect(candidate).toEqual(existing);
    expect(SchemaValidator.checkImmutable(existing, candidate, schemas, undefined, 'replace').valid).toBe(true);
  });
});
