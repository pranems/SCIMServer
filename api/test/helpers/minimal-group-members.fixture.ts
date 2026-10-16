export const minimalGroupUrn = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const minimalUserUrn = 'urn:ietf:params:scim:schemas:core:2.0:User';

export function minimalGroupMembersProfile() {
  return {
    schemas: [
      { id: minimalUserUrn, name: 'User', attributes: [
        { name: 'userName', type: 'string', required: true, multiValued: false },
      ] },
      { id: minimalGroupUrn, name: 'Group', attributes: [
        { name: 'displayName', type: 'string', required: true, multiValued: false },
        { name: 'members', type: 'complex', multiValued: true, required: false, subAttributes: [
          { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'immutable' },
          { name: '$ref', type: 'reference', multiValued: false, required: false, referenceTypes: ['User', 'Group'], mutability: 'immutable' },
        ] },
      ] },
    ],
    resourceTypes: [
      { id: 'User', name: 'User', endpoint: '/Users', schema: minimalUserUrn, schemaExtensions: [] },
      { id: 'Group', name: 'Group', endpoint: '/Groups', schema: minimalGroupUrn, schemaExtensions: [] },
    ],
    settings: {
      StrictSchemaValidation: true,
      MultiMemberPatchOpForGroupEnabled: true,
      PatchOpAllowRemoveAllMembers: true,
    },
  };
}
