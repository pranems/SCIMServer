/**
 * Phase M1 - filter-builder (pure RFC 7644 §3.4.2.2 emitter + parser).
 *
 * Operators (RFC 7644 §3.4.2.2):
 *   eq  - equal              co  - contains
 *   ne  - not equal          sw  - starts with
 *   pr  - present (unary)    ew  - ends with
 *   gt/ge/lt/le              (numeric comparisons)
 *
 * The Workbench drives this via either:
 *   - free text (operator types `userName eq "alice"` directly), OR
 *   - a structured form that emits `FilterClause` and we serialize.
 *
 * Compound parsing (a co "x" and b eq "y") is intentionally NOT in
 * the M1 parser - the M1 parser handles a single atom only, which
 * covers ~80 % of operator filter usage. Compound visual builder is
 * deferred to N6 (conversational filter builder).
 *
 * @see web/src/utils/filter-builder.test.ts (TDD spec)
 * @see docs/PHASE_M1_SCIM_WORKBENCH.md
 */

export const FILTER_OPERATORS = [
  'eq', 'ne', 'co', 'sw', 'ew', 'pr', 'gt', 'ge', 'lt', 'le',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterAtom {
  attribute: string;
  operator: FilterOperator;
  /** Undefined for unary `pr`; primitive (string / number / boolean) otherwise. */
  value?: string | number | boolean;
}

export type FilterClause =
  | { kind: 'atom'; atom: FilterAtom }
  | { kind: 'compound'; conjunction: 'and' | 'or'; clauses: FilterClause[] };

const UNARY_OPS: FilterOperator[] = ['pr'];

function renderValue(value: unknown): string {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // null / undefined / object - render empty so caller's validatePatch
  // surface catches the mistake earlier.
  return '';
}

function renderAtom(a: FilterAtom): string {
  if (UNARY_OPS.includes(a.operator)) {
    return `${a.attribute} ${a.operator}`;
  }
  return `${a.attribute} ${a.operator} ${renderValue(a.value)}`;
}

export function buildFilterString(clause: FilterClause | null | undefined): string {
  if (!clause) return '';
  if (clause.kind === 'atom') return renderAtom(clause.atom);
  // compound
  if (clause.clauses.length === 0) return '';
  if (clause.clauses.length === 1) return buildFilterString(clause.clauses[0]);
  const parts = clause.clauses
    .map((c) => buildFilterString(c))
    .filter((s) => s.length > 0)
    .map((s) => `(${s})`);
  return parts.join(` ${clause.conjunction} `);
}

// ─── parseSimpleFilter (single-atom inverse) ─────────────────────────

/**
 * Parses a single-atom filter expression of the form
 *   `attr op` (unary) or `attr op value`.
 *
 * Compound expressions (with `and` / `or`) are NOT parsed in M1;
 * returns null for those. The Workbench surfaces a small "advanced"
 * affordance pointing at N6 conversational filter builder.
 */
export function parseSimpleFilter(input: string): FilterClause | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Reject obvious compound expressions early so we don't half-parse.
  if (/\s(and|or)\s/i.test(trimmed)) return null;

  // Unary: `attr op`
  const unaryMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_.:-]*)\s+([a-z]{2})$/);
  if (unaryMatch) {
    const op = unaryMatch[2] as FilterOperator;
    if (!UNARY_OPS.includes(op)) return null;
    return {
      kind: 'atom',
      atom: { attribute: unaryMatch[1], operator: op },
    };
  }

  // Binary: `attr op value`. Value may be quoted ("...") with escaped
  // double-quotes, or unquoted (boolean / number).
  const binaryMatch = trimmed.match(
    /^([A-Za-z][A-Za-z0-9_.:-]*)\s+([a-z]{2})\s+(.+)$/,
  );
  if (!binaryMatch) return null;
  const op = binaryMatch[2] as FilterOperator;
  if (!FILTER_OPERATORS.includes(op) || UNARY_OPS.includes(op)) return null;

  const rawValue = binaryMatch[3].trim();
  let value: string | number | boolean;

  if (rawValue.startsWith('"') && rawValue.endsWith('"') && rawValue.length >= 2) {
    // Quoted string - unescape \\ and \"
    value = rawValue
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  } else if (rawValue === 'true' || rawValue === 'false') {
    value = rawValue === 'true';
  } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    value = Number(rawValue);
  } else {
    // Unquoted alphanumeric -> not RFC-canonical; reject so the operator
    // gets a clear feedback signal instead of a silently-wrong filter.
    return null;
  }

  return {
    kind: 'atom',
    atom: { attribute: binaryMatch[1], operator: op, value },
  };
}
