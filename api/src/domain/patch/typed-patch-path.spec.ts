import { UserPatchEngine } from './user-patch-engine';
import { GroupPatchEngine } from './group-patch-engine';
import { GenericPatchEngine } from './generic-patch-engine';
import { PatchError } from './patch-error';
import type { PatchOperation } from './patch-types';
import { CONTOSO, GOOGLE, incidentPayload, incidentExpected, incidentOperations } from '../../../test/e2e/helpers/typed-patch-fixtures';

const config = { verbosePatch: true, extensionUrns: [GOOGLE, CONTOSO] };
const adapters = {
  User: (payload: Record<string, unknown>, operations: PatchOperation[]) =>
    UserPatchEngine.apply(operations, {
      userName: 'synthetic', displayName: null, externalId: null, active: true, rawPayload: payload,
    }, config).payload,
  Group: (payload: Record<string, unknown>, operations: PatchOperation[]) =>
    GroupPatchEngine.apply(operations, {
      displayName: 'synthetic', externalId: null, members: [], rawPayload: payload,
    }, { ...config, allowMultiMemberAdd: true, allowMultiMemberRemove: true, allowRemoveAllMembers: true }).payload,
  Device: (payload: Record<string, unknown>, operations: PatchOperation[]) => {
    const engine = new GenericPatchEngine(payload, config.extensionUrns);
    operations.forEach(op => engine.apply(op));
    return engine.getResult();
  },
};

describe.each(Object.entries(adapters))('P1 typed PATCH %s', (_name, apply) => {
  it('applies the exact four-operation synthetic incident without a literal bracket key', () => {
    const payload = incidentPayload();
    expect(apply(payload, incidentOperations())).toEqual(incidentExpected());
    expect(payload).toEqual(incidentPayload());
  });

  it.each([
    'primary eq true',
    'primary eq "True"',
    'rank ge 1.25e1 and (type co "wor" or not (value pr))',
    'rank lt 13 and rank gt 12 and rank le 12.5',
    'code ne "other" and value pr',
    'type sw "wo" and type ew "rk"',
    'missing eq null',
    'type eq "w\\u006frk"',
    'value eq "old\\\"quoted]value"',
  ])('evaluates %s using typed filter semantics', predicate => {
    const contacts = [{ primary: true, rank: 12.5, type: 'work', code: 'ABC', value: 'old"quoted]value' }];
    const result = apply({ [CONTOSO]: { contacts } }, [
      { op: 'replace', path: `${CONTOSO.toUpperCase()}:CONTACTS[${predicate}].VALUE`, value: 'new' },
    ]);
    expect(result).toEqual({ [CONTOSO]: { contacts: [{ ...contacts[0], value: 'new' }] } });
  });

  it.each([
    'contacts[primary eq true', 'contacts[primary eq true]]',
    'contacts[primary xx true].value', 'contacts[rank eq 1.2.3].value',
    'contacts[type eq "\\q"].value', 'contacts[primary eq true].',
    'contacts[primary eq true].value.deep',
    'contacts[primary eq true][type eq "work"]', 'contacts[nested[value eq "x"]].value',
  ])('rejects malformed/unsupported syntax %s before writing', path => {
    const input = incidentPayload();
    expect(() => apply(input, [
      { op: 'replace', path: `${GOOGLE}:primaryOrganization.location`, value: 'must-not-persist' },
      { op: 'replace', path: `${CONTOSO}:${path}`, value: 'bad' },
    ])).toThrow(PatchError);
    expect(input).toEqual(incidentPayload());
  });

  it('selects against the state produced by the preceding operation', () => {
    const result = apply({ [CONTOSO]: { contacts: [] } }, [
      { op: 'replace', path: `${CONTOSO}:contacts`, value: [{ primary: true, value: 'new-entry' }] },
      { op: 'replace', path: `${CONTOSO}:contacts[primary eq true].value`, value: 'selected' },
    ]);
    expect(result).toEqual({ [CONTOSO]: { contacts: [{ primary: true, value: 'selected' }] } });
  });
});
