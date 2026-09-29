import {
  parseScimFilter, evaluateFilter, resolveAttrPath,
  type FilterNode,
} from '../../modules/scim/filters/scim-filter-parser';
import { PatchError } from './patch-error';

export interface AttributePatchPath {
  kind: 'attribute';
  schemaUrn?: string;
  attribute: string;
  subAttribute?: string;
}

export interface SelectionPatchPath extends Omit<AttributePatchPath, 'kind'> {
  kind: 'selection';
  predicate: FilterNode;
}

export type ParsedPatchPath = AttributePatchPath | SelectionPatchPath;
const CORE_URNS = [
  'urn:ietf:params:scim:schemas:core:2.0:User',
  'urn:ietf:params:scim:schemas:core:2.0:Group',
];
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function assertAttributePath(path: string): void {
  if (!path.split('.').every(part =>
    /^[a-zA-Z$][a-zA-Z0-9_$-]*$/.test(part) && !FORBIDDEN.has(part.toLowerCase()),
  )) {
    throw new Error('Invalid attribute name or sub-attribute');
  }
}

function checkPredicate(node: FilterNode): void {
  switch (node.type) {
    case 'compare':
      assertAttributePath(node.attrPath);
      break;
    case 'logical':
      checkPredicate(node.left);
      checkPredicate(node.right);
      break;
    case 'not':
      checkPredicate(node.filter);
      break;
    case 'valuePath':
      throw new Error('Nested valuePath selectors are not supported');
  }
}

/**
 * Parse syntax only. Never retain selected records: each operation evaluates its
 * predicate against the current working payload. Registered URNs win over dots
 * in versions and colons or brackets inside quoted filter values.
 */
export function parsePatchPath(
  path: string,
  extensionUrns: readonly string[] = [],
  coreUrn?: string,
): ParsedPatchPath {
  try {
    if (typeof path !== 'string' || !path.trim() || path.length > 10_000) {
      throw new Error('Expected a non-empty path of at most 10000 characters');
    }
    let local = path.trim();
    let schemaUrn: string | undefined;
    const cores = coreUrn ? [coreUrn, ...CORE_URNS] : CORE_URNS;
    const known = [...extensionUrns, ...cores].sort((a, b) => b.length - a.length);
    const lower = local.toLowerCase();
    const urn = known.find(u => lower.startsWith(`${u.toLowerCase()}:`) || lower.startsWith(`${u.toLowerCase()}.`));
    if (urn) {
      if (!cores.some(c => c.toLowerCase() === urn.toLowerCase())) schemaUrn = urn;
      local = local.slice(urn.length + 1);
    } else if (lower.startsWith('urn:')) {
      const prefix = local.split('[', 1)[0];
      const colon = prefix.lastIndexOf(':');
      if (colon <= 3) throw new Error('Missing namespace attribute');
      // Compatibility for unregistered legacy URNs ending in a numeric version,
      // e.g. urn:example:ext:2.0.firmware. Never scan inside a predicate.
      const legacy = prefix.slice(colon + 1).match(/^\d+(?:\.\d+)*\./);
      const separator = legacy ? colon + legacy[0].length : colon;
      schemaUrn = local.slice(0, separator);
      local = local.slice(separator + 1);
    }

    const open = local.indexOf('[');
    if (open < 0) {
      assertAttributePath(local);
      const [attribute, ...sub] = local.split('.');
      return { kind: 'attribute', schemaUrn, attribute, subAttribute: sub.join('.') || undefined };
    }
    const attribute = local.slice(0, open);
    assertAttributePath(attribute);
    if (attribute.includes('.')) throw new Error('A valuePath must select a top-level attribute');
    let quoted = false;
    let escaped = false;
    let close = -1;
    for (let i = open + 1; i < local.length; i++) {
      const char = local[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (!quoted && char === '[') throw new Error('Nested valuePath selectors are not supported');
      if (!quoted && char === ']') { close = i; break; }
    }
    if (close < 0) throw new Error('Unclosed valuePath selector');
    const suffix = local.slice(close + 1);
    if (suffix && !suffix.startsWith('.')) throw new Error('Unexpected content after selector');
    const subAttribute = suffix ? suffix.slice(1) : undefined;
    if (subAttribute !== undefined) {
      assertAttributePath(subAttribute);
      if (subAttribute.includes('.')) throw new Error('Only one sub-attribute may follow a valuePath selector');
    }
    const predicate = parseScimFilter(local.slice(open + 1, close));
    checkPredicate(predicate);
    return { kind: 'selection', schemaUrn, attribute, subAttribute, predicate };
  } catch (error) {
    throw new PatchError(400, `Invalid PATCH path: ${(error as Error).message}.`, 'invalidPath');
  }
}

/** Attribute definition path, with the selector already parsed rather than stripped by regex. */
export function patchAttributePath(parsed: ParsedPatchPath): string {
  return [parsed.attribute, parsed.subAttribute].filter(Boolean).join('.');
}

/**
 * Use the full filter evaluator. The only PATCH compatibility conversion is a
 * quoted Boolean compared with an actual Boolean; string attributes stay strings.
 * caseExact is resolved for every leaf, including mixed compound predicates.
 */
export function matchesPatchSelection(
  parsed: SelectionPatchPath,
  item: Record<string, unknown>,
  caseExact: boolean | ReadonlySet<string> = false,
): boolean {
  const exact = new Set<string>();
  const adapt = (node: FilterNode): FilterNode => {
    if (node.type === 'logical') return { ...node, left: adapt(node.left), right: adapt(node.right) };
    if (node.type === 'not') return { ...node, filter: adapt(node.filter) };
    if (node.type !== 'compare') return node;
    const relative = `${parsed.attribute}.${node.attrPath}`.toLowerCase();
    const qualified = parsed.schemaUrn ? `${parsed.schemaUrn}:${relative}`.toLowerCase() : relative;
    if (caseExact === true || (typeof caseExact !== 'boolean' &&
        (caseExact.has(qualified) || (!parsed.schemaUrn && caseExact.has(relative))))) {
      exact.add(node.attrPath.toLowerCase());
    }
    const actual = resolveAttrPath(item, node.attrPath);
    if (typeof actual === 'boolean' && typeof node.value === 'string' && /^(true|false)$/i.test(node.value)) {
      return { ...node, value: node.value.toLowerCase() === 'true' };
    }
    return node;
  };
  return evaluateFilter(adapt(parsed.predicate), item, exact);
}
