import type { SchemaAttributeDefinition as Attribute } from '../validation/validation-types';
import { SchemaValidator } from '../validation/schema-validator';
import { PatchError } from './patch-error';
import { retainedEntries } from '../retained-entries';
import { readResolvedProperty as read, withResolvedProperty as put, withoutResolvedProperty as omit } from '../../modules/scim/utils/scim-patch-path';

export { retainedEntries } from '../retained-entries';

export const objectValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const assigned = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
export const attribute = (attributes: readonly Attribute[] | undefined, key: string): Attribute | undefined =>
  attributes?.find(a => a.name.toLowerCase() === key.toLowerCase());
const REPLACEMENT_STATE = Symbol('patch-replacement-state');
/** Preserved server state is replacement state, never client append input. */
export const replacementState = (value: unknown): Record<symbol, unknown> => ({ [REPLACEMENT_STATE]: value });

export function assertSafe(value: unknown): void {
  if (Array.isArray(value)) value.forEach(assertSafe);
  else if (objectValue(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw new PatchError(400, 'PATCH contains a forbidden property.', 'invalidPath');
      }
      assertSafe(child);
    }
  }
}

/** A full-state transition, unlike PUT's partial incoming-value comparison. */
export function immutableTransition(before: unknown, after: unknown, def?: Attribute): void {
  if (!def) return;
  if (def.mutability === 'immutable' && assigned(before) && !SchemaValidator.deepEqual(before, after)) {
    throw new PatchError(400, `Attribute '${def.name}' is immutable and cannot be changed once set.`, 'mutability');
  }
  if (objectValue(before)) {
    for (const sub of def.subAttributes ?? []) {
      immutableTransition(read(before, sub.name), objectValue(after) ? read(after, sub.name) : undefined, sub);
    }
  }
  if (Array.isArray(before) && Array.isArray(after) && def.subAttributes) {
    // Like the existing resource comparator, retained SCIM entries are identified
    // by value. Removing an entry and adding a different identity remains legal.
    const retained = retainedEntries(before, after);
    for (const [index, entry] of after.entries()) {
      const old = retained[index];
      if (!old) continue;
      immutableTransition(old, entry, { ...def, multiValued: false, mutability: 'readWrite' });
    }
  }
}

export function requiredValues(value: unknown, def: Attribute): void {
  if (def.mutability === 'readOnly') return;
  if (def.required && !assigned(value)) {
    throw new PatchError(400, `Required attribute '${def.name}' cannot be unassigned.`, 'invalidValue');
  }
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    if (!objectValue(entry)) continue;
    for (const sub of def.subAttributes ?? []) requiredValues(read(entry, sub.name), sub);
  }
}

export function handoffPrimary(values: unknown[], selected: ReadonlySet<number>): unknown[] {
  if (!selected.size) return values;
  return values.map((entry, index) => objectValue(entry) && !selected.has(index) && read(entry, 'primary') === true
    ? put(entry, 'primary', false) : entry);
}

/** Complex PATCH is a partial merge. Only add appends at multi-valued leaves. */
export function mergePatchValue(before: unknown, value: unknown, op: string, def?: Attribute): unknown {
  if (objectValue(value) && REPLACEMENT_STATE in value) return value[REPLACEMENT_STATE];
  if (value === null || value === undefined) return undefined;
  if ((def?.multiValued || Array.isArray(before)) && op === 'add') {
    const values = Array.isArray(value) ? value : [value];
    if (values.some(v => v == null || Array.isArray(v))) {
      throw new PatchError(400, 'Multi-valued attribute contains an invalid element.', 'invalidValue');
    }
    const incoming = values.map(entry => mergePatchValue(undefined, entry, op, def && { ...def, multiValued: false }));
    const old = Array.isArray(before) ? before : [];
    const selected = new Set<number>();
    incoming.forEach((entry, i) => {
      if (objectValue(entry) && read(entry, 'primary') === true) selected.add(old.length + i);
    });
    return handoffPrimary([...old, ...incoming], selected);
  }
  if (objectValue(value)) {
    let result = objectValue(before) ? { ...before } : {};
    for (const [key, child] of Object.entries(value)) {
      const sub = attribute(def?.subAttributes, key);
      const canonical = sub?.name ?? key;
      const next = mergePatchValue(read(result, key), child, op, sub);
      result = next === undefined ? omit(result, key) : put(result, canonical, next);
    }
    return result;
  }
  if (Array.isArray(value) && value.some(v => v == null || Array.isArray(v))) {
    throw new PatchError(400, 'Multi-valued attribute contains an invalid element.', 'invalidValue');
  }
  if (Array.isArray(value)) {
    return value.map(entry => mergePatchValue(undefined, entry, op, def && { ...def, multiValued: false }));
  }
  return value;
}
