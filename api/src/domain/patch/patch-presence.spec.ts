import { patchSuppliedPaths } from './patch-presence';
import { applyAttributeProjection } from '../../modules/scim/common/scim-attribute-projection';

const core = 'urn:example:core:2.0:Widget';
const ext = 'urn:example:extension:2.0';

describe('P7b PATCH supplied attribute presence', () => {
  it('uses exact parsed paths and never treats selector predicates as supplied values', () => {
    expect([...patchSuppliedPaths([
      { op: 'replace', path: `${ext}:items[type eq "work"].note`, value: 'new' },
      { op: 'replace', path: `${core}:requested`, value: '' },
      { op: 'remove', path: `${ext}:hidden` },
      { op: 'replace', path: 'unassigned', value: null },
    ], [ext], core)].sort()).toEqual([ext, `${ext}:items`, `${ext}:items.note`, 'requested'].sort());
  });
  it('records falsy values and supplied children, not omitted complex siblings', () => {
    const input = [{ op: 'add', value: { requested: false, [ext]: {
      count: 0, record: { note: '' }, items: [{ note: 'a' }, { type: 'work' }],
    } } }];
    expect(patchSuppliedPaths(input, [ext], core)).toEqual(new Set([
      'requested', ext, `${ext}:count`, `${ext}:record`, `${ext}:record.note`,
      `${ext}:items`, `${ext}:items.note`, `${ext}:items.type`,
    ]));
  });
  const resource = { schemas: [core, ext], id: 'id', requested: 'core',
    record: { note: 'core-child' }, [ext]: { requested: 'ext', record: { note: 'child', omitted: 'not-input' } } };
  const request = new Map([
    [core.toLowerCase(), new Set(['requested'])], [`${core.toLowerCase()}.record`, new Set(['note'])],
    [ext, new Set(['requested'])], [`${ext}.record`, new Set(['note', 'omitted'])],
  ]);
  const operations = [{ op: 'replace', path: ext, value: { requested: 'ext', record: { note: 'child' } } }];
  it('matches exact namespaced homonyms and suppresses unsupplied nested siblings', () => {
    expect(applyAttributeProjection(resource, undefined, undefined, undefined, request, undefined,
      patchSuppliedPaths(operations, [ext], core))).toEqual({ schemas: [core, ext], id: 'id',
      record: {}, [ext]: { requested: 'ext', record: { note: 'child' } } });
  });
  it('explicit attributes overrides implicit input presence', () => {
    expect(applyAttributeProjection(resource, 'requested', undefined, undefined, request, undefined,
      patchSuppliedPaths(operations, [ext], core))).toEqual({ schemas: [core, ext], id: 'id', requested: 'core' });
  });
  it('excludedAttributes still excludes supplied fields', () => {
    const result = applyAttributeProjection(resource, undefined, `${ext}:requested`, undefined, request, undefined,
      patchSuppliedPaths(operations, [ext], core));
    expect(result[ext]).toEqual({ record: { note: 'child' } });
    expect(resource[ext].requested).toBe('ext');
  });
});
