import { SchemaValidator } from '../validation/schema-validator';
import type { SchemaDefinition, SchemaAttributeDefinition as Attribute } from '../validation/validation-types';
import { parsePatchPath, matchesPatchSelection, type ParsedPatchPath } from './patch-path';
import { PatchError } from './patch-error';
import type { PatchOperation } from './patch-types';
import {
  readResolvedProperty as read, withResolvedProperty as put, withoutResolvedProperty as omit,
  valuePathExpression, pruneEmptyExtensions,
} from '../../modules/scim/utils/scim-patch-path';
import { objectValue, attribute, assertSafe, immutableTransition, requiredValues, mergePatchValue, handoffPrimary } from './patch-values';
import { readOnlyValue, IGNORED_PATCH_VALUE, type ReadOnlyPolicy } from './patch-readonly';

export interface PatchExecutionOptions {
  schemaDefinitions?: readonly SchemaDefinition[];
  strictSchema?: boolean;
  ignoreReadOnly?: boolean;
  onReadOnlyIgnored?: (path: string) => void;
  extensionUrns?: readonly string[];
  coreUrn?: string;
  caseExactPaths?: ReadonlySet<string>;
  /** User-only historical VerbosePatchSupported=false behavior, not selector fallback. */
  literalDottedPaths?: boolean;
  literalUnregisteredUrns?: boolean;
  /** Historical User core equality-selector synthesis, not universal RFC semantics. */
  synthesizeCoreEqualityAdd?: boolean;
  normalize?: (candidate: Record<string, unknown>, operation: PatchOperation) => void;
}

export interface PatchResourceHooks {
  normalizeOperation?: (operation: PatchOperation) => PatchOperation;
  normalizeValue?: (path: ParsedPatchPath, value: unknown, op: string) => unknown;
  mutate?: (
    candidate: Record<string, unknown>, path: ParsedPatchPath, operation: PatchOperation,
  ) => Record<string, unknown> | undefined;
}

/** Shared, pure, operation-atomic executor. Resource adapters never implement attribute mutation. */
export class PatchExecutor {
  private payload: Record<string, unknown>;
  private index = 0;
  constructor(
    payload: Record<string, unknown>,
    private readonly options: PatchExecutionOptions = {},
    private readonly hooks: PatchResourceHooks = {},
  ) {
    this.payload = structuredClone(payload);
  }

