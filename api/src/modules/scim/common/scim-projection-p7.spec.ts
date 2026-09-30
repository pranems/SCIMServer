import { applyAttributeProjection } from './scim-attribute-projection';

describe('P7 returned:request namespace isolation', () => {
  const core = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const ext = 'urn:example:extension:2.0:User';
  it('does not suppress default core attributes because an extension uses the same name', () => {
    const resource = { schemas: [core, ext], id: 'p7', value: 'core-default',
      contacts: [{ value: 'core-child' }], [ext]: { value: 'request', contacts: [{ value: 'ext-child' }] } };
    const characteristics = new Map([
      [ext.toLowerCase(), new Set(['value'])],
      [`${ext.toLowerCase()}.contacts`, new Set(['value'])],
    ]);
    const result = applyAttributeProjection(resource, undefined, undefined, undefined, characteristics);
    expect(result.value).toBe('core-default');
    expect(result.contacts).toEqual([{ value: 'core-child' }]);
    expect(result[ext]).toEqual({ contacts: [{}] });
    expect(resource[ext]).toEqual({ value: 'request', contacts: [{ value: 'ext-child' }] });
  });
  it('does not implicitly request undefined DTO fields; retains supplied false, zero and empty string', () => {
    const resource = { schemas: [core], id: 'p7', active: true, flag: false, count: 0, text: '' };
    const characteristics = new Map([[core.toLowerCase(), new Set(['active', 'flag', 'count', 'text'])]]);
    expect(applyAttributeProjection(resource, undefined, undefined, undefined, characteristics,
      { active: undefined, flag: false, count: 0, text: '' }))
      .toEqual({ schemas: [core], id: 'p7', flag: false, count: 0, text: '' });
  });
});
