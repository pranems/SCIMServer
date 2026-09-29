import { parsePatchTarget, type ParsedPatchPath } from './patch-path';
import type { PatchOperation } from './patch-types';

/** Client-specified attribute paths, not the complete merged response or selector predicates. */
export function patchSuppliedPaths(
  operations: readonly PatchOperation[],
  extensionUrns: readonly string[],
  coreUrn?: string,
): ReadonlySet<string> {
  const paths = new Set<string>();
  const supplied = (path: string, value: unknown): void => {
    if (value == null) return;
    paths.add(path.toLowerCase());
    if (Array.isArray(value)) {
      value.forEach(item => supplied(path, item));
    } else if (typeof value === 'object') {
      const namespace = extensionUrns.some(urn => urn.toLowerCase() === path.toLowerCase());
      for (const [key, child] of Object.entries(value)) {
        supplied(`${path}${namespace ? ':' : '.'}${key}`, child);
      }
    }
  };
  const target = (path: string, value: unknown): void => {
    let parsed: ParsedPatchPath;
    try {
      parsed = parsePatchTarget(path, extensionUrns, coreUrn);
    } catch {
      // Execution owns indexed syntax errors; projection must not replace them.
      return;
    }
    let prefix = parsed.schemaUrn ?? '';
    if (prefix) paths.add(prefix.toLowerCase());
    for (const segment of [parsed.attribute, ...(parsed.subAttribute?.split('.') ?? [])].filter(Boolean)) {
      prefix = prefix ? `${prefix}${prefix === parsed.schemaUrn ? ':' : '.'}${segment}` : segment;
      // A supplied sub-attribute also requests its enclosing complex value.
      if (value != null) paths.add(prefix.toLowerCase());
    }
    supplied(prefix, value);
  };
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (!operation || typeof operation.op !== 'string') continue;
    if (operation.op.toLowerCase() === 'remove') continue;
    if (operation.path) target(operation.path, operation.value);
    else if (operation.value && typeof operation.value === 'object' && !Array.isArray(operation.value)) {
      for (const [key, value] of Object.entries(operation.value)) {
        if (!['schemas', 'id', 'meta', '__proto__', 'constructor', 'prototype'].includes(key.toLowerCase())) target(key, value);
      }
    }
  }
  return paths;
}
