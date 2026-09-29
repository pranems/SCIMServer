import {
  applyValuePathUpdate, removeValuePathEntry, addValuePathEntry,
  valuePathExpression, readResolvedProperty, withResolvedProperty,
} from '../../modules/scim/utils/scim-patch-path';
import type { SelectionPatchPath } from './patch-path';
import { PatchError } from './patch-error';

/** Shared selection mechanics; existing engines still own operation policies. */
export function applyPatchSelection(
  payload: Record<string, unknown>,
  parsed: SelectionPatchPath,
  op: string,
  value: unknown,
  caseExact: ReadonlySet<string> = new Set(),
  createOnMiss = false,
  allowUnmatchedRemove = false,
): Record<string, unknown> {
  const target = parsed.schemaUrn ? readResolvedProperty(payload, parsed.schemaUrn) : payload;
  const local = typeof target === 'object' && target !== null && !Array.isArray(target)
    ? target as Record<string, unknown> : {};
  const expression = valuePathExpression(parsed);
  let next: Record<string, unknown>;
  if (op === 'add' && createOnMiss) {
    next = addValuePathEntry(local, expression, value, caseExact);
  } else {
    const result = op === 'remove'
      ? removeValuePathEntry(local, expression, caseExact)
      : applyValuePathUpdate(local, expression, value, caseExact);
    if (!result.matched && !(op === 'remove' && allowUnmatchedRemove)) {
      throw new PatchError(400, 'PATCH selector did not match an existing value.', 'noTarget');
    }
    next = result.payload;
  }
  return parsed.schemaUrn ? withResolvedProperty(payload, parsed.schemaUrn, next) : next;
}
