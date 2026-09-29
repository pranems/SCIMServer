import { SchemaValidator } from '../../../domain/validation/schema-validator';
import type { SchemaAttributeDefinition, SchemaDefinition } from '../../../domain/validation/validation-types';
import { stripReadOnlyAttributes, stripReadOnlyPatchOps } from './scim-service-helpers';

const core = 'urn:example:core:2.0:Widget';
const ext = 'urn:example:extension:2.0:Widget';
const other = 'urn:example:extension:2.0:Other';
const attr = (name: string, extra: Partial<SchemaAttributeDefinition> = {}): SchemaAttributeDefinition =>
  ({ name, type: 'string', required: false, multiValued: false, ...extra });

describe('P7 recursive readOnly stripping', () => {
  it.each([true, false])('strips readOnly before strict namespace prevalidation, explicit=%s', explicit => {
    const numeric = 'urn:example:extension:2.0';
    const schemas: SchemaDefinition[] = [{ id: core, isCoreSchema: true, attributes: [] },
      { id: numeric, isCoreSchema: false, attributes: [attr('locked', { mutability: 'readOnly' }), attr('open')] }];
    const operation = explicit
      ? { op: 'replace', path: numeric, value: { locked: 7, open: 'kept' } }
      : { op: 'replace', value: { [`${numeric}:locked`]: 7, [`${numeric}:open`]: 'kept' } };
    const result = stripReadOnlyPatchOps([operation], schemas);
    expect(result.stripped).toHaveLength(1);
    expect(result.filtered).toEqual([explicit
      ? { op: 'replace', path: numeric, value: { open: 'kept' } }
      : { op: 'replace', value: { [`${numeric}:open`]: 'kept' } }]);
  });
  for (const outerMany of [false, true]) {
    for (const innerMany of [false, true]) {
      it.each([false, true])(`strips deep children: outerMany=${outerMany}, innerMany=${innerMany}, cache=%s`, cached => {
        const attrs = [attr('outer', { type: 'complex', multiValued: outerMany, subAttributes: [
          attr('inner', { type: 'complex', multiValued: innerMany, subAttributes: [
            attr('locked', { mutability: 'readOnly' }), attr('open'),
            attr('branch', { type: 'complex', mutability: 'readOnly', subAttributes: [attr('value')] }),
          ] }),
        ] })];
        const schemas: SchemaDefinition[] = [
          { id: core, isCoreSchema: true, attributes: attrs },
          { id: ext, attributes: attrs },
          { id: other, attributes: [] },
        ];
        const leaf = { LOCKED: { invalid: true }, open: 'keep', branch: 'ignored' };
        const expectedLeaf = { open: 'keep' };
        const wrap = (value: unknown) => {
          const outer = { INNER: innerMany ? [structuredClone(value), structuredClone(value)] : structuredClone(value) };
          return { OUTER: outerMany ? [structuredClone(outer), structuredClone(outer)] : outer };
        };
        const payload = { schemas: [core, ext, other], ...wrap(leaf), [ext]: wrap(leaf),
          [other]: wrap(leaf), locked: 'unrelated' };
        const expected = { schemas: [core, ext, other], ...wrap(expectedLeaf), [ext]: wrap(expectedLeaf),
          [other]: wrap(leaf), locked: 'unrelated' };
        const maps = cached ? SchemaValidator.buildCharacteristicsCache(schemas).readOnlyCollected : undefined;
        const removed = stripReadOnlyAttributes(payload, schemas, maps);
        expect(payload).toEqual(expected);
        const path = `OUTER${outerMany ? '[]' : ''}.INNER${innerMany ? '[]' : ''}`;
        const copies = (outerMany ? 2 : 1) * (innerMany ? 2 : 1);
        expect(removed.filter(p => p === `${path}.LOCKED`)).toHaveLength(copies);
        expect(removed.filter(p => p === `${ext}.${path}.branch`)).toHaveLength(copies);
        expect(removed).toHaveLength(copies * 4);
      });
    }
  }

  it('does not interpret a literal dotted key as a nested object path', () => {
    const schemas: SchemaDefinition[] = [{ id: core, isCoreSchema: true, attributes: [
      attr('outer', { type: 'complex', subAttributes: [attr('inner', { type: 'complex',
        subAttributes: [attr('locked', { mutability: 'readOnly' })] })] }),
    ] }];
    const payload = { 'outer.inner': { locked: 'not an actual hierarchy' } };
    expect(stripReadOnlyAttributes(payload, schemas, SchemaValidator.buildCharacteristicsCache(schemas).readOnlyCollected)).toEqual([]);
    expect(payload).toEqual({ 'outer.inner': { locked: 'not an actual hierarchy' } });
  });

  it('preserves malformed writable values for validation rather than coercing them while stripping', () => {
    const schemas: SchemaDefinition[] = [{ id: core, isCoreSchema: true, attributes: [
      attr('outer', { type: 'complex', multiValued: true, subAttributes: [
        attr('inner', { type: 'complex', subAttributes: [attr('locked', { mutability: 'readOnly' })] }),
      ] }),
    ] }];
    const payload = { schemas: [core], outer: [null, 42, { inner: 'invalid' }, { inner: { locked: 'ignore' } }] };
    expect(stripReadOnlyAttributes(payload, schemas)).toEqual(['outer[].inner.locked']);
    expect(payload).toEqual({ schemas: [core], outer: [null, 42, { inner: 'invalid' }, { inner: {} }] });
  });
});
