import { PatchExecutor } from './patch-executor';
import { PatchError } from './patch-error';
import type { SchemaDefinition } from '../validation/validation-types';
import { SchemaValidator } from '../validation/schema-validator';

const core = 'urn:example:core:2.0:CommonWidget';
const extension = 'urn:example:extension:CommonWidget';
const schemas: SchemaDefinition[] = [
  { id: core, isCoreSchema: true, attributes: [
    { name: 'requiredElsewhere', type: 'string', required: true, multiValued: false },
    { name: 'marker', type: 'string', required: false, multiValued: false },
  ] },
  { id: extension, required: true, attributes: [
    { name: 'externalId', type: 'integer', required: false, multiValued: true },
  ] },
];

describe('completed PATCH candidate common externalId', () => {
  for (const pathless of [false, true]) {
    it.each([42, false, [], ['invalid'], { value: 'invalid' }])(
      `rejects non-string common values in lenient execution, pathless=${pathless}: %j`, value => {
        const executor = new PatchExecutor({ externalId: 'old', marker: 'before' },
          { strictSchema: false, schemaDefinitions: schemas, extensionUrns: [extension], coreUrn: core });
        expect(() => executor.apply(pathless
          ? { op: 'replace', value: { externalId: value } }
          : { op: 'replace', path: 'externalId', value })).toThrow(PatchError);
        expect(executor.getResult()).toEqual({ externalId: 'old', marker: 'before' });
      },
    );
  }

  it('checks the completed hook result without applying required checks to unrelated fields', () => {
    const executor = new PatchExecutor({ externalId: 'old' },
      { strictSchema: false, schemaDefinitions: schemas },
      { mutate: candidate => ({ ...candidate, externalId: false }) });
    expect(() => executor.apply({ op: 'replace', path: 'marker', value: 'after' })).toThrow(PatchError);
    expect(executor.getResult()).toEqual({ externalId: 'old' });
  });

  it('does not impose full POST/PUT required-extension checks on a PATCH candidate', () => {
    const executor = new PatchExecutor({ externalId: 'old', displayName: [1, 2], active: 'custom' },
      { strictSchema: false, schemaDefinitions: schemas, extensionUrns: [extension], coreUrn: core });
    executor.apply({ op: 'replace', path: 'externalId', value: 'CasePreserved' });
    expect(executor.getResult()).toEqual({ externalId: 'CasePreserved', displayName: [1, 2], active: 'custom' });
  });

  it('keeps extension externalId independent from common-field validation', () => {
    const executor = new PatchExecutor({ externalId: 'root', [extension]: { externalId: [1] } },
      { strictSchema: false, schemaDefinitions: schemas, extensionUrns: [extension], coreUrn: core });
    executor.apply({ op: 'replace', path: `${extension}:externalId`, value: [2, 3] });
    expect(executor.getResult()).toEqual({ externalId: 'root', [extension]: { externalId: [2, 3] } });
  });

  it.each([true, false])('applies common precedence to an old readOnly/typed core definition, strict=%s', strictSchema => {
    const executor = new PatchExecutor({ externalId: 'old' }, {
      strictSchema, ignoreReadOnly: true, coreUrn: core,
      schemaDefinitions: [{ id: core, isCoreSchema: true, attributes: [
        { name: 'externalId', type: 'integer', multiValued: true, required: false, mutability: 'readOnly' },
      ] }],
    });
    executor.apply({ op: 'replace', path: 'externalId', value: 'NewValue' });
    expect(executor.getResult().externalId).toBe('NewValue');
  });

  it('does not mutate a supplied cached definition when applying common PATCH precedence', () => {
    const old = { name: 'externalId', type: 'integer', multiValued: true, required: false, mutability: 'readOnly' } as const;
    const maps = { coreAttrMap: new Map([['externalid', old]]), extensionSchemaMap: new Map<string, SchemaDefinition>() };
    expect(SchemaValidator.validatePatchOperationValue('replace', 'externalId', 'NewValue', schemas, maps).valid).toBe(true);
    expect(maps.coreAttrMap.get('externalid')).toBe(old);
    expect(old.mutability).toBe('readOnly');
  });

  it('keeps remove value-insensitive and does not require unrelated resource fields', () => {
    const executor = new PatchExecutor({ externalId: 'old' }, { strictSchema: false, schemaDefinitions: schemas });
    executor.apply({ op: 'remove', path: 'externalId', value: { irrelevant: 42 } });
    expect(executor.getResult()).toEqual({});
  });
});
