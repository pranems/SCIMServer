/**
 * Phase M1 - patch-builder (pure RFC 7644 §3.5.2 PatchOp envelope).
 *
 * Operators: `add` / `remove` / `replace`.
 * - `remove` MUST have a path; value is omitted (not null) per RFC.
 * - `add` and `replace` MUST have a value (object / primitive / array).
 * - `add` at the root path-less form is allowed when value is an object.
 *
 * @see web/src/utils/patch-builder.test.ts (TDD spec)
 * @see docs/PHASE_M1_SCIM_WORKBENCH.md
 */

export const PATCH_OP_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export const PATCH_OP_NAMES = ['add', 'remove', 'replace'] as const;
export type PatchOpName = (typeof PATCH_OP_NAMES)[number];

export interface PatchOperation {
  op: PatchOpName;
  /** SCIM attribute path. Optional only on `add` at root with object value. */
  path: string;
  /** Value payload. Required for `add` / `replace`. Omitted for `remove`. */
  value?: unknown;
}

export interface PatchEnvelope {
  schemas: [typeof PATCH_OP_SCHEMA_URN];
  Operations: Array<{ op: PatchOpName; path?: string; value?: unknown }>;
}

/**
 * Assemble the canonical PatchOp envelope. Removes the `value` field
 * on `remove` ops (per RFC). Preserves order and path verbatim.
 */
export function buildPatchEnvelope(ops: PatchOperation[]): PatchEnvelope {
  const operations = ops.map((op) => {
    if (op.op === 'remove') {
      // RFC: remove ops carry only op + path; no value field.
      return { op: op.op, path: op.path };
    }
    return { op: op.op, path: op.path, value: op.value };
  });
  return {
    schemas: [PATCH_OP_SCHEMA_URN],
    Operations: operations,
  };
}

/**
 * Validate a single PatchOperation. Returns an array of error strings
 * (empty = valid). Used by the Workbench Send button to gate submit.
 */
export function validatePatchOp(op: PatchOperation): string[] {
  const errs: string[] = [];

  if (!PATCH_OP_NAMES.includes(op.op)) {
    errs.push(`Unknown op '${op.op}' - must be one of ${PATCH_OP_NAMES.join(', ')}`);
  }

  if (op.op === 'remove') {
    if (!op.path || op.path.trim().length === 0) {
      errs.push("Remove op requires a non-empty path");
    }
    return errs;
  }

  if (op.op === 'add' || op.op === 'replace') {
    // Path is optional ONLY for `add` at the root with an object value.
    const pathMissing = !op.path || op.path.trim().length === 0;
    if (pathMissing && op.op === 'replace') {
      errs.push("Replace op requires a path");
    }
    if (op.value === undefined) {
      errs.push(`${op.op} op requires a value`);
    }
    if (pathMissing && op.op === 'add' && (typeof op.value !== 'object' || op.value === null)) {
      errs.push("Add op without path requires an object value");
    }
  }

  return errs;
}

/**
 * Inverse of `buildPatchEnvelope` - parse a JSON string body and return
 * the structured operations, or null on parse failure / shape mismatch.
 * Used when the operator pastes a curl-style PatchOp body into the
 * Workbench body editor and clicks "Parse as PatchOp".
 */
export function parseCurlPatchBody(body: string): PatchOperation[] | null {
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    const ops = (parsed as Record<string, unknown>).Operations;
    if (!Array.isArray(ops)) return null;
    return ops.map((o) => ({
      op: (o as Record<string, unknown>).op as PatchOpName,
      path: ((o as Record<string, unknown>).path as string) ?? '',
      value: (o as Record<string, unknown>).value,
    }));
  } catch {
    return null;
  }
}
