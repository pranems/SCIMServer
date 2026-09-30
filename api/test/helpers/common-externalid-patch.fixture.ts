export const COMMON_PATCH_EXTENSION = 'urn:example:extension:2.0:CommonPatch';
export const invalidCommonExternalIds: unknown[] = [42, false, [], ['invalid'], { value: 'invalid' }];

export function commonExternalIdPatchFixture(family: string, strict: boolean) {
  const core = family === 'Widget' ? 'urn:example:core:2.0:CommonWidget' : `urn:ietf:params:scim:schemas:core:2.0:${family}`;
  const primary = family === 'User' ? 'userName' : family === 'Group' ? 'displayName' : 'label';
  return {
    core,
    primary,
    profile: {
      schemas: [
        { id: core, name: family, attributes: [
          { name: primary, type: 'string', required: true }, { name: 'marker', type: 'string' },
          { name: 'active', type: family === 'Widget' ? 'string' : 'boolean' },
          ...(family === 'Widget' ? [{ name: 'displayName', type: 'integer', multiValued: true }] : []),
          ...(family === 'Group' ? [{ name: 'members', type: 'complex', multiValued: true,
            subAttributes: [{ name: 'value', type: 'string' }] }] : []),
        ] },
        { id: COMMON_PATCH_EXTENSION, name: 'CommonPatchExtension', attributes: [
          { name: 'externalId', type: 'integer', multiValued: true },
        ] },
      ],
      resourceTypes: [{ id: family, name: family, endpoint: `/${family}s`, schema: core,
        schemaExtensions: [{ schema: COMMON_PATCH_EXTENSION, required: false }] }],
      settings: { StrictSchemaValidation: strict, logFileEnabled: false },
      serviceProviderConfig: { patch: { supported: true }, etag: { supported: true } },
    },
    payload(name: string) {
      return { schemas: [core, COMMON_PATCH_EXTENSION], [primary]: name, externalId: 'OriginalCase',
        marker: 'before', [COMMON_PATCH_EXTENSION]: { externalId: [1] },
        ...(family === 'Widget' ? { displayName: [7, 8], active: 'custom' } : {}) };
    },
  };
}
