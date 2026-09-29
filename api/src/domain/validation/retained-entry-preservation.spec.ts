import { SchemaValidator } from './schema-validator';
import type { SchemaDefinition } from './validation-types';
import { retainedEntries } from '../patch/patch-values';
import { retainedEntryCases, retainedRecordsAttribute } from '../../../test/helpers/retained-entry.fixture';

const core = 'urn:example:core:2.0:Retained';
const extension = 'urn:example:extension:2.0:Retained';

describe('one-to-one retained multi-valued entries', () => {
  it.each(retainedEntryCases)('PATCH matcher consumes $name without mutating either input', scenario => {
    const before = structuredClone(scenario.before);
    const after = structuredClone(scenario.after);
    const selected = retainedEntries(before, after);
    expect(after.map((entry, index) => selected[index]?.server === undefined
      ? entry : { ...entry, server: selected[index]?.server })).toEqual(scenario.expected);
    expect(before).toEqual(scenario.before);
    expect(after).toEqual(scenario.after);
  });

  for (const mutability of ['readOnly', 'immutable'] as const) {
    it.each(retainedEntryCases)(`PUT preserves ${mutability} through $name`, scenario => {
      const attributes = [retainedRecordsAttribute(mutability)];
      const schemas: SchemaDefinition[] = [
        { id: core, isCoreSchema: true, attributes },
        { id: extension, attributes },
      ];
      const existing = { records: scenario.before, [extension]: { records: scenario.before } };
      const snapshot = structuredClone(existing);
      const candidate = { records: structuredClone(scenario.after), [extension]: { records: structuredClone(scenario.after) } };
      SchemaValidator.prepareReplacement(existing, candidate, schemas);
      expect(candidate).toEqual({ records: scenario.expected, [extension]: { records: scenario.expected } });
      expect(existing).toEqual(snapshot);
      expect(SchemaValidator.checkImmutable(existing, candidate, schemas, undefined, 'replace').valid).toBe(true);
    });
  }

  it('immutable comparison matches each duplicate occurrence rather than the last value', () => {
    const scenario = retainedEntryCases.find(entry => entry.name === 'duplicate values reordered by type')!;
    const schemas: SchemaDefinition[] = [{ id: core, isCoreSchema: true, attributes: [retainedRecordsAttribute('immutable')] }];
    expect(SchemaValidator.checkImmutable(
      { records: scenario.before }, { records: scenario.expected }, schemas, undefined, 'replace',
    ).valid).toBe(true);
    const changed = structuredClone(scenario.expected);
    changed[0].server = 'work-owned';
    expect(SchemaValidator.checkImmutable(
      { records: scenario.before }, { records: changed }, schemas, undefined, 'replace',
    )).toMatchObject({ valid: false, errors: [{ path: 'records[0].server', scimType: 'mutability' }] });
  });

  it('keeps correspondence stable when protected type values are restored', () => {
    const combinations: (string | null | undefined)[][] = [[]];
    let layer: (string | null | undefined)[][] = [[]];
    for (let length = 1; length <= 3; length++) {
      layer = layer.flatMap(types => [undefined, null, 'work', 'home'].map(type => [...types, type]));
      combinations.push(...layer);
    }
    for (const beforeTypes of combinations) {
      for (const afterTypes of combinations) {
        const before = beforeTypes.map((type, index) => ({ value: 'same', type, server: `server-${index}` }));
        const after = afterTypes.map(type => ({ value: 'same', type }));
        const paired = retainedEntries(before, after);
        for (const readOnly of [false, true]) {
          if (!readOnly && paired.some((entry, index) =>
            entry?.type != null && after[index].type !== undefined && after[index].type !== entry.type)) continue;
          const restored = after.map((entry, index) => paired[index] && (readOnly || entry.type === undefined)
            ? { ...entry, type: paired[index]?.type } : entry);
          expect(retainedEntries(before, restored)).toEqual(paired);
        }
      }
    }
  });
});
