import type { SchemaAttributeDefinition as Attribute } from '../validation/validation-types';
import { PatchError } from './patch-error';
import { objectValue, attribute, replacementState } from './patch-values';
import { retainedEntries } from '../retained-entries';
import { readResolvedProperty as read, withResolvedProperty as put } from '../../modules/scim/utils/scim-patch-path';

export const IGNORED_PATCH_VALUE = Symbol('ignored-readonly-patch-value');
export type ReadOnlyPolicy = { ignore: boolean; onIgnored?: (path: string) => void };
const hasReadOnly = (defs: readonly Attribute[]): boolean =>
  defs.some(def => def.mutability === 'readOnly' || (def.subAttributes && hasReadOnly(def.subAttributes)));

function retainedReadOnly(before: unknown, definitions: readonly Attribute[]): Record<string, unknown> {
  if (!objectValue(before)) return {};
  let result: Record<string, unknown> = {};
  for (const def of definitions) {
    const old = read(before, def.name);
    if (old === undefined) continue;
    if (def.mutability === 'readOnly') result = put(result, def.name, replacementState(old));
    else if (def.subAttributes && Array.isArray(old) && hasReadOnly(def.subAttributes)) {
      result = put(result, def.name, replacementState(old));
    }
    else if (def.subAttributes && objectValue(old)) {
      const child = retainedReadOnly(old, def.subAttributes);
      if (Object.keys(child).length) result = put(result, def.name, child);
    }
  }
  return result;
}

export function readOnlyValue(
  before: unknown, value: unknown, definition: Attribute | undefined, path: string, policy: ReadOnlyPolicy,
  op = 'replace',
): unknown {
  if (!definition) return value;
  if (definition.mutability === 'readOnly') {
    if (!policy.ignore) throw new PatchError(400, `Attribute '${path}' is readOnly and cannot be modified via PATCH.`, 'mutability');
    policy.onIgnored?.(path);
    return IGNORED_PATCH_VALUE;
  }
  const defs = definition.subAttributes;
  if (!defs || !hasReadOnly(defs)) return value;
  if (value == null) {
    if (Array.isArray(before)) {
      const preserved = before.map(entry => readOnlyValue(entry, null, { ...definition, multiValued: false }, path, policy, op)).filter(v => v !== null);
      return preserved.length ? preserved : value;
    }
    if (!objectValue(before)) return value;
    let preserved: Record<string, unknown> = {};
    for (const [key, old] of Object.entries(before)) {
      const result = readOnlyValue(old, null, attribute(defs, key), `${path}.${key}`, policy, op);
      if (result === IGNORED_PATCH_VALUE) preserved = put(preserved, key, old);
      else if (result != null) preserved = put(preserved, key, result);
    }
    return Object.keys(preserved).length ? preserved : value;
  }
  // At every add boundary a multi-valued entry is new, not a retained value.
  // Null is handled above because it follows the existing unassignment policy.
  if (op === 'add' && definition.multiValued) before = undefined;
  if (Array.isArray(value)) {
    const retained = retainedEntries(Array.isArray(before) ? before : [], value);
    return value.map((entry, index) =>
      readOnlyValue(retained[index], entry, { ...definition, multiValued: false }, path, policy, op));
  }
  if (!objectValue(value)) return value;
  let result = retainedReadOnly(before, defs);
  for (const [key, incoming] of Object.entries(value)) {
    const old = objectValue(before) ? read(before, key) : undefined;
    const permitted = readOnlyValue(old, incoming, attribute(defs, key), `${path}.${key}`, policy, op);
    if (permitted !== IGNORED_PATCH_VALUE) {
      result = put(result, key, incoming == null && permitted != null ? replacementState(permitted) : permitted);
    }
  }
  return result;
}
