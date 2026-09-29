import { UserPatchEngine } from './user-patch-engine';
import { GroupPatchEngine } from './group-patch-engine';
import { GenericPatchEngine } from './generic-patch-engine';
import { SchemaValidator } from '../validation/schema-validator';
import type { SchemaDefinition, SchemaAttributeDefinition } from '../validation/validation-types';
import type { PatchOperation } from './patch-types';

const EXT = 'urn:example:scim:schemas:extension:2.0:Ordered';
type AttributeInput = Omit<Partial<SchemaAttributeDefinition>, 'subAttributes'> & {
  name: string; type: string; subAttributes?: AttributeInput[];
};
const attributes = (items: AttributeInput[]): SchemaAttributeDefinition[] => items.map(item => ({
  multiValued: false, required: false, ...item,
  subAttributes: item.subAttributes && attributes(item.subAttributes),
}));
const definitions: SchemaDefinition[] = [{
  id: EXT,
  attributes: attributes([
    { name: 'tags', type: 'string', multiValued: true },
    { name: 'requiredValue', type: 'string', required: true },
    { name: 'identity', type: 'string', mutability: 'immutable' },
    { name: 'readOnlyValue', type: 'string', mutability: 'readOnly' },
    { name: 'fixedRecord', type: 'complex', mutability: 'immutable', subAttributes: [
      { name: 'value', type: 'string' }, { name: 'type', type: 'string' },
    ] },
    { name: 'record', type: 'complex', subAttributes: [
      { name: 'tags', type: 'string', multiValued: true },
      { name: 'serverTags', type: 'string', multiValued: true, mutability: 'readOnly' },
      { name: 'label', type: 'string' },
      { name: 'identity', type: 'string', mutability: 'immutable' },
    ] },
    { name: 'contacts', type: 'complex', multiValued: true, subAttributes: [
      { name: 'type', type: 'string' }, { name: 'value', type: 'string', required: true },
      { name: 'primary', type: 'boolean' }, { name: 'tags', type: 'string', multiValued: true },
      { name: 'identity', type: 'string', mutability: 'immutable' },
      { name: 'server', type: 'string', mutability: 'readOnly' },
    ] },
  ]),
}];
const samples: [string, unknown, unknown][] = [
  ['string', 'before', 'after'], ['boolean', false, true], ['integer', 2, 3],
  ['decimal', 2.5, 3.5], ['dateTime', '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z'],
  ['reference', 'https://example.test/one', 'https://example.test/two'],
  ['binary', 'YWJj', 'ZGVm'], ['complex', { label: 'before' }, { label: 'after' }],
];
definitions[0].attributes = [...definitions[0].attributes, ...samples.flatMap(([type]) => [false, true].map(multiValued => ({
  name: `${type}${multiValued ? 'List' : 'Single'}`, type, multiValued, required: false,
  ...(type === 'complex' ? { subAttributes: attributes([{ name: 'label', type: 'string' }]) } : {}),
})))];
const options = { schemaDefinitions: definitions, strictSchema: true };
const config = { ...options, verbosePatch: true, extensionUrns: [EXT] };
const adapters = {
  User: (payload: Record<string, unknown>, ops: PatchOperation[]) => UserPatchEngine.apply(ops, {
    userName: 'synthetic', displayName: null, externalId: null, active: true, rawPayload: payload,
  }, config).payload,
  Group: (payload: Record<string, unknown>, ops: PatchOperation[]) => GroupPatchEngine.apply(ops, {
    displayName: 'synthetic', externalId: null, members: [], rawPayload: payload,
  }, { ...config, allowMultiMemberAdd: true, allowMultiMemberRemove: true, allowRemoveAllMembers: true }).payload,
  Custom: (payload: Record<string, unknown>, ops: PatchOperation[]) => {
    const engine: GenericPatchEngine = Reflect.construct(GenericPatchEngine, [payload, [EXT], undefined, undefined, options]);
    ops.forEach(op => engine.apply(op));
    return engine.getResult();
  },
};
const base = () => ({
  [EXT]: {
    requiredValue: 'required', tags: ['a'],
    record: { tags: ['a'], label: 'keep', identity: 'fixed' },
    contacts: [
      { type: 'work', value: 'one', primary: true, tags: ['a'], identity: 'first' },
      { type: 'work', value: 'two', primary: false, tags: ['b'], identity: 'second' },
    ],
  },
});

