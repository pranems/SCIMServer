/**
 * Phase L5 - Discovery Explorer diff reducer (pure module).
 *
 * Compares two endpoints' discovery surfaces (Schemas, ResourceTypes,
 * ServiceProviderConfig) by classifying each attribute characteristic
 * change against the API's tighten-only partial order. Drives the
 * red/green/grey cell coloring on the side-by-side diff view.
 *
 * The classification mirrors
 * api/src/modules/scim/endpoint-profile/tighten-only-validator.ts so a
 * cell colored "tighten" represents a change the backend would accept
 * as a profile override. "relax" represents a change the backend would
 * reject. "incomparable" covers structural characteristics (type,
 * multiValued) that the validator already rejects outright.
 *
 * Missing-on-one-side semantics: per the project's
 * Schema-Characteristic Test Rule (RFC 7643 §2.2 + §7), a characteristic
 * absent from the published schema is taken to be the §2.2 default
 * BEFORE classification. That avoids "everything is missing-X" noise
 * when one endpoint omits the (default) value and the other publishes
 * it explicitly.
 *
 * @see web/src/utils/discovery-diff.test.ts (TDD spec)
 * @see api/src/modules/scim/endpoint-profile/tighten-only-validator.ts
 * @see docs/PHASE_L5_DISCOVERY_EXPLORER.md
 */

// ─── Public types ────────────────────────────────────────────────────

export type DiffStatus =
  | 'unchanged'
  | 'tighten'
  | 'relax'
  | 'incomparable'
  | 'only-a'
  | 'only-b';

export type CharacteristicKey =
  | 'required'
  | 'caseExact'
  | 'mutability'
  | 'returned'
  | 'uniqueness'
  | 'type'
  | 'multiValued';

/** Subset of ScimAttributeCharacteristic the diff reducer reads. */
export interface ScimAttributeForDiff {
  name: string;
  type?: string;
  required?: boolean;
  multiValued?: boolean;
  caseExact?: boolean;
  mutability?: string;
  returned?: string;
  uniqueness?: string;
  // Pass-through for richer renderers (sub-attributes, etc.).
  [key: string]: unknown;
}

export interface ScimSchemaForDiff {
  id: string;
  name?: string;
  attributes: ScimAttributeForDiff[];
}

export interface AttributeDiffRow {
  name: string;
  presence: 'both' | 'only-a' | 'only-b';
  /** Per-characteristic classification. Omitted on `only-*` rows. */
  characteristics: Record<CharacteristicKey, DiffStatus>;
  /** Raw values for renderers that want to print "before / after". */
  a?: ScimAttributeForDiff;
  b?: ScimAttributeForDiff;
}

export interface SchemaDiffSummary {
  tightenCount: number;
  relaxCount: number;
  unchangedCount: number;
  incomparableCount: number;
  onlyACount: number;
  onlyBCount: number;
}

export interface SchemaDiffResult {
  schemaId: string;
  rows: AttributeDiffRow[];
  summary: SchemaDiffSummary;
}

// ─── RFC 7643 §2.2 defaults (Schema-Characteristic Test Rule) ────────

export const RFC_DEFAULTS = {
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  multiValued: false,
  type: 'string',
} as const;

// ─── Partial-order rank tables (mirror the API algebra) ──────────────
//
// Lower rank = TIGHTER. Moving from a higher rank to a lower rank is
// a "tighten" classification. Moving up is "relax". Equal ranks
// (including both undefined -> default) are "unchanged".

const MUTABILITY_RANK: Record<string, number> = {
  readOnly: 0,
  immutable: 1,
  // writeOnly is allowed by RFC 7643 §7 but extremely rare; the API
  // validator has it at rank 2 so the diff reducer mirrors that.
  writeOnly: 2,
  readWrite: 3,
};

const UNIQUENESS_RANK: Record<string, number> = {
  global: 0,
  server: 1,
  none: 2,
};

// returned: 'never' is the most-restrictive sink (you cannot loosen
// it per RFC 7643 §7). The other three (always / default / request)
// are equally visible to the client per the spec wording, but
// 'always' arguably makes the attribute MORE visible than 'request'
// (which only returns when explicitly asked for). The tighten-only
// validator only forbids `never -> *`; for the diff reducer we keep
// the same coarse model: only `* -> never` is tighten, only
// `never -> *` is relax, everything else among the visible tier is
// classified by simple equality (unchanged) or as a horizontal move
// (incomparable would be misleading; we keep "unchanged" semantics
// for any visible-to-visible swap so the diff doesn't shout about
// equivalent tiers). We model that with a 2-rank table.
const RETURNED_RANK: Record<string, number> = {
  never: 0,
  // visible tier - all share rank 1 so visible-to-visible swaps are
  // "unchanged" (they don't represent a meaningful tighten/relax).
  always: 1,
  default: 1,
  request: 1,
};

// ─── Core classification ─────────────────────────────────────────────

/**
 * Substitute the RFC §2.2 default when a characteristic is missing.
 * Booleans and strings have different defaults; the table above
 * encodes both.
 */
function effective(key: CharacteristicKey, value: unknown): unknown {
  if (value !== undefined && value !== null) return value;
  // RFC_DEFAULTS is fully typed for these keys.
  return (RFC_DEFAULTS as Record<string, unknown>)[key];
}

