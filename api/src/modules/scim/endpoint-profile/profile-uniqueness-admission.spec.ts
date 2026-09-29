import { validateAndExpandProfile } from './endpoint-profile.service';
import type { ShorthandProfileInput } from './endpoint-profile.types';
import { bindingUniquenessProfile } from '../../../../test/helpers/binding-uniqueness.fixture';

const input = (attribute: Record<string, unknown>): ShorthandProfileInput => ({
  schemas: [{ id: 'urn:example:admission:Thing', name: 'Thing', attributes: [{ name: 'code', ...attribute }] }],
  resourceTypes: [{ id: 'Thing', name: 'Thing', description: 'Thing', endpoint: '/Things', schema: 'urn:example:admission:Thing', schemaExtensions: [] }],
});

describe('profile uniqueness admission uses the storage compiler', () => {
  it.each(['boolean', 'dateTime', 'binary', 'complex'])('rejects unsupported server uniqueness for %s before publication', type => {
    const result = validateAndExpandProfile(input({ type, uniqueness: 'server' }));
    expect(result).toEqual({ valid: false, errors: [{
      code: 'UNSUPPORTED_DECLARATION',
      detail: expect.stringMatching(/ResourceType "Thing".*Unsupported uniqueness declaration/) as unknown,
    }] });
  });
  it.each(['string', 'integer', 'decimal', 'reference'])('admits supported scalar/MV %s policies', type => {
    const result = validateAndExpandProfile(input({ type, multiValued: true, uniqueness: 'server' }));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
  it('rejects an explicit computed core meta uniqueness promise', () => {
    const result = validateAndExpandProfile(input({ name: 'meta', type: 'complex', uniqueness: 'server' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{
      code: 'UNSUPPORTED_DECLARATION',
      detail: expect.stringContaining('Unsupported uniqueness declaration') as unknown,
    }]);
  });
  it('validates each binding without rewriting the shared declaration', () => {
    const profile = bindingUniquenessProfile();
    const before = structuredClone(profile);
    const result = validateAndExpandProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.profile?.schemas[0].attributes).toEqual(profile.schemas[0].attributes);
    expect(profile).toEqual(before);
  });
  it('defaults omitted schemaExtensions to the empty optional binding list', () => {
    const profile = input({ type: 'string' });
    Reflect.deleteProperty(profile.resourceTypes![0], 'schemaExtensions');
    const result = validateAndExpandProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.profile?.resourceTypes[0].schemaExtensions).toEqual([]);
  });
  it.each([null, {}, 'invalid'])('rejects malformed schemaExtensions %j as a declaration error', schemaExtensions => {
    const profile = input({ type: 'string' });
    Reflect.set(profile.resourceTypes![0], 'schemaExtensions', schemaExtensions);
    expect(validateAndExpandProfile(profile)).toEqual({
      valid: false, errors: [{ code: 'INVALID_DECLARATION', detail: 'resourceTypes[0].schemaExtensions: must be an array.' }],
    });
  });
});
