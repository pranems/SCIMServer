import { RepositoryError } from '../errors/repository-error';
import type { SchemaAttributeDefinition, SchemaDefinition } from '../validation/validation-types';

// RFC 7643 sections 2.3.2/5/6/8: boolean, dateTime, binary and complex have no uniqueness.
const SCALAR_TYPES = ['string', 'reference', 'integer', 'decimal'] as const;
type UniqueScalarType = typeof SCALAR_TYPES[number];
function isScalarType(type: string): type is UniqueScalarType {
  return (SCALAR_TYPES as readonly string[]).includes(type);
}

export interface UniqueAttribute {
  readonly schemaUrn: string | null;
  readonly path: readonly { readonly name: string; readonly multiValued: boolean }[];
  readonly type: UniqueScalarType;
  readonly caseExact: boolean;
}
export type UniquenessPolicy = readonly UniqueAttribute[];

/** Compile only the schemas attached to this resource type, never the endpoint's union. */
export function compileUniquenessPolicy(schemas: readonly SchemaDefinition[]): UniquenessPolicy {
  const result: UniqueAttribute[] = [];
  for (const schema of schemas) {
    const core = schema.isCoreSchema ?? schema.id.toLowerCase().startsWith('urn:ietf:params:scim:schemas:core:');
    const builtinUser = core && schema.id.toLowerCase() === 'urn:ietf:params:scim:schemas:core:2.0:user';
    const builtinGroup = core && schema.id.toLowerCase() === 'urn:ietf:params:scim:schemas:core:2.0:group';
    const walk = (attrs: readonly SchemaAttributeDefinition[], parent: UniqueAttribute['path']): void => {
      for (const attr of attrs) {
        const path = [...parent, { name: attr.name, multiValued: attr.multiValued ?? false }];
        if (attr.uniqueness === 'global' || (attr.uniqueness === 'server' && attr.type === 'complex')) {
          throw new RepositoryError('INVALID_VALUE', 'Unsupported uniqueness declaration: global scope or complex-valued attribute.');
        }
        if (attr.uniqueness === 'server') {
          const type = attr.type ?? 'string';
          if (!isScalarType(type)) throw new RepositoryError('INVALID_VALUE', 'Unsupported uniqueness declaration type.');
          const root = path[0].name.toLowerCase();
          const promotedType = ['id', 'externalid'].includes(root) ? 'string'
            : (builtinUser || builtinGroup) && root === 'displayname' ? 'string'
              : (builtinUser || builtinGroup) && root === 'active' ? 'boolean'
              : builtinUser && root === 'username' ? 'string' : undefined;
          const computed = root === 'meta' || root === 'schemas' ||
            (builtinUser && root === 'groups');
          const unrepresentedMember = builtinGroup && root === 'members' &&
            (path.length !== 2 || !path[0].multiValued || path[1].multiValued ||
              !['value', 'type', 'display'].includes(path[1].name.toLowerCase()) ||
              !['string', 'reference'].includes(type));
          if (core && (computed || unrepresentedMember || (promotedType &&
              (path.length !== 1 || path[0].multiValued || (attr.type ?? 'string') !== promotedType)))) {
            throw new RepositoryError('INVALID_VALUE', 'Unsupported uniqueness declaration on a computed or incompatible promoted core attribute.');
          }
          result.push({
            schemaUrn: core ? null : schema.id, path, type,
            caseExact: type === 'reference' || (core && root === 'externalid') || (attr.caseExact ?? false),
          });
        }
        if (attr.subAttributes) walk(attr.subAttributes, path);
      }
    };
    walk(schema.attributes, []);
  }
  return result;
}

function property(object: unknown, name: string): unknown {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
  const entries = Object.entries(object).filter(([key]) => key.toLowerCase() === name.toLowerCase());
  if (entries.length > 1) throw new RepositoryError('INVALID_VALUE', 'A unique attribute path contains duplicate case-insensitive keys.');
  return entries[0]?.[1];
}

function valueKey(value: unknown, attr: UniqueAttribute): string {
  const invalid = () => new RepositoryError('INVALID_VALUE', 'A unique attribute must contain a valid value of its declared type.');
  switch (attr.type) {
    case 'string':
      if (typeof value !== 'string') throw invalid();
      return attr.caseExact ? value : value.toLowerCase();
    case 'reference':
      if (typeof value !== 'string') throw invalid();
      return value;
    case 'integer':
    case 'decimal':
      if (typeof value !== 'number' || !Number.isFinite(value) ||
          (attr.type === 'integer' && !Number.isSafeInteger(value))) throw invalid();
      return String(value);
    default:
      throw invalid();
  }
}

function values(payload: Record<string, unknown>, attr: UniqueAttribute): Set<string> {
  let candidates: unknown[] = [attr.schemaUrn ? property(payload, attr.schemaUrn) : payload];
  for (const segment of attr.path) {
    candidates = candidates.flatMap((parent) => {
      if (parent == null) return [];
      if (typeof parent !== 'object' || Array.isArray(parent)) {
        throw new RepositoryError('INVALID_VALUE', 'The parent of a unique subattribute must be an object.');
      }
      const value = property(parent, segment.name);
      if (value == null) return [];
      if (segment.multiValued) {
        if (!Array.isArray(value)) throw new RepositoryError('INVALID_VALUE', 'A unique multi-valued attribute must be an array.');
        return value.filter((item) => item != null);
      }
      if (Array.isArray(value)) throw new RepositoryError('INVALID_VALUE', 'A unique single-valued attribute cannot be an array.');
      return [value];
    });
  }
  return new Set(candidates.map((value) => valueKey(value, attr)));
}

/** Caller holds the storage namespace lock until the candidate is committed. */
export function assertUnique(
  policy: UniquenessPolicy, candidate: Record<string, unknown>,
  existing: Iterable<Record<string, unknown>>,
): void {
  const keys = policy.map((attr) => values(candidate, attr));
  for (const other of existing) {
    for (let i = 0; i < policy.length; i++) {
      if (keys[i].size === 0) continue;
      if ([...values(other, policy[i])].some((key) => keys[i].has(key))) {
        throw new RepositoryError('CONFLICT', 'A unique attribute value is already owned by another resource in this endpoint and resource type.');
      }
    }
  }
}

/** Builtin columns and custom payloads have different public representations. */
export function uniquenessPayload(
  record: { rawPayload: string; scimId: string; externalId: string | null; displayName?: string | null; active?: boolean; userName?: string },
  members?: readonly { value: string; type: string | null; display: string | null }[],
  representation: 'columns' | 'payload' = 'columns',
): Record<string, unknown> {
  const payload = JSON.parse(record.rawPayload) as Record<string, unknown>;
  if (representation === 'payload') {
    for (const key of Object.keys(payload)) if (key.toLowerCase() === 'id') delete payload[key];
    return { ...payload, id: record.scimId };
  }
  const promoted: Record<string, unknown> = {
    id: record.scimId, externalId: record.externalId, displayName: record.displayName,
    active: record.active, ...(record.userName === undefined ? {} : { userName: record.userName }),
    ...(members === undefined ? {} : { members }),
  };
  for (const [name, value] of Object.entries(promoted)) {
    for (const key of Object.keys(payload)) if (key.toLowerCase() === name.toLowerCase()) delete payload[key];
    payload[name] = value;
  }
  return payload;
}