  apply(input: PatchOperation): void {
    const index = this.index++;
    try {
      let operation = this.hooks.normalizeOperation?.(input) ?? input;
      const op = operation.op?.toLowerCase();
      if (!['add', 'replace', 'remove'].includes(op)) {
        throw new PatchError(400, `Patch operation '${operation.op}' is not supported.`, 'invalidValue');
      }
      if (!operation.path && objectValue(operation.value)) {
        operation = { ...operation, value: Object.fromEntries(Object.entries(operation.value)
          .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key))) };
      }
      assertSafe(operation.value);
      const before = this.payload;
      let candidate = structuredClone(before);
      if (operation.path) {
        candidate = this.atPath(candidate, { ...operation, op });
      } else {
        if (op === 'remove') throw new PatchError(400, 'Remove operation requires a path.', 'noTarget');
        if (!objectValue(operation.value)) throw new PatchError(400, 'PATCH without path requires an object value.', 'invalidValue');
        for (const [key, value] of Object.entries(operation.value)) {
          if (['schemas', 'meta'].includes(key.toLowerCase())) continue;
          candidate = this.atPath(candidate, { op, path: key, value });
        }
      }
      this.options.normalize?.(candidate, operation);
      this.checkRequired(candidate, before, operation);
      this.payload = candidate;
    } catch (error) {
      if (error instanceof PatchError && error.operationIndex === undefined) {
        throw new PatchError(error.status, error.message, error.scimType, {
          operationIndex: index, path: input.path, op: input.op,
        });
      }
      throw error;
    }
  }

  getResult(): Record<string, unknown> {
    const result = structuredClone(this.payload);
    pruneEmptyExtensions(result, this.options.extensionUrns ?? []);
    return result;
  }

  private definitions(path: ParsedPatchPath): readonly Attribute[] | undefined {
    const schemas = this.options.schemaDefinitions;
    return path.schemaUrn
      ? schemas?.find(s => s.id.toLowerCase() === path.schemaUrn?.toLowerCase())?.attributes
      : schemas?.filter(s => s.isCoreSchema ?? s.id.startsWith('urn:ietf:params:scim:schemas:core:')).flatMap(s => [...s.attributes]);
  }

  private parse(path: string): ParsedPatchPath {
    const namespace = this.options.extensionUrns?.find(u => u.toLowerCase() === path.toLowerCase());
    return namespace ? { kind: 'attribute', schemaUrn: namespace, attribute: '' }
      : parsePatchPath(path, this.options.extensionUrns, this.options.coreUrn);
  }

  private atPath(payload: Record<string, unknown>, operation: PatchOperation): Record<string, unknown> {
    const parsed = this.parse(operation.path!);
    if (this.hooks.normalizeValue) {
      operation = { ...operation, value: this.hooks.normalizeValue(parsed, operation.value, operation.op) };
    }
    const definitions = this.definitions(parsed);
    // Namespace-only no-path blocks and explicit namespace paths share ordinary attribute execution.
    if (parsed.schemaUrn && !parsed.attribute) {
      if (operation.op === 'remove' || operation.value === null) {
        const before = read(payload, parsed.schemaUrn);
        const after = readOnlyValue(before, null, {
          name: parsed.schemaUrn, type: 'complex', multiValued: false, required: false, subAttributes: definitions,
        }, parsed.schemaUrn, this.readOnlyPolicy());
        for (const def of definitions ?? []) immutableTransition(
          objectValue(before) ? read(before, def.name) : undefined,
          objectValue(after) ? read(after, def.name) : undefined, def,
        );
        return after == null ? omit(payload, parsed.schemaUrn) : put(payload, parsed.schemaUrn, after);
      }
      if (!objectValue(operation.value)) throw new PatchError(400, 'Extension namespace requires an object.', 'invalidValue');
      for (const [key, value] of Object.entries(operation.value)) {
        payload = this.atPath(payload, { ...operation, path: `${parsed.schemaUrn}:${key}`, value });
      }
      return payload;
    }
    const def = attribute(definitions, parsed.attribute);
    if (parsed.kind === 'selection' && this.options.schemaDefinitions?.length &&
        (!def || !def.multiValued || def.type !== 'complex' ||
          (parsed.subAttribute && !attribute(def.subAttributes, parsed.subAttribute)))) {
      throw new PatchError(400, 'PATCH selector does not resolve to a declared multi-valued target.', 'invalidPath');
    }
    if (parsed.kind === 'selection' && !Array.isArray(read(parsed.schemaUrn
      ? read(payload, parsed.schemaUrn) as Record<string, unknown> ?? {} : payload, parsed.attribute)) &&
      !this.options.synthesizeCoreEqualityAdd) {
      throw new PatchError(400, 'PATCH selector did not match an existing value.', 'noTarget');
    }
    const chain = [def];
    for (const segment of parsed.subAttribute?.split('.') ?? []) chain.push(attribute(chain[chain.length - 1]?.subAttributes, segment));
    const readOnly = chain.find(a => a?.mutability === 'readOnly');
    if (readOnly) {
      const permitted = readOnlyValue(undefined, operation.value, readOnly, operation.path!, this.readOnlyPolicy());
      if (permitted === IGNORED_PATCH_VALUE) return payload;
    }
    const hooked = this.hooks.mutate?.(payload, parsed, operation);
    if (hooked) return hooked;
    if (this.options.strictSchema && this.options.schemaDefinitions?.length) {
      const validation = SchemaValidator.validatePatchOperationValue(
        operation.op, operation.path, operation.value, this.options.schemaDefinitions,
      );
      if (!validation.valid) throw new PatchError(400, validation.errors.map(e => e.message).join('; '), validation.errors[0].scimType);
    }
    const namespace = parsed.schemaUrn ? read(payload, parsed.schemaUrn) : payload;
    const local = objectValue(namespace) ? namespace : {};
    if (this.options.literalUnregisteredUrns && parsed.schemaUrn && parsed.kind !== 'selection' &&
      !(this.options.extensionUrns ?? []).some(urn => urn.toLowerCase() === parsed.schemaUrn?.toLowerCase())) {
      const value = this.value(read(payload, operation.path!), operation);
      return value === undefined ? omit(payload, operation.path!) : put(payload, operation.path!, value);
    }
    const literal = this.options.literalDottedPaths && !parsed.schemaUrn && parsed.kind !== 'selection';
    const key = literal && parsed.subAttribute ? `${parsed.attribute}.${parsed.subAttribute}` : def?.name ?? parsed.attribute;
    const old = read(local, key);
    if (parsed.schemaUrn && parsed.kind !== 'selection' && !parsed.subAttribute &&
      (operation.value === '' || (objectValue(operation.value) && Object.keys(operation.value).length === 1 &&
        'value' in operation.value && (operation.value.value == null || operation.value.value === '')))) {
      operation = { ...operation, value: null };
    }
    let next: unknown;
    if (parsed.kind === 'selection') {
      const list = Array.isArray(old) ? old : [];
      const selected = list.map((entry, i) => objectValue(entry) && matchesPatchSelection(parsed, entry, this.options.caseExactPaths) ? i : -1).filter(i => i >= 0);
      if (!selected.length) {
        const expression = valuePathExpression(parsed);
        if (operation.op !== 'add' || !this.options.synthesizeCoreEqualityAdd || parsed.schemaUrn ||
            expression.predicate || expression.filterOperator !== 'eq') {
          throw new PatchError(400, 'PATCH selector did not match an existing value.', 'noTarget');
        }
        const seed = put({}, expression.filterAttribute, expression.filterValue);
        const elementDef = def && { ...def, multiValued: false };
        const incoming = mergePatchValue(seed, parsed.subAttribute
          ? { [parsed.subAttribute]: operation.value } : operation.value, 'add', elementDef);
        const entry = this.value(undefined, { ...operation, value: incoming }, elementDef);
        if (!objectValue(entry)) throw new PatchError(400, 'A selected complex value must be an object.', 'invalidValue');
        next = handoffPrimary([...list, entry],
          new Set(objectValue(entry) && read(entry, 'primary') === true ? [list.length] : []));
      } else {
        const selectedSet = new Set(selected);
        const primaries = new Set<number>();
        next = list.flatMap((entry, i) => {
          if (!selectedSet.has(i)) return [entry];
          if (!parsed.subAttribute && (operation.op === 'remove' || operation.value === null)) {
            if (def?.mutability === 'immutable') immutableTransition(old, undefined, def);
            return [];
          }
          const item = parsed.subAttribute
            ? this.child(entry as Record<string, unknown>, parsed.subAttribute.split('.'), operation, def?.subAttributes)
            : this.value(entry, operation, def && { ...def, multiValued: false });
          if (!objectValue(item)) throw new PatchError(400, 'A selected complex value must be an object.', 'invalidValue');
          if ((parsed.subAttribute?.toLowerCase() === 'primary' && operation.value === true) ||
              (!parsed.subAttribute && objectValue(operation.value) && read(operation.value, 'primary') === true)) primaries.add(i);
          return [item];
        });
        next = handoffPrimary(next as unknown[], primaries);
      }
    } else if (parsed.subAttribute && !literal) {
      const segments = parsed.subAttribute.split('.');
      next = Array.isArray(old)
        ? old.map(entry => this.child(objectValue(entry) ? entry : {}, segments, operation, def?.subAttributes))
        : this.child(objectValue(old) ? old : {}, segments, operation, def?.subAttributes);
    } else {
      next = this.value(old, operation, def);
    }
    if (def?.mutability === 'immutable') immutableTransition(old, next, def);
    const updated = next === undefined ? omit(local, key) : put(local, key, next);
    return parsed.schemaUrn ? put(payload, parsed.schemaUrn, updated) : updated;
  }

  private value(before: unknown, operation: PatchOperation, def?: Attribute): unknown {
    const permitted = readOnlyValue(before,
      operation.op === 'remove' ? null : operation.value, def, operation.path ?? '', this.readOnlyPolicy(), operation.op);
    if (permitted === IGNORED_PATCH_VALUE) return before;
    const removing = operation.op === 'remove' || operation.value == null;
    const next = removing ? permitted ?? undefined : mergePatchValue(before, permitted, operation.op, def);
    immutableTransition(before, next, def);
    return next;
  }

  private readOnlyPolicy(): ReadOnlyPolicy {
    return { ignore: this.options.ignoreReadOnly ?? !this.options.strictSchema, onIgnored: this.options.onReadOnlyIgnored };
  }

  private child(parent: Record<string, unknown>, segments: string[], operation: PatchOperation, defs?: readonly Attribute[]): Record<string, unknown> {
    const [key, ...tail] = segments;
    const def = attribute(defs, key);
    const old = read(parent, key);
    const next = tail.length
      ? this.child(objectValue(old) ? old : {}, tail, operation, def?.subAttributes)
      : this.value(old, operation, def);
    if (def?.mutability === 'immutable') immutableTransition(old, next, def);
    return next === undefined ? omit(parent, key) : put(parent, def?.name ?? key, next);
  }

  private checkRequired(candidate: Record<string, unknown>, before: Record<string, unknown>, operation: PatchOperation): void {
    // Check touched roots only. Existing unrelated invalid data must not block a PATCH.
    const paths = operation.path ? [operation.path] : Object.keys(operation.value as Record<string, unknown>);
    for (const path of paths) {
      const parsed = this.parse(path);
      const local = parsed.schemaUrn ? read(candidate, parsed.schemaUrn) : candidate;
      const previous = parsed.schemaUrn ? read(before, parsed.schemaUrn) : before;
      const defs = this.definitions(parsed) ?? [];
      const touched = parsed.attribute ? defs.filter(d => d.name.toLowerCase() === parsed.attribute.toLowerCase()) : defs;
      if (!local && !previous) continue;
      for (const def of touched) {
        const next = objectValue(local) ? read(local, def.name) : undefined;
        requiredValues(next, def);
        immutableTransition(objectValue(previous) ? read(previous, def.name) : undefined, next, def);
      }
    }
  }
}
