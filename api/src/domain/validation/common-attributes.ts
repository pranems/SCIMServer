import type { SchemaAttributeDefinition, ValidationError } from './validation-types';

/** RFC 7643 3.1 takes precedence over older core-schema declarations. */
export const COMMON_EXTERNAL_ID = {
  name: 'externalId',
  type: 'string',
  multiValued: false,
  required: false,
  caseExact: true,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
} as const satisfies SchemaAttributeDefinition;

export const COMMON_ID = {
  name: 'id', type: 'string', multiValued: false, required: false,
  caseExact: true, mutability: 'readOnly', returned: 'always', uniqueness: 'server',
} as const satisfies SchemaAttributeDefinition;

export const COMMON_META = {
  name: 'meta', type: 'complex', multiValued: false, required: false,
  mutability: 'readOnly', returned: 'default', uniqueness: 'none',
  subAttributes: [
    { name: 'resourceType', type: 'string', multiValued: false, required: false, caseExact: true, mutability: 'readOnly', returned: 'default' },
    { name: 'created', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
    { name: 'lastModified', type: 'dateTime', multiValued: false, required: false, mutability: 'readOnly', returned: 'default' },
    { name: 'location', type: 'reference', multiValued: false, required: false, caseExact: true, mutability: 'readOnly', returned: 'default', referenceTypes: ['uri'] },
    { name: 'version', type: 'string', multiValued: false, required: false, caseExact: true, mutability: 'readOnly', returned: 'default' },
  ],
} as const satisfies SchemaAttributeDefinition;

export function isCommonAttributeName(name: string): boolean {
  return ['id', 'externalid', 'meta'].includes(name.toLowerCase());
}

export function effectiveCommonAttribute(
  attribute: SchemaAttributeDefinition,
  isCore: boolean,
): SchemaAttributeDefinition {
  if (!isCore) return attribute;
  const name = attribute.name.toLowerCase();
  if (name === 'id') return { ...attribute, ...COMMON_ID, name: attribute.name };
  if (name === 'meta') return { ...attribute, ...COMMON_META, name: attribute.name };
  if (name !== 'externalid') return attribute;
  return {
    ...attribute,
    type: COMMON_EXTERNAL_ID.type,
    multiValued: COMMON_EXTERNAL_ID.multiValued,
    caseExact: COMMON_EXTERNAL_ID.caseExact,
    mutability: COMMON_EXTERNAL_ID.mutability,
  };
}

/** Common value checks only: no required-field or extension-presence checks. */
export function validateCommonAttributeValues(payload: Record<string, unknown>): ValidationError[] {
  return Object.entries(payload)
    .filter(([key, value]) => key.toLowerCase() === 'externalid' && value != null && typeof value !== 'string')
    .map(([key]) => ({
      path: key,
      message: 'Common externalId must be a single string (RFC 7643 3.1).',
      scimType: 'invalidValue',
    }));
}

/** Resolve a binding, never mutate a profile schema also used as an extension. */
export function effectiveCommonAttributes(
  attributes: readonly SchemaAttributeDefinition[],
  isCore: boolean,
): readonly SchemaAttributeDefinition[] {
  if (!isCore) return attributes;
  const result = attributes.map(attribute => effectiveCommonAttribute(attribute, true));
  for (const common of [COMMON_ID, COMMON_EXTERNAL_ID, COMMON_META]) {
    if (!result.some(attribute => attribute.name.toLowerCase() === common.name.toLowerCase())) result.push(common);
  }
  return result;
}
