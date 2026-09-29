import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition } from './validation-types';
import { validateAndExpandProfile } from '../../modules/scim/endpoint-profile/endpoint-profile.service';
import type { ShorthandProfileInput } from '../../modules/scim/endpoint-profile/endpoint-profile.types';
import { stripReadOnlyAttributes } from '../../modules/scim/common/scim-service-helpers';

const core = 'urn:example:core:2.0:Widget';
const ext = 'urn:example:extension:2.0:Widget';
const profile = (attribute: Record<string, unknown>, extension = false) => ({
  schemas: [
    { id: core, name: 'Widget', attributes: extension ? [] : [attribute] },
    ...(extension ? [{ id: ext, name: 'Ext', attributes: [attribute] }] : []),
  ],
  resourceTypes: [{ id: 'Widget', name: 'Widget', endpoint: '/Widgets', schema: core,
    schemaExtensions: extension ? [{ schema: ext, required: false }] : [] }],
} as unknown as ShorthandProfileInput);

describe('P7 common externalId contract', () => {
  it.each([
    { name: 'id', type: 'integer' }, { name: 'id', mutability: 'readWrite' }, { name: 'id', returned: 'never' },
    { name: 'meta', type: 'string' }, { name: 'meta', mutability: 'readWrite' }, { name: 'meta', multiValued: true },
  ])('rejects an explicit common id/meta conflict only in a core-only declaration: %j', attribute => {
    expect(validateAndExpandProfile(profile(attribute)).valid).toBe(false);
    expect(validateAndExpandProfile(profile(attribute, true)).valid).toBe(true);
  });

  it('does not reject or rewrite one schema used as a core and as another resource extension', () => {
    const shared = 'urn:ietf:params:scim:schemas:core:2.0:SharedWidget';
    const input = {
      schemas: [
        { id: shared, name: 'Shared', attributes: [
          { name: 'externalId', type: 'integer', multiValued: true, caseExact: false },
          { name: 'id', type: 'integer', multiValued: true },
          { name: 'meta', type: 'string' },
        ] },
        { id: core, name: 'Widget', attributes: [] },
      ],
      resourceTypes: [
        { id: 'Shared', name: 'Shared', endpoint: '/Shareds', schema: shared, schemaExtensions: [] },
        { id: 'Widget', name: 'Widget', endpoint: '/Widgets', schema: core, schemaExtensions: [{ schema: shared, required: false }] },
      ],
    } as unknown as ShorthandProfileInput;
    const before = structuredClone(input);
    const result = validateAndExpandProfile(input);
    expect(result.valid).toBe(true);
    expect(result.profile!.schemas[0].attributes).toEqual(input.schemas![0].attributes);
    expect(input).toEqual(before);
  });

  it('does not apply common-attribute baseline expansion to a known schema used as an extension', () => {
    const known = 'urn:ietf:params:scim:schemas:core:2.0:User';
    const independent = [
      { name: 'externalId', type: 'integer', multiValued: true },
      { name: 'id', type: 'integer' },
      { name: 'meta', type: 'string' },
    ];
    const input = {
      schemas: [{ id: core, name: 'Widget', attributes: [] }, { id: known, name: 'ExtensionUse', attributes: independent }],
      resourceTypes: [{ id: 'Widget', name: 'Widget', endpoint: '/Widgets', schema: core,
        schemaExtensions: [{ schema: known, required: false }] }],
    } as unknown as ShorthandProfileInput;
    const result = validateAndExpandProfile(input);
    expect(result.valid).toBe(true);
    const attrs = result.profile!.schemas.find(schema => schema.id === known)!.attributes;
    expect(attrs.filter(attr => independent.some(original => original.name === attr.name))).toEqual(independent);
  });

  it.each([false, true])('ignores common id/meta despite missing or obsolete declarations, cache=%s', cached => {
    const shared = 'urn:ietf:params:scim:schemas:core:2.0:SharedWidget';
    const declarations = [
      { name: 'id', type: 'integer', multiValued: true, required: true, mutability: 'readWrite', returned: 'never' },
      { name: 'meta', type: 'string', multiValued: false, required: true, mutability: 'immutable' },
    ];
    const schemas: SchemaDefinition[] = [
      { id: core, isCoreSchema: true, attributes: declarations },
      { id: shared, isCoreSchema: false, attributes: declarations },
    ];
    const input = { schemas: [core, shared], ID: ['spoof'], MeTa: 42, [shared]: { id: [7, 9], meta: 'extension' } };
    stripReadOnlyAttributes(input, schemas, cached ? SchemaValidator.buildCharacteristicsCache(schemas).readOnlyCollected : undefined);
    expect(input).toEqual({ schemas: [core, shared], [shared]: { id: [7, 9], meta: 'extension' } });
    expect(SchemaValidator.validate(input, schemas, { mode: 'create', strictMode: true }).valid).toBe(true);
    const absent = { id: 'spoof', meta: { bad: true } };
    stripReadOnlyAttributes(absent, [{ id: core, isCoreSchema: true, attributes: [] }]);
    expect(absent).toEqual({});
  });

  it.each([{ type: 'integer' }, { multiValued: true }, { caseExact: false }, { mutability: 'readOnly' },
    { mutability: 'immutable' }, { mutability: 'writeOnly' }])('rejects conflicting core externalId %j, not extension names', override => {
    expect(validateAndExpandProfile(profile({ name: 'externalId', ...override })).valid).toBe(false);
    expect(validateAndExpandProfile(profile({ name: 'externalId', ...override }, true)).valid).toBe(true);
  });

  it('does not impose promoted-column types on custom displayName or active', () => {
    expect(validateAndExpandProfile(profile({ name: 'displayName', type: 'integer', multiValued: true })).valid).toBe(true);
    expect(validateAndExpandProfile(profile({ name: 'active', type: 'string' })).valid).toBe(true);
  });

  it('fills common externalId characteristics on an explicit shorthand custom-core declaration', () => {
    const result = validateAndExpandProfile(profile({ name: 'externalId' }));
    expect(result.profile!.schemas[0].attributes[0]).toMatchObject({
      type: 'string', multiValued: false, caseExact: true, mutability: 'readWrite',
    });
  });

  it.each([42, false, [], ['x'], { value: 'x' }])('rejects non-string common externalId %j without requiring a declared core attribute', value => {
    const schemas: SchemaDefinition[] = [{ id: core, isCoreSchema: true, attributes: [] }];
    expect(SchemaValidator.validate({ externalId: value }, schemas, { mode: 'create', strictMode: true }).errors)
      .toEqual([expect.objectContaining({ path: 'externalId', scimType: 'invalidValue' })]);
    expect(SchemaValidator.validateRequired({ externalId: value }, schemas, 'replace').errors)
      .toEqual([expect.objectContaining({ path: 'externalId', scimType: 'invalidValue' })]);
  });

  it('applies common precedence to old conflicting core definitions but not extension definitions', () => {
    const schemas: SchemaDefinition[] = [
      { id: core, isCoreSchema: true, attributes: [{ name: 'externalId', type: 'boolean', multiValued: true,
        required: false, caseExact: false, mutability: 'readOnly' }] },
      { id: ext, attributes: [{ name: 'externalId', type: 'integer', multiValued: true, required: false }] },
    ];
    const cache = SchemaValidator.buildCharacteristicsCache(schemas);
    expect(cache.coreAttrMap.get('externalid')).toMatchObject({ type: 'string', multiValued: false, caseExact: true, mutability: 'readWrite' });
    expect(cache.readOnlyCollected.core.has('externalid')).toBe(false);
    const incoming = { externalId: 'NEW', [ext]: { externalId: [7] } };
    SchemaValidator.prepareReplacement({ externalId: 'old' }, incoming, schemas);
    expect(incoming.externalId).toBe('NEW');
    expect(SchemaValidator.validate(incoming, schemas, { mode: 'replace', strictMode: true }).valid).toBe(true);
  });
});
