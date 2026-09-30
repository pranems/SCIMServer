import type { SchemaAttributeDefinition, SchemaDefinition } from '../../../domain/validation';
import { evaluateFilter, parseScimFilter, type FilterNode } from '../filters/scim-filter-parser';
import type { FilterAttributeShape } from '../filters/apply-scim-filter';
import { createScimError } from './scim-errors';
import { DEFAULT_COUNT } from './scim-constants';

export interface ReadQueryParams {
  filter?: string;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;
  count?: number;
}

type Resource = Record<string, unknown>;
type FilterBuilder = (
  filter?: string,
  exact?: Set<string>,
  shapes?: ReadonlyMap<string, FilterAttributeShape>,
) => { dbWhere: Resource };
interface Attribute {
  path: string[];
  definition: SchemaAttributeDefinition;
  denied: boolean;
}

function property(value: unknown, name: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const object = value as Resource;
  const key = Object.keys(object).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : object[key];
}

/** Filter paths fan out over arrays; sort paths select primary, otherwise first. */
function valueAt(value: unknown, path: readonly string[], sort = false): unknown {
  if (Array.isArray(value)) {
    if (sort) {
      const selected = value.find((item) => property(item, 'primary') === true) ?? value[0];
      return valueAt(selected, path, true);
    }
    return value.flatMap((item) => {
      const found = valueAt(item, path);
      return Array.isArray(found) ? found : [found];
    });
  }
  if (!path.length) return value;
  return valueAt(property(value, path[0]), path.slice(1), sort);
}

