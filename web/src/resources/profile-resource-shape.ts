export interface ProfileResourceAttribute {
  name: string;
  type: string;
  required?: boolean;
  multiValued?: boolean;
  mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned?: 'always' | 'default' | 'never' | 'request';
  canonicalValues?: string[];
  referenceTypes?: string[];
  description?: string;
  subAttributes?: ProfileResourceAttribute[];
}

export interface ProfileResourceSchema {
  id: string;
  name?: string;
  description?: string;
  attributes: ProfileResourceAttribute[];
}

export interface ProfileResourceType {
  id: string;
  name: string;
  endpoint: string;
  schema: string;
  description?: string;
  schemaExtensions?: Array<{ schema: string; required?: boolean }>;
}

export type ResourceFieldInputKind = 'text' | 'number' | 'boolean' | 'select' | 'json';

export interface ResourceFieldDescriptor {
  id: string;
  path: string;
  name: string;
  label: string;
  schemaUrn: string;
  extension: boolean;
  type: string;
  inputKind: ResourceFieldInputKind;
  required: boolean;
  multiValued: boolean;
  immutable: boolean;
  description?: string;
  canonicalValues: string[];
  referenceTypes: string[];
  example: unknown;
}

export interface EffectiveResourceShape {
  resourceType: ProfileResourceType;
  coreSchema: ProfileResourceSchema;
  extensionSchemas: Array<{
    binding: { schema: string; required?: boolean };
    schema: ProfileResourceSchema;
  }>;
  fields: ResourceFieldDescriptor[];
  exampleResource: Record<string, unknown>;
}