describe.each(Object.entries(adapters))('P2 ordered %s', (_family, apply) => {
  it('does not append projected readOnly values when adding a writable sibling', () => {
    const input = { [EXT]: { ...base()[EXT], record: { ...base()[EXT].record, serverTags: ['server'] } } };
    const result = apply(input, [
      { op: 'add', path: `${EXT}:record`, value: { label: 'new' } },
      { op: 'add', path: `${EXT}:record`, value: { label: 'newer' } },
    ]);
    expect((result[EXT] as { record: { serverTags: string[] } }).record.serverTags).toEqual(['server']);
  });
  it.each(samples.flatMap(([type, first, second]) => [false, true].map(multi => [type, multi, first, second] as const)))(
    'preserves %s values and cardinality multi=%s', (type, multi, first, second) => {
      const name = `${type}${multi ? 'List' : 'Single'}`;
      const result = apply(base(), [
        { op: 'add', path: `${EXT}:${name}`, value: multi ? [first] : first },
        { op: 'add', path: `${EXT}:${name}`, value: second },
      ]);
      expect((result[EXT] as Record<string, unknown>)[name]).toEqual(multi ? [first, second] : second);
    },
  );
  it.each([
    { op: 'add', path: `${EXT}:tags`, value: ['b'] },
    { op: 'add', path: `${EXT}:tags`, value: 'b' },
    { op: 'add', value: { [EXT]: { tags: ['b'] } } },
    { op: 'add', value: { [`${EXT}:tags`]: ['b'] } },
  ])('appends multi-valued add %j', operation => {
    const input = base();
    expect(apply(input, [operation])[EXT]).toMatchObject({ tags: ['a', 'b'] });
    expect(input).toEqual(base());
  });
  it('merges complex add and appends multi-valued children', () => {
    expect(apply(base(), [{ op: 'add', path: `${EXT}:record`, value: { tags: ['b'] } }])[EXT])
      .toMatchObject({ record: { tags: ['a', 'b'], label: 'keep', identity: 'fixed' } });
  });
  it('replaces ALL selected sub-attributes', () => {
    const result = apply(base(), [{ op: 'replace', path: `${EXT}:contacts[type eq "work"].value`, value: 'changed' }]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts.map(c => c.value)).toEqual(['changed', 'changed']);
  });
  it('accepts a selected object and preserves unspecified children', () => {
    const result = apply(base(), [{ op: 'replace', path: `${EXT}:contacts[type eq "work"]`, value: { value: 'changed' } }]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts).toEqual(
      base()[EXT].contacts.map(c => ({ ...c, value: 'changed' })),
    );
  });
  it('appends to every selected multi-valued child', () => {
    const result = apply(base(), [{ op: 'add', path: `${EXT}:contacts[type eq "work"].tags`, value: ['c'] }]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts.map(c => c.tags)).toEqual([['a', 'c'], ['b', 'c']]);
  });
  it('removes optional children on ALL matches without deleting their parents', () => {
    const result = apply(base(), [{ op: 'remove', path: `${EXT}:contacts[type eq "work"].tags` }]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts).toEqual(
      base()[EXT].contacts.map(({ tags: _tags, ...contact }) => contact),
    );
  });
  it.each([
    [{ op: 'remove', path: `${EXT}:requiredValue` }, { op: 'add', path: `${EXT}:requiredValue`, value: 'repaired' }],
    [{ op: 'add', path: `${EXT}:identity`, value: 'first' }, { op: 'replace', path: `${EXT}:identity`, value: 'second' }],
    [{ op: 'remove', path: `${EXT}:record.identity` }],
    [{ op: 'remove', path: `${EXT}:record` }],
    [{ op: 'remove', path: `${EXT}:contacts[type eq "work"].value` }],
    [{ op: 'replace', path: `${EXT}:contacts[type eq "work"]`, value: 'not-an-object' }],
    [{ op: 'replace', path: `${EXT}:missing[type eq "work"].value`, value: 'bad' }],
  ])('rejects invalid transition atomically %j', (...ops) => {
    const input = base();
    expect(() => apply(input, ops)).toThrow();
    expect(input).toEqual(base());
  });
  it('hands primary off before the next selector is evaluated', () => {
    const result = apply(base(), [
      { op: 'replace', path: `${EXT}:contacts[value eq "two"].primary`, value: true },
      { op: 'replace', path: `${EXT}:contacts[primary eq true].value`, value: 'selected' },
    ]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts.map(c => [c.value, c.primary]))
      .toEqual([['one', false], ['selected', true]]);
  });
  it('rejects a second assignment to an immutable child through whole-list replacement', () => {
    const input = { [EXT]: { ...base()[EXT], contacts: [{ type: 'work', value: 'one', primary: true, tags: [] }] } };
    expect(() => apply(input, [
      { op: 'replace', path: `${EXT}:contacts`, value: [{ value: 'one', identity: 'first' }] },
      { op: 'replace', path: `${EXT}:contacts`, value: [{ value: 'one', identity: 'second' }] },
    ])).toThrow('immutable');
  });
  it('allows identical immutable complex values despite property order', () => {
    const input = { ...base(), [EXT]: { ...base()[EXT], fixedRecord: { value: 'same', type: 'work' } } };
    expect(apply(input, [{ op: 'replace', path: `${EXT}:fixedRecord.value`, value: 'same' }])[EXT])
      .toMatchObject({ fixedRecord: { value: 'same', type: 'work' } });
  });
  it('accepts a single element at a selected multi-valued child', () => {
    expect((apply(base(), [{ op: 'add', path: `${EXT}:contacts[type eq "work"].tags`, value: 'c' }])[EXT] as ReturnType<typeof base>[typeof EXT])
      .contacts.map(c => c.tags)).toEqual([['a', 'c'], ['b', 'c']]);
  });
  it('preserves readOnly descendants of retained entries on whole-list replacement', () => {
    const input = { [EXT]: { ...base()[EXT], contacts: [{ value: 'one', server: 'keep' }] } };
    expect((apply(input, [{ op: 'replace', path: `${EXT}:contacts`, value: [{ value: 'one' }] }])[EXT] as Record<string, unknown>).contacts)
      .toEqual([{ value: 'one', server: 'keep' }]);
  });
  it.each([false, true])('retains distinct readOnly values for duplicate identities, reordered=%s', reordered => {
    const before = [
      { value: 'same', type: 'home', server: 'server-home' },
      { value: 'same', type: 'work', server: 'server-work' },
    ];
    const expected = reordered ? [...before].reverse() : before;
    const result = apply({ [EXT]: { ...base()[EXT], contacts: before } }, [
      { op: 'replace', path: `${EXT}:contacts`, value: expected.map(({ value, type }) => ({ value, type })) },
    ]);
    expect((result[EXT] as Record<string, unknown>).contacts).toEqual(expected);
  });
  it('constructs appended complex entries with real multi-valued child cardinality', () => {
    const result = apply(base(), [
      { op: 'add', path: `${EXT}:contacts`, value: { value: 'three', tags: 'b' } },
      { op: 'add', path: `${EXT}:contacts[value eq "three"].tags`, value: 'c' },
    ]);
    expect((result[EXT] as ReturnType<typeof base>[typeof EXT]).contacts[2].tags).toEqual(['b', 'c']);
  });
});

