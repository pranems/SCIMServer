import { assertUnique, compileEffectiveUniquenessPolicy } from './uniqueness-policy';
import { bindingUniquenessProfile, SHARED_UNIQUE_SCHEMA } from '../../../test/helpers/binding-uniqueness.fixture';

describe('binding-qualified common uniqueness', () => {
  it('compiles normative common fields without changing the independent extension promise', () => {
    const shared = bindingUniquenessProfile().schemas[0];
    const before = structuredClone(shared);
    const core = compileEffectiveUniquenessPolicy([{ ...shared, isCoreSchema: true }]);
    expect(core).toEqual([
      { schemaUrn: null, path: [{ name: 'id', multiValued: false }], type: 'string', caseExact: true },
      { schemaUrn: null, path: [{ name: 'externalId', multiValued: false }], type: 'string', caseExact: true },
      { schemaUrn: null, path: [{ name: 'displayName', multiValued: true }], type: 'integer', caseExact: false },
    ]);
    expect(() => assertUnique(core, { id: 'b', externalId: 'Case' }, [{ id: 'a', externalId: 'case' }])).not.toThrow();
    expect(() => assertUnique(core, { id: 'b', externalId: 'Case' }, [{ id: 'a', externalId: 'Case' }])).toThrow('already owned');
    const extension = compileEffectiveUniquenessPolicy([{ ...shared, isCoreSchema: false }]);
    expect(extension.map(attribute => [attribute.schemaUrn, attribute.path[0].name, attribute.type, attribute.path[0].multiValued]))
      .toEqual([
        [SHARED_UNIQUE_SCHEMA, 'id', 'integer', true],
        [SHARED_UNIQUE_SCHEMA, 'externalId', 'integer', true],
        [SHARED_UNIQUE_SCHEMA, 'meta', 'string', false],
        [SHARED_UNIQUE_SCHEMA, 'displayName', 'integer', true],
      ]);
    for (const [name, value] of Object.entries({ id: [7], externalId: [11], meta: 'Owned', displayName: [13] })) {
      expect(() => assertUnique(extension, { [shared.id]: { [name]: value } }, [{ [shared.id]: { [name]: value } }]))
        .toThrow('already owned');
    }
    expect(shared).toEqual(before);
  });
});
