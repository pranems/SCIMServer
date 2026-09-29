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

export function effectiveCommonAttribute(
  attribute: SchemaAttributeDefinition,
  isCore: boolean,
): SchemaAttributeDefinition {
  if (!isCore || attribute.name.toLowerCase() !== 'externalid') return attribute;
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
