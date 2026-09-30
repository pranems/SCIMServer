import { parsePatchPath, matchesPatchSelection } from './patch-path';
import { SchemaValidator } from '../validation/schema-validator';
import { incidentSchemas, USER, CONTOSO } from '../../../test/e2e/helpers/typed-patch-fixtures';
import { computeTouchedPatchKeys } from '../../modules/scim/common/scim-service-helpers';
import { GenericPatchEngine } from './generic-patch-engine';
import { GroupPatchEngine } from './group-patch-engine';
import { PatchError } from './patch-error';

describe('P1 shared path consumers', () => {
  it('preserves bracket characters and colons in quoted strings when identifying the namespace', () => {
    const path = `${CONTOSO}:contacts[value eq "a]:b"].rank`;
    expect(parsePatchPath(path, [CONTOSO])).toMatchObject({
      schemaUrn: CONTOSO, attribute: 'contacts', subAttribute: 'rank',
      predicate: { type: 'compare', attrPath: 'value', value: 'a]:b' },
    });
    expect(computeTouchedPatchKeys([{ op: 'replace', path }], [CONTOSO])).toEqual(new Set([CONTOSO]));
    expect(SchemaValidator.validatePatchOperationValue('replace', path, 'not-a-number', incidentSchemas).valid).toBe(false);
  });

  it('validates core-qualified paths and the sub-attribute after a quoted closing bracket', () => {
    const schemas = [{ id: USER, attributes: [{
      name: 'emails', type: 'complex' as const, multiValued: true, required: false,
      subAttributes: [{ name: 'primary', type: 'boolean' as const, multiValued: false, required: false }],
    }] }];
    expect(SchemaValidator.validatePatchOperationValue('replace',
      `${USER}:emails[value eq "a]"].primary`, 'not-boolean', schemas).valid).toBe(false);
  });

  it('reports each extension validation error exactly once', () => {
    const result = SchemaValidator.validate({ [CONTOSO]: { unknown: 'bad' } }, incidentSchemas, { strictMode: true, mode: 'patch' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe(`${CONTOSO}.unknown`);
  });

  it('resolves caseExact per compound leaf and namespace', () => {
    const path = parsePatchPath(`${CONTOSO}:contacts[code eq "AbC" and type eq "WORK"].value`, [CONTOSO]);
    if (path.kind !== 'selection') throw new Error('Expected selector');
    const exact = new Set([`${CONTOSO}:contacts.code`.toLowerCase()]);
    expect(matchesPatchSelection(path, { code: 'AbC', type: 'work' }, exact)).toBe(true);
    expect(matchesPatchSelection(path, { code: 'abc', type: 'work' }, exact)).toBe(false);
    expect(matchesPatchSelection(path, { code: 'abc', type: 'work' }, new Set(['urn:other:contacts.code']))).toBe(true);
  });

  it('keeps string Boolean text distinct from native Boolean predicates', () => {
    const engine = new GenericPatchEngine({ contacts: [{ type: 'true', value: 'old' }] });
    expect(() => engine.apply({ op: 'replace', path: 'contacts[type eq true].value', value: 'bad' })).toThrow(PatchError);
    engine.apply({ op: 'replace', path: 'contacts[type eq "true"].value', value: 'good' });
    expect(engine.getResult()).toEqual({ contacts: [{ type: 'true', value: 'good' }] });
  });

  it('supports core Group member compound removal while preserving unselected members', () => {
    const result = GroupPatchEngine.apply([{ op: 'remove', path: 'MEMBERS[value sw "a" and display pr]' }], {
      displayName: 'g', externalId: null, rawPayload: {},
      members: [{ value: 'a-1', display: 'Alice' }, { value: 'b-1', display: 'Bob' }],
    }, { allowMultiMemberAdd: true, allowMultiMemberRemove: true, allowRemoveAllMembers: false });
    expect(result.members).toEqual([{ value: 'b-1', display: 'Bob' }]);
  });
});
