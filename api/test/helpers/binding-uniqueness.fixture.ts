export const SHARED_UNIQUE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:UniqueShared';
export const OTHER_UNIQUE_SCHEMA = 'urn:example:uniqueness:Other';

export function bindingUniquenessProfile(strict = true) {
  const profile = structuredClone(template);
  const schemas: { id: string; name: string; attributes: SchemaAttributeDefinition[] }[] = profile.schemas;
  return {
    schemas,
    resourceTypes: profile.resourceTypes,
    settings: { StrictSchemaValidation: strict },
  };
}
import type { SchemaAttributeDefinition } from '../../src/domain/validation/validation-types';
import template from './binding-uniqueness.json';
