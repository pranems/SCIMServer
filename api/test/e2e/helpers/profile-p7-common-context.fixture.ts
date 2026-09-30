export const SHARED_COMMON_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:P7Shared';
export const OTHER_COMMON_SCHEMA = 'urn:example:core:2.0:P7Other';

export function commonContextProfile(strict: boolean) {
  return {
    schemas: [
      { id: SHARED_COMMON_SCHEMA, name: 'Shared', attributes: [
        { name: 'externalId', type: 'integer', multiValued: true, caseExact: false },
        { name: 'id', type: 'integer', multiValued: true, mutability: 'readWrite', returned: 'default' },
        { name: 'meta', type: 'string', mutability: 'readWrite' },
        { name: 'displayName', type: 'integer', multiValued: true },
        { name: 'active', type: 'string' },
      ] },
      { id: OTHER_COMMON_SCHEMA, name: 'Other', attributes: [{ name: 'label', type: 'string' }] },
    ],
    resourceTypes: [
      { id: 'Shared', name: 'Shared', endpoint: '/Shareds', schema: SHARED_COMMON_SCHEMA, schemaExtensions: [] },
      { id: 'Other', name: 'Other', endpoint: '/Others', schema: OTHER_COMMON_SCHEMA,
        schemaExtensions: [{ schema: SHARED_COMMON_SCHEMA, required: false }] },
    ],
    settings: { StrictSchemaValidation: strict, AllowAndCoerceBooleanStrings: true },
  };
}
