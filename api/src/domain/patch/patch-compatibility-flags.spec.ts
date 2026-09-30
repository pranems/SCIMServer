import { UserPatchEngine, type UserPatchState } from './user-patch-engine';
import { PatchError } from './patch-error';
import type { PatchOperation } from './patch-types';

const CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
const EXT = 'urn:example:extension:2.0:Flags';
const state = (): UserPatchState => ({
  userName: 'synthetic', displayName: 'Synthetic', externalId: null, active: true,
  rawPayload: {
    name: { givenName: 'Given', familyName: 'Before' },
    emails: [{ value: 'old@example.test', type: 'home', primary: true }],
    [EXT]: { name: { familyName: 'Extension' }, active: 'before' },
  },
});

describe('P2 flag contract follow-up', () => {
  it.each(['add', 'replace', 'remove'])('keeps exact numeric-version extension namespace %s independent of verbose', op => {
    const urn = 'urn:scimserver:devshapes:user:hr-extras:1.0';
    const input = { ...state(), rawPayload: { [urn]: { label: 'before' } } };
    const operation = { op, path: urn.toUpperCase(), ...(op === 'remove' ? {} : { value: { label: 'after' } }) };
    const result = UserPatchEngine.apply([operation], input, { verbosePatch: false, extensionUrns: [urn] });
    if (op === 'remove') expect(result.payload).not.toHaveProperty(urn);
    else expect(result.payload[urn]).toEqual({ label: 'after' });
    expect(input.rawPayload[urn]).toEqual({ label: 'before' });
  });
  it.each(['add', 'replace', 'remove'])('I03 rejects explicit core dotted %s when verbose is disabled', op => {
    const input = state();
    expect(() => UserPatchEngine.apply([
      { op: 'replace', path: 'displayName', value: 'must-not-persist' },
      { op, path: 'name.familyName', ...(op !== 'remove' ? { value: 'After' } : {}) },
    ], input, { verbosePatch: false, extensionUrns: [EXT] })).toThrow(PatchError);
    expect(input).toEqual(state());
  });

  it('rejects core-qualified dotted paths through the same verbose policy', () => {
    expect(() => UserPatchEngine.apply([{ op: 'replace', path: `${CORE}:name.familyName`, value: 'After' }],
      state(), { verbosePatch: false })).toThrow(PatchError);
  });

  it.each([true, false])('E17 preserves pathless dotted and extension compatibility, verbose=%s', verbosePatch => {
    const result = UserPatchEngine.apply([{ op: 'replace', value: {
      'name.familyName': 'After', [`${EXT}:name.familyName`]: 'Extension after',
    } }], state(), { verbosePatch, extensionUrns: [EXT] });
    expect(result.payload.name).toEqual({ givenName: 'Given', familyName: 'After' });
    expect(result.payload[EXT]).toEqual({ name: { familyName: 'Extension after' }, active: 'before' });
    expect(Object.keys(result.payload)).not.toContain('name.familyName');
  });

  it.each([true, false])('extension and selector paths remain independent of verbose=%s', verbosePatch => {
    const result = UserPatchEngine.apply([
      { op: 'replace', path: `${EXT}:name.familyName`, value: 'After' },
      { op: 'replace', path: 'emails[type eq "home"].value', value: 'new@example.test' },
    ], state(), { verbosePatch, extensionUrns: [EXT] });
    expect(result.payload[EXT]).toEqual({ name: { familyName: 'After' }, active: 'before' });
    expect(result.payload.emails).toEqual([{ value: 'new@example.test', type: 'home', primary: true }]);
  });

  const forms: [string, (value: unknown) => PatchOperation][] = [
    ['path', value => ({ op: 'replace', path: 'active', value })],
    ['qualified', value => ({ op: 'replace', path: `${CORE}:active`, value })],
    ['pathless', value => ({ op: 'replace', value: { active: value } })],
    ['legacy wrapper', value => ({ op: 'replace', path: 'active', value: { active: value } })],
  ];
  it.each(forms)('coercion OFF rejects quoted active in %s form', (_name, operation) => {
    const input = state();
    const config = { verbosePatch: true, allowAndCoerceBooleanStrings: false };
    expect(() => UserPatchEngine.apply([operation('False')], input, config)).toThrow('boolean');
    expect(input).toEqual(state());
  });
  it.each(forms)('coercion ON preserves recognized legacy strings in %s form', (_name, operation) => {
    const config = { verbosePatch: true, allowAndCoerceBooleanStrings: true };
    expect(UserPatchEngine.apply([operation('False')], state(), config).extractedFields.active).toBe(false);
  });
  it.each([true, false])('native booleans work with coercion=%s', allowAndCoerceBooleanStrings => {
    const config = { verbosePatch: true, allowAndCoerceBooleanStrings };
    const result = UserPatchEngine.apply([{ op: 'replace', path: 'active', value: false }],
      state(), config);
    expect(result.extractedFields.active).toBe(false);
  });
});