/**
 * Classify a single characteristic change between endpoint A and B.
 * Pure function - no side effects, no React, no DOM.
 */
export function classifyCharacteristic(
  key: CharacteristicKey,
  rawA: unknown,
  rawB: unknown,
): DiffStatus {
  // type / multiValued are structural (RFC 7643 §7). Any change is
  // rejected by the API validator, so the diff reducer surfaces it
  // as "incomparable" - the cells should still color (red), but the
  // semantic is "this is not a tighten OR a relax, it's a structural
  // edit you cannot make".
  if (key === 'type' || key === 'multiValued') {
    const a = effective(key, rawA);
    const b = effective(key, rawB);
    return a === b ? 'unchanged' : 'incomparable';
  }

  const a = effective(key, rawA);
  const b = effective(key, rawB);

  // Boolean characteristics: required / caseExact (false -> true is tighten).
  if (key === 'required' || key === 'caseExact') {
    if (a === b) return 'unchanged';
    if (a === false && b === true) return 'tighten';
    if (a === true && b === false) return 'relax';
    // Defensive: any other value combination (shouldn't happen in
    // well-formed schemas) is incomparable.
    return 'incomparable';
  }

  // String-ranked characteristics.
  let table: Record<string, number> | undefined;
  if (key === 'mutability') table = MUTABILITY_RANK;
  else if (key === 'uniqueness') table = UNIQUENESS_RANK;
  else if (key === 'returned') table = RETURNED_RANK;

  if (!table) {
    // Unknown characteristic key - shouldn't compile through the
    // CharacteristicKey union, but be defensive at runtime.
    return a === b ? 'unchanged' : 'incomparable';
  }

  const rankA = table[String(a)];
  const rankB = table[String(b)];
  if (rankA === undefined || rankB === undefined) {
    // One side has a value the partial order doesn't recognize - we
    // can't classify direction, so call it incomparable (visible
    // diff, no green-tighten reward).
    return a === b ? 'unchanged' : 'incomparable';
  }
  if (rankA === rankB) return 'unchanged';
  // Lower rank = tighter. So if B has a STRICTLY lower rank than A,
  // B is tighter -> "tighten".
  return rankB < rankA ? 'tighten' : 'relax';
}

// ─── Schema-level walker ─────────────────────────────────────────────

const ALL_CHAR_KEYS: CharacteristicKey[] = [
  'required',
  'caseExact',
  'mutability',
  'returned',
  'uniqueness',
  'type',
  'multiValued',
];

function emptyRowChars(): Record<CharacteristicKey, DiffStatus> {
  return {
    required: 'unchanged',
    caseExact: 'unchanged',
    mutability: 'unchanged',
    returned: 'unchanged',
    uniqueness: 'unchanged',
    type: 'unchanged',
    multiValued: 'unchanged',
  };
}

/**
 * Walk every attribute in the union(A.attributes, B.attributes) and
 * produce one AttributeDiffRow per attribute name. Rows on both
 * sides classify each characteristic; rows on one side only carry
 * presence + the raw payload for the renderer to display.
 */
export function compareSchemas(
  a: ScimSchemaForDiff,
  b: ScimSchemaForDiff,
): SchemaDiffResult {
  const aMap = new Map<string, ScimAttributeForDiff>();
  for (const attr of a.attributes ?? []) {
    aMap.set(attr.name, attr);
  }
  const bMap = new Map<string, ScimAttributeForDiff>();
  for (const attr of b.attributes ?? []) {
    bMap.set(attr.name, attr);
  }

  const allNames = new Set<string>([...aMap.keys(), ...bMap.keys()]);

  const rows: AttributeDiffRow[] = [];
  const summary: SchemaDiffSummary = {
    tightenCount: 0,
    relaxCount: 0,
    unchangedCount: 0,
    incomparableCount: 0,
    onlyACount: 0,
    onlyBCount: 0,
  };

  for (const name of allNames) {
    const aAttr = aMap.get(name);
    const bAttr = bMap.get(name);

    if (aAttr && bAttr) {
      const chars = emptyRowChars();
      for (const key of ALL_CHAR_KEYS) {
        const status = classifyCharacteristic(
          key,
          (aAttr as Record<string, unknown>)[key],
          (bAttr as Record<string, unknown>)[key],
        );
        chars[key] = status;
        if (status === 'tighten') summary.tightenCount++;
        else if (status === 'relax') summary.relaxCount++;
        else if (status === 'unchanged') summary.unchangedCount++;
        else if (status === 'incomparable') summary.incomparableCount++;
      }
      rows.push({ name, presence: 'both', characteristics: chars, a: aAttr, b: bAttr });
    } else if (aAttr && !bAttr) {
      summary.onlyACount++;
      rows.push({ name, presence: 'only-a', characteristics: emptyRowChars(), a: aAttr });
    } else if (!aAttr && bAttr) {
      summary.onlyBCount++;
      rows.push({ name, presence: 'only-b', characteristics: emptyRowChars(), b: bAttr });
    }
  }

  // Stable ordering by attribute name keeps the diff view readable.
  rows.sort((x, y) => x.name.localeCompare(y.name));

  return { schemaId: a.id || b.id, rows, summary };
}