it('P2 validates a selected complex object rather than the containing array', () => {
  expect(SchemaValidator.validatePatchOperationValue(
    'replace', `${EXT}:contacts[type eq "work"]`, { value: 'changed' }, definitions,
  )).toEqual({ valid: true, errors: [] });
});

it('P2 no-path single-element add validates target cardinality', () => {
  expect(SchemaValidator.validatePatchOperationValue(
    'add', undefined, { [EXT]: { tags: 'b' } }, definitions,
  )).toEqual({ valid: true, errors: [] });
});
it('P2 retains Group selected-member singleton-array compatibility', () => {
  expect(SchemaValidator.validatePatchOperationValue('replace', 'members[value eq "one"]', [{ value: 'one' }], [{
    id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
    attributes: attributes([{ name: 'members', type: 'complex', multiValued: true, subAttributes: [{ name: 'value', type: 'string' }] }]),
  }])).toEqual({ valid: true, errors: [] });
});

it('P2 Group hooks cannot turn a scalar selector into an unconditional write', () => {
  expect(() => GroupPatchEngine.apply([{ op: 'replace', path: 'externalId[value eq "missing"]', value: 'changed' }], {
    displayName: 'group', externalId: 'original', rawPayload: {}, members: [],
  }, { ...config, allowMultiMemberAdd: true, allowMultiMemberRemove: true, allowRemoveAllMembers: true })).toThrow();
});

