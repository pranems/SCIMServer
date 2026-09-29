import { retainedEntries } from '../attribute-values';
import { PatchExecutor } from '../patch/patch-executor';
import { SchemaValidator } from './schema-validator';
import type { SchemaAttributeDefinition as Attribute, SchemaDefinition } from './validation-types';

type Entry = Record<string, unknown>;
const core = 'urn:ietf:params:scim:schemas:core:2.0:User';
const extension = 'urn:example:params:scim:schemas:extension:entries:2.0:User';
const attr = (name: string, extra: Partial<Attribute> = {}): Attribute =>
  ({ name, type: 'string', multiValued: false, required: false, ...extra });
const records = attr('records', { type: 'complex', multiValued: true, subAttributes: [
  attr('value'), attr('type'), attr('label'), attr('server', { mutability: 'readOnly' }),
  attr('fixed', { mutability: 'immutable' }),
] });
const same = (type?: string): Entry => ({ value: 'same', ...(type === undefined ? {} : { type }) });
const cases: { name: string; before: Entry[]; after: Entry[]; indices: (number | undefined)[] }[] = [
  { name: 'duplicate value reordered by type', before: [same('work'), same('home')],
    after: [same('home'), same('work')], indices: [1, 0] },
  { name: 'same value and type occurrence', before: [same('work'), same('work')],
    after: [same('work'), same('work'), same('work')], indices: [0, 1, undefined] },
  { name: 'anonymous occurrences do not steal identified entries', before: [same(), {}, {}],
    after: [{}, same(), {}, {}], indices: [1, 0, 2, undefined] },
  { name: 'anonymous entries with type', before: [{ type: 'work' }, { type: 'home' }],
    after: [{ type: 'home' }, { type: 'work' }], indices: [1, 0] },
  { name: 'absent and null value are separate buckets', before: [{}, { value: null }],
    after: [{ value: null }, {}], indices: [1, 0] },
  { name: 'omitted type reserves later exact matches', before: [same('work'), same('home')],
    after: [same(), same('work')], indices: [1, 0] },
  { name: 'unknown type reserves later exact matches', before: [same('work'), same('home')],
    after: [same('other'), same('work')], indices: [1, 0] },
  { name: 'all omitted types use stable occurrence', before: [same('work'), same('home')],
    after: [same(), same()], indices: [0, 1] },
  { name: 'omitted type cannot distinguish equal typed occurrences', before: [same('work'), same('work')],
    after: [same(), same('work')], indices: [0, 1] },
  { name: 'partial typed duplicates use candidate occurrence order', before: [same('work'), same('work'), same('home')],
    after: [same(), same('work')], indices: [0, 1] },
  { name: 'removed and added identities', before: [{ value: 'removed' }, same('work')],
    after: [{ value: 'added' }, same('work')], indices: [undefined, 1] },
  { name: 'case-insensitive keys', before: [{ VALUE: 'same', TYPE: 'work' }, { value: 'same', type: 'home' }],
    after: [{ VaLuE: 'same', TyPe: 'home' }, same('work')], indices: [1, 0] },
  { name: 'empty replacement is not append', before: [same('work')], after: [], indices: [] },
];

describe('one-to-one retained entries', () => {
  it.each(cases)('$name', ({ before, after, indices }) => {
    const snapshot = structuredClone({ before, after });
    const matches = retainedEntries(before, after);
    expect(matches).toEqual(indices.map(index => index === undefined ? undefined : before[index]));
    expect(new Set(matches.filter(Boolean)).size).toBe(matches.filter(Boolean).length);
    expect({ before, after }).toEqual(snapshot);
  });
  it('does not coerce values or pair non-object elements', () => {
    expect(retainedEntries([{ value: 1 }, { value: '1' }, null, []], [{ value: '1' }, { value: 1 }, null, []]))
      .toEqual([{ value: '1' }, { value: 1 }, undefined, undefined]);
  });
  it('is stable after valid discriminator restoration across every short type combination', () => {
    const combinations: (string | null | undefined)[][] = [[]];
    let layer: (string | null | undefined)[][] = [[]];
    for (let length = 1; length <= 3; length++) {
      layer = layer.flatMap(types => [undefined, null, 'work', 'home'].map(type => [...types, type]));
      combinations.push(...layer);
    }
    for (const beforeTypes of combinations) for (const afterTypes of combinations) {
      const before = beforeTypes.map((type, i) => ({ value: 'same', type, fixed: `fixed-${i}` }));
      const after = afterTypes.map(type => ({ value: 'same', type }));
      const paired = retainedEntries(before, after);
      for (const readOnly of [false, true]) {
        if (!readOnly && paired.some((entry, i) =>
          entry?.type != null && after[i].type !== undefined && after[i].type !== entry.type)) continue;
        const restored = after.map((entry, i) => paired[i] && (readOnly || entry.type === undefined)
          ? { ...entry, type: paired[i]!.type } : entry);
        expect({ beforeTypes, afterTypes, readOnly, matches: retainedEntries(before, restored) })
          .toEqual({ beforeTypes, afterTypes, readOnly, matches: paired });
      }
    }
  });
});