export interface ScimPatchOperation {
  op: 'replace' | 'remove';
  path: string;
  value?: unknown;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function sentenceLabel(value: string): string {
  const parts = words(value);
  if (parts.length === 0) return value;
  return parts.map((part, index) => index === 0
    ? part.charAt(0).toUpperCase() + part.slice(1)
    : part.toLowerCase()).join(' ');
}

function kebab(value: string): string {
  return words(value).map((part) => part.toLowerCase()).join('-');
}

function scalarExample(
  attribute: ProfileResourceAttribute,
  parentName: string | undefined,
  resourceTypeName: string,
): unknown {
  if (attribute.canonicalValues?.length) return attribute.canonicalValues[0];
  const name = attribute.name.toLowerCase();
  if (attribute.type === 'boolean') return true;
  if (attribute.type === 'integer') return 1;
  if (attribute.type === 'decimal') return 1.5;
  if (attribute.type === 'dateTime') return '2026-01-15T12:00:00Z';
  if (attribute.type === 'binary') return 'U0NJTQ==';
  if (attribute.type === 'reference') return 'https://example.com/resources/1';
  if (name === 'username') return 'alex.taylor@example.com';
  if (name === 'displayname') return `${resourceTypeName} Example`;
  if (name === 'givenname') return 'Alex';
  if (name === 'familyname') return 'Taylor';
  if (name === 'value' && parentName?.toLowerCase() === 'emails') {
    return 'alex.taylor@example.com';
  }
  return `${kebab(attribute.name)}-example`;
}

function attributeExample(
  attribute: ProfileResourceAttribute,
  resourceTypeName: string,
  parentName?: string,
): unknown {
  if (attribute.name === 'members' && attribute.multiValued) return [];
  let value: unknown;
  if (attribute.type === 'complex') {
    value = Object.fromEntries(
      (attribute.subAttributes ?? [])
        .filter((subAttribute) => subAttribute.mutability !== 'readOnly')
        .map((subAttribute) => [
          subAttribute.name,
          attributeExample(subAttribute, resourceTypeName, attribute.name),
        ]),
    );
  } else {
    value = scalarExample(attribute, parentName, resourceTypeName);
  }
  return attribute.multiValued ? [value] : value;
}

function inputKind(attribute: ProfileResourceAttribute): ResourceFieldInputKind {
  if (attribute.multiValued || attribute.type === 'complex') return 'json';
  if (attribute.canonicalValues?.length) return 'select';
  if (attribute.type === 'boolean') return 'boolean';
  if (attribute.type === 'integer' || attribute.type === 'decimal') return 'number';
  return 'text';
}

function fieldDescriptor(
  attribute: ProfileResourceAttribute,
  schemaUrn: string,
  coreSchemaUrn: string,
  resourceTypeName: string,
): ResourceFieldDescriptor {
  const extension = schemaUrn !== coreSchemaUrn;
  return {
    id: `${schemaUrn}|${attribute.name}`,
    path: extension ? `${schemaUrn}:${attribute.name}` : attribute.name,
    name: attribute.name,
    label: sentenceLabel(attribute.name),
    schemaUrn,
    extension,
    type: attribute.type,
    inputKind: inputKind(attribute),
    required: attribute.required === true,
    multiValued: attribute.multiValued === true,
    immutable: attribute.mutability === 'immutable',
    description: attribute.description,
    canonicalValues: attribute.canonicalValues ?? [],
    referenceTypes: attribute.referenceTypes ?? [],
    example: attributeExample(attribute, resourceTypeName),
  };
}

function writableFields(
  schema: ProfileResourceSchema,
  coreSchemaUrn: string,
  resourceTypeName: string,
): ResourceFieldDescriptor[] {
  return schema.attributes
    .filter((attribute) => attribute.mutability !== 'readOnly')
    .map((attribute) => fieldDescriptor(attribute, schema.id, coreSchemaUrn, resourceTypeName));
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

export function resolveEffectiveResourceShape(
  resourceType: ProfileResourceType,
  schemas: ProfileResourceSchema[],
): EffectiveResourceShape {
  const schemaMap = new Map(schemas.map((schema) => [schema.id, schema]));
  const coreSchema = schemaMap.get(resourceType.schema);
  if (!coreSchema) {
    throw new Error(`Schema "${resourceType.schema}" for resource type "${resourceType.name}" was not found.`);
  }
  const extensionSchemas = (resourceType.schemaExtensions ?? []).map((binding) => {
    const schema = schemaMap.get(binding.schema);
    if (!schema) {
      throw new Error(`Extension schema "${binding.schema}" for resource type "${resourceType.name}" was not found.`);
    }
    return { binding, schema };
  });
  const fields = [
    ...writableFields(coreSchema, coreSchema.id, resourceType.name),
    ...extensionSchemas.flatMap(({ schema }) =>
      writableFields(schema, coreSchema.id, resourceType.name)),
  ];
  const shape: EffectiveResourceShape = {
    resourceType,
    coreSchema,
    extensionSchemas,
    fields,
    exampleResource: {},
  };
  shape.exampleResource = buildCreatePayload(
    shape,
    Object.fromEntries(fields.map((field) => [field.id, field.example])),
  );
  return shape;
}

export function valueForField(
  field: ResourceFieldDescriptor,
  resource: Record<string, unknown>,
): unknown {
  if (!field.extension) return resource[field.name];
  const extension = resource[field.schemaUrn];
  return extension && typeof extension === 'object'
    ? (extension as Record<string, unknown>)[field.name]
    : undefined;
}

export function buildCreatePayload(
  shape: EffectiveResourceShape,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const schemas = [shape.coreSchema.id];
  for (const field of shape.fields) {
    const value = values[field.id];
    if (!hasValue(value)) continue;
    if (!field.extension) {
      payload[field.name] = value;
      continue;
    }
    const extension = (payload[field.schemaUrn] as Record<string, unknown> | undefined) ?? {};
    extension[field.name] = value;
    payload[field.schemaUrn] = extension;
    if (!schemas.includes(field.schemaUrn)) schemas.push(field.schemaUrn);
  }
  for (const { binding } of shape.extensionSchemas) {
    if (binding.required && !schemas.includes(binding.schema)) schemas.push(binding.schema);
  }
  return { schemas, ...payload };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildPatchOperations(
  shape: EffectiveResourceShape,
  original: Record<string, unknown>,
  values: Record<string, unknown>,
): ScimPatchOperation[] {
  const operations: ScimPatchOperation[] = [];
  for (const field of shape.fields) {
    if (!(field.id in values) || field.immutable) continue;
    const next = values[field.id];
    const previous = valueForField(field, original);
    if (sameValue(previous, next)) continue;
    if (!hasValue(next)) {
      if (hasValue(previous)) operations.push({ op: 'remove', path: field.path });
      continue;
    }
    operations.push({ op: 'replace', path: field.path, value: next });
  }
  return operations;
}