function scalar(value: unknown, definition: SchemaAttributeDefinition): unknown {
  if (definition.type === 'dateTime' && typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  return value;
}

function missing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Request-scoped read plan. Schemas authorize operands, internal resources supply
 * values, and only paginated records reach the existing safe response mapper.
 */
export function createReadQuery(
  params: ReadQueryParams,
  schemas: readonly SchemaDefinition[],
  maxResults: number,
  buildFilter: FilterBuilder,
) {
  const attributes = new Map<string, Attribute>();
  const coreExact = new Set<string>();
  for (const schema of schemas) {
    const core = schema.isCoreSchema ?? /:core:2\.0:(User|Group)$/i.test(schema.id);
    const walk = (defs: readonly SchemaAttributeDefinition[], path: string[], denied: boolean) => {
      for (const definition of defs) {
        const segments = [...path, definition.name];
        const blocked =
          denied ||
          definition.mutability?.toLowerCase() === 'writeonly' ||
          definition.name.startsWith('_');
        const entry = {
          path: core ? segments : [schema.id, ...segments],
          definition,
          denied: blocked,
        };
        const relative = segments.join('.').toLowerCase();
        attributes.set(`${schema.id}:${relative}`.toLowerCase(), entry);
        if (core) {
          attributes.set(relative, entry);
          if (definition.caseExact) coreExact.add(relative);
        }
        if (definition.subAttributes) walk(definition.subAttributes, segments, blocked);
      }
    };
    walk(schema.attributes, [], false);
  }
  // Common attributes exist even without a declaration. RFC 7643 section 3.1
  // fixes top-level externalId to a single caseExact string for every ResourceType.
  for (const [name, type, exact] of [
    ['id', 'string', true],
    ['externalId', 'string', true],
    ['meta.resourceType', 'string', false],
    ['meta.created', 'dateTime', false],
    ['meta.lastModified', 'dateTime', false],
    ['meta.location', 'reference', true],
    ['meta.version', 'string', true],
  ] as const) {
    const declared = attributes.get(name.toLowerCase());
    if (!declared || name === 'externalId') {
      const entry = {
        path: name.split('.'),
        definition: {
          ...declared?.definition,
          name,
          type,
          caseExact: exact,
          multiValued: false,
          required: false,
        },
        denied: declared?.denied ?? false,
      };
      attributes.set(name.toLowerCase(), entry);
      for (const schema of schemas.filter(
        (s) => s.isCoreSchema ?? /:core:2\.0:(User|Group)$/i.test(s.id),
      )) {
        attributes.set(`${schema.id}:${name}`.toLowerCase(), entry);
      }
      if (exact) coreExact.add(name.toLowerCase());
    }
  }

  function resolve(path: string, purpose: 'filter' | 'sort'): Attribute {
    const attribute = attributes.get(path.toLowerCase());
    if (!attribute || attribute.denied) {
      throw createScimError({
        status: 400,
        scimType: purpose === 'filter' ? 'invalidFilter' : 'invalidValue',
        detail: `${purpose === 'filter' ? 'Filter' : 'Sort'} attribute '${path}' is unknown or not queryable.`,
        diagnostics: { errorCode: 'VALIDATION_FILTER', attributePaths: [path] },
      });
    }
    return attribute;
  }

  let canPush = true;
  function compile(node: FilterNode, parent = ''): (resource: Resource) => boolean {
    switch (node.type) {
      case 'logical': {
        const left = compile(node.left, parent);
        const right = compile(node.right, parent);
        return node.op === 'and' ? (r) => left(r) && right(r) : (r) => left(r) || right(r);
      }
      case 'not': {
        canPush = false;
        const child = compile(node.filter, parent);
        return (r) => !child(r);
      }
      case 'valuePath': {
        canPush = false;
        const qualified = parent ? `${parent}.${node.attrPath}` : node.attrPath;
        const attr = resolve(qualified, 'filter');
        if (attr.definition.type !== 'complex') {
          throw createScimError({
            status: 400,
            scimType: 'invalidFilter',
            detail: 'A valuePath requires a complex attribute.',
          });
        }
        const predicate = compile(node.filter, qualified);
        const path = parent ? node.attrPath.split('.') : attr.path;
        return (r) => {
          const values = valueAt(r, path);
          return (Array.isArray(values) ? values : [values]).some(
            (item) => !!item && typeof item === 'object' && predicate(item as Resource),
          );
        };
      }
      case 'compare': {
        const attr = resolve(parent ? `${parent}.${node.attrPath}` : node.attrPath, 'filter');
        const type = attr.definition.type ?? 'string';
        const ordering = ['gt', 'ge', 'lt', 'le'].includes(node.op);
        if (
          (ordering && ['boolean', 'complex', 'binary'].includes(type)) ||
          (['co', 'sw', 'ew'].includes(node.op) && !['string', 'reference'].includes(type))
        ) {
          throw createScimError({
            status: 400,
            scimType: 'invalidFilter',
            detail: `Operator '${node.op}' is not supported for '${type}'.`,
          });
        }
        // SQL NULL and collations do not implement SCIM missing/range semantics.
        // Retain indexed equality/substring push-down only where it is equivalent.
        if (
          ordering ||
          node.op === 'ne' ||
          (node.op !== 'pr' && node.value === null) ||
          type === 'dateTime' ||
          (node.value !== null &&
            node.op !== 'pr' &&
            typeof node.value !==
              (['integer', 'decimal'].includes(type)
                ? 'number'
                : type === 'boolean'
                  ? 'boolean'
                  : 'string'))
        ) {
          canPush = false;
        }
        const path = parent ? node.attrPath.split('.') : attr.path;
        const exact = new Set(attr.definition.caseExact ? ['value'] : []);
        const comparison = {
          ...node,
          attrPath: 'value',
          value: scalar(node.value, attr.definition),
        } as FilterNode;
        return (r) => {
          const actual = valueAt(r, path);
          const normalized = Array.isArray(actual)
            ? actual.map((item) => scalar(item, attr.definition))
            : scalar(actual, attr.definition);
          return evaluateFilter(comparison, { value: normalized }, exact);
        };
      }
    }
  }

  let predicate: ((r: Resource) => boolean) | undefined;
  if (params.filter) {
    let ast: FilterNode;
    try {
      ast = parseScimFilter(params.filter);
    } catch (error) {
      throw createScimError({
        status: 400,
        scimType: 'invalidFilter',
        detail: 'Invalid filter syntax.',
        diagnostics: {
          errorCode: 'FILTER_INVALID',
          filterExpression: params.filter,
          parseError: error instanceof Error ? error.message : 'Filter parser rejected the expression.',
        },
      });
    }
    predicate = compile(ast);
  }
  const sort = params.sortBy ? resolve(params.sortBy, 'sort') : undefined;
  const sortDefinition = sort?.definition;
  if (sortDefinition?.type === 'complex') {
    throw createScimError({
      status: 400,
      scimType: 'invalidValue',
      detail: 'Sort complex attributes by a queryable scalar child.',
    });
  }
  const startIndex = Math.max(Number.isFinite(params.startIndex) ? params.startIndex! : 1, 1);
  const count = Math.max(
    0,
    Math.min(Number.isFinite(params.count) ? params.count! : DEFAULT_COUNT, maxResults),
  );
  const shapes = new Map(
    [...attributes].map(([path, attribute]) => [
      path,
      {
        type: attribute.definition.type ?? 'string',
        multiValued: attribute.definition.multiValued ?? false,
      },
    ]),
  );
  const dbWhere = canPush ? buildFilter(params.filter, coreExact, shapes).dbWhere : {};

  return {
    dbWhere,
    page<T, R>(
      records: readonly T[],
      internal: (record: T) => Resource,
      project: (record: T) => R,
    ) {
      let candidates = records.map((record) => ({ record, value: internal(record) }));
      if (predicate) candidates = candidates.filter((candidate) => predicate(candidate.value));
      if (sort && sortDefinition) {
        const definition = sortDefinition;
        const direction = params.sortOrder === 'descending' ? -1 : 1;
        candidates.sort((a, b) => {
          const av = scalar(valueAt(a.value, sort.path, true), definition);
          const bv = scalar(valueAt(b.value, sort.path, true), definition);
          if (missing(av) || missing(bv))
            return (Number(missing(av)) - Number(missing(bv))) * direction;
          const left = typeof av === 'string' && !definition.caseExact ? av.toLowerCase() : av;
          const right = typeof bv === 'string' && !definition.caseExact ? bv.toLowerCase() : bv;
          return (left! < right! ? -1 : left! > right! ? 1 : 0) * direction;
        });
      }
      const Resources = candidates
        .slice(startIndex - 1, startIndex - 1 + count)
        .map((c) => project(c.record));
      return {
        totalResults: candidates.length,
        startIndex,
        itemsPerPage: Resources.length,
        Resources,
      };
    },
  };
}