it('P2 equality synthesis participates in primary handoff', () => {
  const result = UserPatchEngine.apply([
    { op: 'add', path: 'emails[type eq "new"].primary', value: true },
    { op: 'replace', path: 'emails[primary eq true].value', value: 'selected' },
  ], {
    userName: 'user', displayName: null, externalId: null, active: true,
    rawPayload: { emails: [{ type: 'old', value: 'old', primary: true }] },
  }, { verbosePatch: true });
  expect(result.payload.emails).toEqual([
    { type: 'old', value: 'old', primary: false }, { type: 'new', value: 'selected', primary: true },
  ]);
});

it.each([true, false])('P2 synthesized entries obey readOnly descendant policy strict=%s', strictSchema => {
  const schemaDefinitions: SchemaDefinition[] = [{
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    attributes: attributes([{ name: 'emails', type: 'complex', multiValued: true, subAttributes: [
      { name: 'value', type: 'string' }, { name: 'type', type: 'string' },
      { name: 'server', type: 'string', mutability: 'readOnly' },
    ] }]),
  }];
  const run = () => UserPatchEngine.apply([
    { op: 'add', path: 'emails[type eq "work"]', value: { value: 'new', server: 'client' } },
  ], { userName: 'user', active: true, displayName: null, externalId: null, rawPayload: { emails: [] } },
  { verbosePatch: true, schemaDefinitions, strictSchema });
  if (strictSchema) expect(run).toThrow('readOnly');
  else expect(run().payload.emails).toEqual([{ type: 'work', value: 'new' }]);
});

it('P2 manager shorthand never turns remove into an assignment', () => {
  const urn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
  const result = UserPatchEngine.apply([{ op: 'remove', path: `${urn}:manager`, value: 'new-manager' }], {
    userName: 'user', displayName: null, externalId: null, active: true,
    rawPayload: { [urn]: { manager: { value: 'old-manager' }, department: 'keep' } },
  }, { verbosePatch: true });
  expect(result.payload[urn]).toEqual({ department: 'keep' });
});
it('P2 manager shorthand applies to expanded no-path keys as well as direct paths', () => {
  const urn = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
  const result = UserPatchEngine.apply([{ op: 'add', value: { [`${urn}:manager`]: 'manager' } }], {
    userName: 'user', displayName: null, externalId: null, active: true, rawPayload: {},
  }, { verbosePatch: true });
  expect(result.payload[urn]).toEqual({ manager: { value: 'manager' } });
});
it('P2 pairs anonymous retained entries one-to-one instead of copying the first server value', () => {
  const engine = new GenericPatchEngine({ [EXT]: { contacts: [{ server: 'first' }, { server: 'second' }] } }, [EXT], undefined, undefined, {
    schemaDefinitions: [{ id: EXT, attributes: attributes([{ name: 'contacts', type: 'complex', multiValued: true, subAttributes: [
      { name: 'label', type: 'string' }, { name: 'server', type: 'string', mutability: 'readOnly' },
    ] }]) }],
    strictSchema: true,
  });

  engine.apply({ op: 'replace', path: `${EXT}:contacts`, value: [{ label: 'one' }, { label: 'two' }] });
  expect(engine.getResult()[EXT]).toEqual({ contacts: [{ server: 'first', label: 'one' }, { server: 'second', label: 'two' }] });
});

