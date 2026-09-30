import type { SchemaAttributeDefinition } from '../../../src/domain/validation/validation-types';

export const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const DEVICE = 'urn:example:scim:schemas:core:2.0:Device';
export const GOOGLE = 'urn:ietf:params:scim:schemas:extension:google:2.0:CloudIdentityUser';
export const CONTOSO = 'urn:ietf:params:scim:schemas:extension:contoso:2.0:ScalarMVUser';
export const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const DIAGNOSTICS = 'urn:scimserver:api:messages:2.0:Diagnostics';

const attr = (
  name: string,
  type: SchemaAttributeDefinition['type'],
  extra: Partial<SchemaAttributeDefinition> = {},
): SchemaAttributeDefinition => ({
  name, type, multiValued: false, required: false,
  mutability: 'readWrite', returned: 'default', ...extra,
});

export const contactsAttribute = attr('contacts', 'complex', {
  multiValued: true,
  subAttributes: [
    attr('primary', 'boolean'), attr('value', 'string'), attr('rank', 'decimal'),
    attr('code', 'string', { caseExact: true }), attr('type', 'string'),
  ],
});

export const incidentSchemas = [
  {
    id: GOOGLE, name: 'SyntheticGoogle',
    attributes: [
      attr('primaryOrganization', 'complex', { subAttributes: [attr('location', 'string')] }),
      attr('additionalOrganizations', 'complex', {
        multiValued: true, subAttributes: [attr('type', 'string'), attr('symbol', 'string')],
      }),
    ],
  },
  { id: CONTOSO, name: 'SyntheticContoso', attributes: [contactsAttribute] },
];

export function typedPatchProfile(strict: boolean) {
  const schemaExtensions = incidentSchemas.map(s => ({ schema: s.id, required: false }));
  return {
    schemas: [
      { id: USER, name: 'User', attributes: 'all' },
      { id: GROUP, name: 'Group', attributes: 'all' },
      { id: DEVICE, name: 'Device', attributes: [attr('displayName', 'string'), contactsAttribute] },
      ...incidentSchemas,
    ],
    resourceTypes: [
      { id: 'User', name: 'User', endpoint: '/Users', schema: USER, schemaExtensions },
      { id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP, schemaExtensions },
      { id: 'Device', name: 'Device', endpoint: '/Devices', schema: DEVICE, schemaExtensions },
    ],
    settings: {
      StrictSchemaValidation: strict, VerbosePatchSupported: true,
      AllowAndCoerceBooleanStrings: true, logFileEnabled: false,
    },
  };
}

export function incidentPayload() {
  return {
    [GOOGLE]: {
      primaryOrganization: { location: 'old' },
      additionalOrganizations: [{ type: 'school', symbol: 'old' }, { type: 'work', symbol: 'old' }],
    },
    [CONTOSO]: { contacts: [{ primary: true, value: 'old' }] },
  };
}

export function incidentOperations() {
  return [
    { op: 'replace', path: `${GOOGLE}:primaryOrganization.location`, value: 'new' },
    { op: 'replace', path: `${GOOGLE}:additionalOrganizations[type eq "school"].symbol`, value: 'new' },
    { op: 'replace', path: `${GOOGLE}:additionalOrganizations[type eq "work"].symbol`, value: 'new' },
    { op: 'replace', path: `${CONTOSO}:contacts[primary eq true].value`, value: 'new' },
  ];
}

export function incidentExpected() {
  return {
    [GOOGLE]: {
      primaryOrganization: { location: 'new' },
      additionalOrganizations: [{ type: 'school', symbol: 'new' }, { type: 'work', symbol: 'new' }],
    },
    [CONTOSO]: { contacts: [{ primary: true, value: 'new' }] },
  };
}