describe.each([false, true])('PUT/PATCH entry contract extension=%s', extended => {
  const schemas: SchemaDefinition[] = [{ id: extended ? extension : core, attributes: [records] }];
  const wrap = (entries: Entry[]): Record<string, unknown> => extended ? { [extension]: { records: entries } } : { records: entries };
  const unwrap = (body: Record<string, unknown>): Entry[] =>
    (extended ? body[extension] as Record<string, unknown> : body).records as Entry[];
  const options = { schemaDefinitions: schemas, extensionUrns: extended ? [extension] : [], ignoreReadOnly: true };
  for (const cached of [false, true]) {
    const maps = cached ? {
      coreAttrMap: new Map(extended ? [] : [['records', records]]),
      extensionSchemaMap: new Map(extended ? [[extension, schemas[0]]] : []),
    } : undefined;
    it.each(cases)(`PUT $name cached=${cached}`, ({ before, after, indices }) => {
      const stored = before.map((entry, i) => ({ ...entry, server: `server-${i}`, fixed: `fixed-${i}` }));
      const candidate = wrap(structuredClone(after));
      const snapshot = wrap(structuredClone(stored));
      SchemaValidator.prepareReplacement(snapshot, candidate, schemas);
      expect(unwrap(candidate)).toEqual(after.map((entry, i) => indices[i] === undefined ? entry : {
        ...entry, server: `server-${indices[i]}`, fixed: `fixed-${indices[i]}`,
      }));
      expect(SchemaValidator.checkImmutable(snapshot, candidate, schemas, maps, 'replace')).toEqual({ valid: true, errors: [] });
      expect(snapshot).toEqual(wrap(stored));
    });
    it('rejects explicit immutable changes to anonymous entries and nested array entries', () => {
      const nested = attr('outer', { type: 'complex', multiValued: true, subAttributes: [attr('value'), records] });
      const defs: SchemaDefinition[] = [{ id: core, attributes: [nested, records] }];
      for (const name of ['records', 'outer']) {
        const before = name === 'records' ? { records: [{ fixed: 'old' }] }
          : { outer: [{ value: 'parent', records: [{ value: 'child', fixed: 'old' }] }] };
        const after = JSON.parse(JSON.stringify(before).replace('"old"', '"new"')) as Record<string, unknown>;
        const prebuilt = cached ? { coreAttrMap: new Map(defs[0].attributes.map(a => [a.name, a])),
          extensionSchemaMap: new Map<string, SchemaDefinition>() } : undefined;
        expect(SchemaValidator.checkImmutable(before, after, defs, prebuilt, 'replace').errors)
          .toEqual([expect.objectContaining({ scimType: 'mutability' })]);
      }
    });
  }
  it.each(cases)('PATCH $name', ({ name, before, after, indices }) => {
    const stored = before.map((entry, i) => ({ ...entry, server: `server-${i}`, fixed: `fixed-${i}` }));
    const supplied = after.map((entry, i) => indices[i] === undefined ? entry : { ...entry, fixed: `fixed-${indices[i]}` });
    const executor = new PatchExecutor(wrap(stored), options);
    if (name === 'absent and null value are separate buckets') {
      // PATCH unassigns explicit null. Losing that discriminator cannot justify
      // silently reassigning immutable state; the operation must stay atomic.
      expect(() => executor.apply({ op: 'replace', path: `${extended ? `${extension}:` : ''}records`, value: supplied }))
        .toThrow('immutable');
      expect(executor.getResult()).toEqual(wrap(stored));
      return;
    }
    executor.apply({ op: 'replace', path: `${extended ? `${extension}:` : ''}records`, value: supplied });
    expect(unwrap(executor.getResult())).toEqual(supplied.map((entry, i) => ({
      ...Object.fromEntries(Object.entries(entry).map(([key, value]) => [key.toLowerCase(), value])),
      ...(indices[i] === undefined ? {} : { server: `server-${indices[i]}` }),
    })));
  });
  it('retains nested arrays without appending on PUT and PATCH replace', () => {
    const outer = attr('outer', { type: 'complex', multiValued: true, subAttributes: [attr('value'), records] });
    const defs = [{ id: core, attributes: [outer] }];
    const before = { outer: [{ value: 'parent', records: [
      { ...same('work'), server: 'work', fixed: 'work' }, { ...same('home'), server: 'home', fixed: 'home' },
    ] }] };
    const after = { outer: [{ value: 'parent', records: [same('home'), same('work')] }] };
    SchemaValidator.prepareReplacement(before, after, defs);
    expect(after.outer[0].records).toEqual([...before.outer[0].records].reverse());
    expect(SchemaValidator.checkImmutable(before, after, defs, undefined, 'replace').valid).toBe(true);
    const executor = new PatchExecutor(before, { schemaDefinitions: defs });
    executor.apply({ op: 'replace', path: 'outer', value: [{ value: 'parent', records: [
      { ...same('home'), fixed: 'home' }, { ...same('work'), fixed: 'work' },
    ] }] });
    expect(executor.getResult()).toEqual(after);
  });
  it('PATCH add remains new-entry intent, not PUT retention', () => {
    const executor = new PatchExecutor(wrap([{ ...same('work'), server: 'owned' }]), options);
    executor.apply({ op: 'add', path: `${extended ? `${extension}:` : ''}records`, value: same('work') });
    expect(unwrap(executor.getResult())).toEqual([{ ...same('work'), server: 'owned' }, same('work')]);
  });
  it.each(['readOnly', 'immutable'] as const)('restoring %s type cannot change the preservation pairing', mutability => {
    const definition = { ...records, subAttributes: records.subAttributes!.map(def =>
      def.name === 'type' ? { ...def, mutability } : def) };
    const defs = [{ id: extended ? extension : core, attributes: [definition] }];
    const before = wrap([
      { ...same('work'), fixed: 'A', server: 'A' }, { ...same('work'), fixed: 'B', server: 'B' },
    ]);
    const after = wrap([same(), same('work')]);
    SchemaValidator.prepareReplacement(before, after, defs);
    expect(unwrap(after).map(entry => entry.fixed)).toEqual(['A', 'B']);
    for (const cached of [false, true]) {
      const maps = cached ? { coreAttrMap: new Map(extended ? [] : [['records', definition]]),
        extensionSchemaMap: new Map(extended ? [[extension, defs[0]]] : []) } : undefined;
      expect(SchemaValidator.checkImmutable(before, after, defs, maps, 'replace')).toEqual({ valid: true, errors: [] });
    }
  });
  it('treats null and absent immutable types as unassigned across first assignment and restoration', () => {
    const definition = { ...records, subAttributes: records.subAttributes!.map(def =>
      def.name === 'type' ? { ...def, mutability: 'immutable' as const } : def) };
    const defs = [{ id: extended ? extension : core, attributes: [definition] }];
    const before = wrap([
      { value: 'same', type: null, fixed: 'A' }, { value: 'same', fixed: 'B' },
      { value: 'same', type: null, fixed: 'C' },
    ]);
    const after = wrap([same('work'), same(), same()]);
    SchemaValidator.prepareReplacement(before, after, defs);
    expect(unwrap(after)).toEqual([
      { ...same('work'), fixed: 'A' }, { ...same(), fixed: 'B' }, { ...same(), type: null, fixed: 'C' },
    ]);
    for (const cached of [false, true]) {
      const maps = cached ? { coreAttrMap: new Map(extended ? [] : [['records', definition]]),
        extensionSchemaMap: new Map(extended ? [[extension, defs[0]]] : []) } : undefined;
      expect(SchemaValidator.checkImmutable(before, after, defs, maps, 'replace')).toEqual({ valid: true, errors: [] });
    }
    const executor = new PatchExecutor(before, { ...options, schemaDefinitions: defs });
    executor.apply({ op: 'replace', path: `${extended ? `${extension}:` : ''}records`,
      value: [{ ...same('work'), fixed: 'A' }, { ...same(), fixed: 'B' }, { ...same(), fixed: 'C' }] });
    expect(unwrap(executor.getResult()).map(entry => entry.fixed)).toEqual(['A', 'B', 'C']);
  });
});
