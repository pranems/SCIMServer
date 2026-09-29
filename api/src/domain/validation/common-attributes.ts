import type { SchemaAttributeDefinition } from './validation-types';

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