describe('P2 recursive readOnly operation policy', () => {
    const list = attributes([{ name: 'contacts', type: 'complex', multiValued: true, subAttributes: [
      { name: 'value', type: 'string' }, { name: 'server', type: 'string', mutability: 'readOnly' },
    ] }])[0];
    const make = (strictSchema = true, ignoreReadOnly?: boolean) => new GenericPatchEngine({
      [EXT]: { contacts: [{ value: 'same', server: 'keep' }], record: { contacts: [{ value: 'same', server: 'keep' }] } },
    }, [EXT], undefined, undefined, { strictSchema, ignoreReadOnly, schemaDefinitions: [{
      id: EXT, attributes: [list, { name: 'record', type: 'complex', required: false, multiValued: false,
        subAttributes: [list, ...attributes([{ name: 'label', type: 'string' }])] }],
    }] });
    it('treats add null as unassignment before considering append', () => {
      const engine = make();
      expect(() => engine.apply({ op: 'add', path: `${EXT}:contacts`, value: null })).toThrow('readOnly');
      expect((engine.getResult()[EXT] as Record<string, unknown>).contacts).toEqual([{ value: 'same', server: 'keep' }]);
    });
    it.each([false, true])('never borrows server fields for new children, parent-target=%s', parent => {
      const engine = make();
      engine.apply({
        op: 'add', path: `${EXT}:record${parent ? '' : '.contacts'}`,
        value: parent ? { contacts: [{ value: 'same' }] } : [{ value: 'same' }],
      });
      expect((engine.getResult()[EXT] as { record: { contacts: unknown[] } }).record.contacts)
        .toEqual([{ value: 'same', server: 'keep' }, { value: 'same' }]);
    });
    it.each([true, false])('nested add null retains unassignment intent when ignoring readOnly, strict=%s', strict => {
      const engine = make(strict, true);
      engine.apply({ op: 'add', path: `${EXT}:record`, value: { contacts: null } });
      expect((engine.getResult()[EXT] as { record: { contacts: unknown[] } }).record.contacts).toEqual([{ server: 'keep' }]);
    });
    it('does not duplicate an omitted server-owned collection on sibling add', () => {
      const engine = make();
      engine.apply({ op: 'add', path: `${EXT}:record`, value: { label: 'new' } });
      engine.apply({ op: 'add', path: `${EXT}:record`, value: { label: 'newer' } });
      expect((engine.getResult()[EXT] as { record: { contacts: unknown[] } }).record.contacts)
        .toEqual([{ value: 'same', server: 'keep' }]);
    });
});

it.each([false, true])('P2 resolves qualified no-path readOnly writes under ignore=%s', ignoreReadOnly => {
  const engine: GenericPatchEngine = Reflect.construct(GenericPatchEngine, [
    { [EXT]: { requiredValue: 'required', readOnlyValue: 'server' } }, [EXT], undefined, undefined,
    { ...options, strictSchema: !ignoreReadOnly, ignoreReadOnly },
  ]);
  const operation = { op: 'replace', value: { [`${EXT}:readOnlyValue`]: 'client' } };
  if (ignoreReadOnly) {
    engine.apply(operation);
    expect(engine.getResult()[EXT]).toMatchObject({ readOnlyValue: 'server' });
  } else expect(() => engine.apply(operation)).toThrow('readOnly');
});

it('P2 retains omitted nested server-owned collections in retained replacement entries', () => {
  const before = { items: [{ value: 'same', record: { children: [{ value: 'child', server: 'keep' }] } }] };
  const schemaDefinitions: SchemaDefinition[] = [{ id: EXT, attributes: attributes([
    { name: 'items', type: 'complex', multiValued: true, subAttributes: [
      { name: 'value', type: 'string' },
      { name: 'record', type: 'complex', subAttributes: [
        { name: 'children', type: 'complex', multiValued: true, subAttributes: [
          { name: 'value', type: 'string' }, { name: 'server', type: 'string', mutability: 'readOnly' },
        ] },
      ] },
    ] },
  ]) }];
  const engine = new GenericPatchEngine({ [EXT]: before }, [EXT], undefined, undefined, { schemaDefinitions, strictSchema: true });
  engine.apply({ op: 'replace', path: `${EXT}:items`, value: [{ value: 'same' }] });
  expect(engine.getResult()[EXT]).toEqual(before);
});

it.each([false, true])('P2 namespace removal respects assigned readOnly descendants under ignore=%s', ignoreReadOnly => {
  const engine: GenericPatchEngine = Reflect.construct(GenericPatchEngine, [
    { [EXT]: { readOnlyValue: 'server', tags: ['remove'] } }, [EXT], undefined, undefined,
    { schemaDefinitions: [{ ...definitions[0], attributes: definitions[0].attributes.filter(a => !a.required) }], strictSchema: true, ignoreReadOnly },
  ]);
  const operation = { op: 'replace', value: { [EXT]: null } };
  if (ignoreReadOnly) {
    engine.apply(operation);
    expect(engine.getResult()[EXT]).toEqual({ readOnlyValue: 'server' });
  } else expect(() => engine.apply(operation)).toThrow('readOnly');
});
