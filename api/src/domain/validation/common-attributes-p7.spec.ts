import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition } from './validation-types';
import { validateAndExpandProfile } from '../../modules/scim/endpoint-profile/endpoint-profile.service';
import type { ShorthandProfileInput } from '../../modules/scim/endpoint-profile/endpoint-profile.types';

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
