import { validateAndExpandProfile } from './endpoint-profile.service';
import type { ShorthandProfileInput } from './endpoint-profile.types';

const urn = 'urn:example:params:scim:schemas:core:2.0:Widget';
const profile = (attributes: unknown): ShorthandProfileInput => ({
  schemas: [{ id: urn, name: 'Widget', attributes }],
  resourceTypes: [{ id: 'Widget', name: 'Widget', endpoint: '/Widgets', schema: urn, schemaExtensions: [] }],
} as unknown as ShorthandProfileInput);

describe('P7 declaration validation before expansion or storage', () => {
  it.each([
    { type: 'imaginary' }, { type: null }, { type: 1 },
    { multiValued: 'false' }, { required: 'false' }, { caseExact: 'true' },
    { mutability: 'readonly' }, { returned: 'sometimes' }, { uniqueness: 'tenant' },
    { canonicalValues: 'work' }, { canonicalValues: [42] },
    { referenceTypes: 'User' }, { referenceTypes: [42] },
    { subAttributes: 'child' }, { type: 'string', subAttributes: [{ name: 'child' }] },
    { uniqueness: 'global' },
  ])('rejects invalid declaration %j', override => {
    const result = validateAndExpandProfile(profile([{ name: 'sample', ...override }]));
    expect(result.valid).toBe(false);
    expect(result.profile).toBeUndefined();
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expect.stringMatching(/DECLARATION|UNSUPPORTED/), detail: expect.stringContaining('sample') }),
    ]));
  });

  it.each([{}, null, 42, 'bad'])('rejects malformed attributes container %j', attributes => {
    expect(validateAndExpandProfile(profile(attributes)).valid).toBe(false);
  });

  it('rejects duplicate case-insensitive names and malformed nested definitions', () => {
    expect(validateAndExpandProfile(profile([{ name: 'value' }, { name: 'VALUE' }])).valid).toBe(false);
    expect(validateAndExpandProfile(profile([{ name: 'parent', type: 'complex',
      subAttributes: [{ name: 'child', multiValued: 'yes' }] }])).valid).toBe(false);
  });

  it('preserves omitted RFC characteristics and supports all eight known types', () => {
    const omitted = validateAndExpandProfile(profile([{ name: 'sample' }]));
    expect(omitted.valid).toBe(true);
    expect(omitted.profile!.schemas[0].attributes[0]).toEqual({ name: 'sample' });
    for (const type of ['string', 'boolean', 'integer', 'decimal', 'dateTime', 'binary', 'reference', 'complex']) {
      expect(validateAndExpandProfile(profile([{ name: 'sample', type }])).valid).toBe(true);
    }
  });
});
