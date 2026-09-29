import { PatchExecutor } from './patch-executor';
import { SchemaValidator } from '../validation/schema-validator';
import type { SchemaDefinition } from '../validation/validation-types';

const core = 'urn:example:core:2.0:Widget';
const ext = 'urn:example:extension:2.0';
const schemas: SchemaDefinition[] = [
  { id: core, isCoreSchema: true, attributes: [
    { name: 'label', type: 'string', required: true, multiValued: false },
    { name: 'marker', type: 'string', required: false, multiValued: false },
  ] },
  { id: ext, isCoreSchema: false, required: true, attributes: [
    { name: 'count', type: 'integer', required: false, multiValued: false },
    { name: 'record', type: 'complex', required: false, multiValued: false, subAttributes: [
      { name: 'key', type: 'string', required: true, multiValued: false, mutability: 'immutable' },
      { name: 'note', type: 'string', required: false, multiValued: false },
    ] },
    { name: 'tags', type: 'string', multiValued: true, required: false },
  ] },
];

describe('P7b shared PATCH target and evolving schema contracts', () => {
  it.each(['add', 'replace'])('%s accepts a whole numeric-version namespace', op => {
    expect(SchemaValidator.validatePatchOperationValue(op, ext, { count: 3 }, schemas))
      .toEqual({ valid: true, errors: [] });
  });
  it.each([3, [], ['invalid'], { count: 'bad' }, { unknown: true },
    { record: { key: 'ok', unknown: true } }, { record: { key: 7 } }])(
    'rejects malformed namespace input %j through both spellings', value => {
      for (const path of [ext, undefined]) {
        const result = SchemaValidator.validatePatchOperationValue('replace', path,
          path ? value : { [ext]: value }, schemas);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }
    },
  );
  it('preserves PATCH add singleton and partial required-child semantics', () => {
    expect(SchemaValidator.validatePatchOperationValue('add', ext, {
      tags: 'new', record: { note: 'partial' },
    }, schemas).valid).toBe(true);
    expect(SchemaValidator.validatePatchOperationValue('remove', ext, undefined, schemas).valid).toBe(true);
  });
  it('allows an optional namespace to be absent even if its attributes are required when present', () => {
    const optional: SchemaDefinition[] = [schemas[0], { id: ext, isCoreSchema: false, required: false,
      attributes: [{ name: 'count', type: 'integer', required: true, multiValued: false }] }];
    const executor = new PatchExecutor({ label: 'kept', [ext]: { count: 1 } },
      { coreUrn: core, extensionUrns: [ext], schemaDefinitions: optional, strictSchema: true });
    executor.apply({ op: 'remove', path: ext });
    expect(executor.getResult()).toEqual({ label: 'kept' });
  });
  it('does not lose required children when lenient input changes a complex container', () => {
    const executor = new PatchExecutor({ label: 'kept', [ext]: { count: 1 } },
      { coreUrn: core, extensionUrns: [ext], schemaDefinitions: schemas, strictSchema: false });
    expect(() => executor.apply({ op: 'replace', path: `${ext}:record`, value: 'not-a-record' }))
      .toThrow(expect.objectContaining({ scimType: 'invalidValue', operationIndex: 0 }));
  });
  for (const strictSchema of [true, false]) {
    it.each([
      { op: 'remove', path: ext },
      { op: 'replace', path: ext, value: null },
      { op: 'replace', value: { [ext]: null } },
      { op: 'remove', path: `${ext}:count` },
    ])(`rejects unassigning required namespace strict=${strictSchema}: %j`, operation => {
      const executor = new PatchExecutor({ schemas: [core, ext], label: 'kept', [ext]: { count: 1 } },
        { coreUrn: core, extensionUrns: [ext], schemaDefinitions: schemas, strictSchema });
      executor.apply({ op: 'replace', path: 'marker', value: 'first' });
      expect(() => executor.apply(operation)).toThrow(expect.objectContaining({ operationIndex: 1, scimType: 'invalidValue' }));
      expect(executor.getResult()).toEqual({ schemas: [core, ext], label: 'kept', marker: 'first', [ext]: { count: 1 } });
    });
    it(`uses full evolving roots for required/immutable children strict=${strictSchema}`, () => {
      const executor = new PatchExecutor({ schemas: [core, ext], label: 'kept', [ext]: { count: 1 } },
        { coreUrn: core, extensionUrns: [ext], schemaDefinitions: schemas, strictSchema });
      executor.apply({ op: 'add', path: ext, value: { record: { key: 'first' } } });
      executor.apply({ op: 'replace', path: ext, value: { record: { note: 'partial' } } });
      expect(() => executor.apply({ op: 'replace', path: ext, value: { record: { key: 'second' } } }))
        .toThrow(expect.objectContaining({ operationIndex: 2, scimType: 'mutability' }));
      expect(executor.getResult()[ext]).toEqual({ count: 1, record: { key: 'first', note: 'partial' } });
    });
  }
});
