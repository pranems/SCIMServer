import type { ProfileValidationError } from './endpoint-profile.service';
import { COMMON_EXTERNAL_ID, COMMON_ID, COMMON_META } from '../../../domain/validation/common-attributes';

const KEYWORDS: Record<string, readonly string[]> = {
  type: ['string', 'boolean', 'decimal', 'integer', 'dateTime', 'reference', 'complex', 'binary'],
  mutability: ['readOnly', 'readWrite', 'immutable', 'writeOnly'],
  returned: ['always', 'never', 'default', 'request'],
  uniqueness: ['none', 'server', 'global'],
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Check declarations BEFORE expansion can discard malformed containers or coerce
 * truthy strings. Omitted characteristics retain their RFC defaults; this pass
 * does not turn canonical suggestions into a provider-specific closed enum.
 */
export function validateSchemaDeclarations(input: unknown): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];
  const fail = (path: string, detail: string, code = 'INVALID_DECLARATION') =>
    errors.push({ code, detail: `${path}: ${detail}` });
  const coreSchemas = new Set(object(input) && Array.isArray(input.resourceTypes)
    ? input.resourceTypes.filter(object).map(rt => rt.schema) : []);
  const extensionSchemas = new Set(object(input) && Array.isArray(input.resourceTypes)
    ? input.resourceTypes.filter(object).flatMap(rt => Array.isArray(rt.schemaExtensions)
      ? rt.schemaExtensions.filter(object).map(ext => ext.schema) : []) : []);
  const attributes = (value: unknown, path: string, coreRoot = false): void => {
    if (!Array.isArray(value)) { fail(path, 'must be an array of attribute definitions.'); return; }
    const seen = new Set<string>();
    for (const [index, attr] of value.entries()) {
      const here = `${path}[${index}]${object(attr) && typeof attr.name === 'string' ? ` (${attr.name})` : ''}`;
      if (!object(attr)) { fail(here, 'must be an attribute object.'); continue; }
      if (typeof attr.name !== 'string' || !attr.name.length) {
        fail(here, 'name must be a non-empty string.');
      } else {
        const name = attr.name.toLowerCase();
        if (seen.has(name)) fail(here, 'attribute names must be unique ignoring case.');
        seen.add(name);
      }
      for (const [key, allowed] of Object.entries(KEYWORDS)) {
        if (attr[key] !== undefined && !allowed.includes(attr[key] as string)) {
          fail(`${here}.${key}`, `must be one of ${allowed.join(', ')}.`);
        }
      }
      for (const key of ['multiValued', 'required', 'caseExact']) {
        if (attr[key] !== undefined && typeof attr[key] !== 'boolean') fail(`${here}.${key}`, 'must be a Boolean.');
      }
      for (const key of ['canonicalValues', 'referenceTypes']) {
        if (attr[key] !== undefined &&
          (!Array.isArray(attr[key]) || !(attr[key] as unknown[]).every(v => typeof v === 'string'))) {
          fail(`${here}.${key}`, 'must be an array of strings.');
        }
      }
      if (coreRoot && typeof attr.name === 'string') {
        const common = ({ externalid: COMMON_EXTERNAL_ID, id: COMMON_ID, meta: COMMON_META } as Record<string, Record<string, unknown>>)[attr.name.toLowerCase()];
        const keys = attr.name.toLowerCase() === 'externalid'
          ? ['type', 'multiValued', 'caseExact', 'mutability'] : ['type', 'multiValued', 'caseExact', 'mutability', 'returned'];
        for (const key of keys) {
          if (common && common[key] !== undefined && attr[key] !== undefined && attr[key] !== common[key]) {
            fail(`${here}.${key}`, `must be ${JSON.stringify(common[key])} for common ${attr.name} (RFC 7643 3.1).`);
          }
        }
      }
      if (attr.uniqueness === 'global') {
        fail(here, 'global uniqueness cannot be guaranteed by this provider; use a supported scope.', 'UNSUPPORTED_DECLARATION');
      }
      if (attr.subAttributes !== undefined) {
        if (attr.type !== 'complex') fail(here, 'only a complex attribute can declare subAttributes.');
        attributes(attr.subAttributes, `${here}.subAttributes`);
      }
    }
  };
  if (!object(input)) { fail('profile', 'must be an object.'); return errors; }
  if (input.schemas !== undefined) {
    if (!Array.isArray(input.schemas)) fail('schemas', 'must be an array.');
    else for (const [index, schema] of input.schemas.entries()) {
      const here = `schemas[${index}]`;
      if (!object(schema)) { fail(here, 'must be an object.'); continue; }
      for (const key of ['id', 'name']) {
        if (typeof schema[key] !== 'string' || !schema[key].length) fail(`${here}.${key}`, 'must be a non-empty string.');
      }
      if (schema.attributes !== undefined && schema.attributes !== 'all') {
        attributes(schema.attributes, `${here}.attributes`, coreSchemas.has(schema.id) && !extensionSchemas.has(schema.id));
      }
    }
  }
  if (input.resourceTypes !== undefined) {
    if (!Array.isArray(input.resourceTypes)) fail('resourceTypes', 'must be an array.');
    else for (const [index, rt] of input.resourceTypes.entries()) {
      const here = `resourceTypes[${index}]`;
      if (!object(rt)) { fail(here, 'must be an object.'); continue; }
      for (const key of ['name', 'schema', 'endpoint']) {
        if (typeof rt[key] !== 'string' || !rt[key].length) fail(`${here}.${key}`, 'must be a non-empty string.');
      }
      if (rt.schemaExtensions !== undefined) {
        if (!Array.isArray(rt.schemaExtensions)) fail(`${here}.schemaExtensions`, 'must be an array.');
        else for (const ext of rt.schemaExtensions) {
          if (!object(ext) || typeof ext.schema !== 'string' || !ext.schema.length ||
            (ext.required !== undefined && typeof ext.required !== 'boolean')) {
            fail(`${here}.schemaExtensions`, 'requires a schema string and an optional Boolean required characteristic.');
          }
        }
      }
    }
  }
  return errors;
}
