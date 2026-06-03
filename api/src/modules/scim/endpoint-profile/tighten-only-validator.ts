/**
 * Tighten-Only Validator - Phase 13, Step 2.3
 *
 * Validates that attribute characteristic overrides only move in the
 * "tighter" direction relative to RFC 7643 baselines. Loosening is rejected.
 *
 * Rules (from design doc §3.3):
 *   required:    only false → true
 *   mutability:  readWrite > immutable > readOnly (only tighter)
 *   uniqueness:  none > server > global (only tighter)
 *   returned:    validated per direction
 *   caseExact:   only false → true
 *   type:        REJECT any change
 *   multiValued: REJECT any change
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.7 step 3 (TIGHTEN-ONLY)
 */
import type { ScimSchemaAttribute } from '../discovery/scim-schema-registry';

// ─── Ordinal Rankings (lower = tighter / more restrictive) ──────────────

const MUTABILITY_RANK: Record<string, number> = {
  readOnly: 0,
  immutable: 1,
  writeOnly: 2,
  readWrite: 3,
};

const UNIQUENESS_RANK: Record<string, number> = {
  global: 0,
  server: 1,
  none: 2,
};

// ─── Validation Result ──────────────────────────────────────────────────

export interface TightenOnlyError {
  schemaId: string;
  attributeName: string;
  characteristic: string;
  baselineValue: unknown;
  providedValue: unknown;
  message: string;
}

export interface TightenOnlyResult {
  valid: boolean;
  errors: TightenOnlyError[];
}

// ─── Core Validation ────────────────────────────────────────────────────

/**
 * Validate a single attribute override against its RFC baseline.
 * Returns an array of errors (empty = valid).
 */
export function validateAttributeTightenOnly(
  schemaId: string,
  provided: Partial<ScimSchemaAttribute>,
  baseline: ScimSchemaAttribute,
): TightenOnlyError[] {
  const errors: TightenOnlyError[] = [];
  const attrName = provided.name ?? baseline.name;

  // type - REJECT any change
  if (provided.type !== undefined && provided.type !== baseline.type) {
    errors.push({
      schemaId,
      attributeName: attrName,
      characteristic: 'type',
      baselineValue: baseline.type,
      providedValue: provided.type,
      message: `Cannot change 'type' from '${baseline.type}' to '${provided.type}' on '${attrName}' (${schemaId}). Type is structural and immutable per RFC 7643 §7.`,
    });
  }

  // multiValued - REJECT any change
  if (provided.multiValued !== undefined && provided.multiValued !== baseline.multiValued) {
    errors.push({
      schemaId,
      attributeName: attrName,
      characteristic: 'multiValued',
      baselineValue: baseline.multiValued,
      providedValue: provided.multiValued,
      message: `Cannot change 'multiValued' from ${baseline.multiValued} to ${provided.multiValued} on '${attrName}' (${schemaId}). multiValued is structural and immutable per RFC 7643 §7.`,
    });
  }

  // required - only false → true
  if (provided.required !== undefined && provided.required !== baseline.required) {
    if (baseline.required === true && provided.required === false) {
      errors.push({
        schemaId,
        attributeName: attrName,
        characteristic: 'required',
        baselineValue: baseline.required,
        providedValue: provided.required,
        message: `Cannot loosen 'required' from true to false on '${attrName}' (${schemaId}). RFC mandates required:true. Only tightening (false→true) is permitted.`,
      });
    }
    // false → true is always valid (tightening)
  }

  // mutability - only tighter (lower rank = tighter)
  if (provided.mutability !== undefined && provided.mutability !== baseline.mutability) {
    const baseRank = MUTABILITY_RANK[baseline.mutability ?? 'readWrite'];
    const provRank = MUTABILITY_RANK[provided.mutability];
    if (baseRank !== undefined && provRank !== undefined && provRank > baseRank) {
      errors.push({
        schemaId,
        attributeName: attrName,
        characteristic: 'mutability',
        baselineValue: baseline.mutability,
        providedValue: provided.mutability,
        message: `Cannot loosen 'mutability' from '${baseline.mutability}' to '${provided.mutability}' on '${attrName}' (${schemaId}). Only tightening is permitted (readWrite → immutable → readOnly).`,
      });
    }
  }

  // uniqueness - only tighter (lower rank = tighter)
  if (provided.uniqueness !== undefined && provided.uniqueness !== baseline.uniqueness) {
    const baseRank = UNIQUENESS_RANK[baseline.uniqueness ?? 'none'];
    const provRank = UNIQUENESS_RANK[provided.uniqueness];
    if (baseRank !== undefined && provRank !== undefined && provRank > baseRank) {
      errors.push({
        schemaId,
        attributeName: attrName,
        characteristic: 'uniqueness',
        baselineValue: baseline.uniqueness ?? 'none',
        providedValue: provided.uniqueness,
        message: `Cannot loosen 'uniqueness' from '${baseline.uniqueness ?? 'none'}' to '${provided.uniqueness}' on '${attrName}' (${schemaId}). Only tightening is permitted (none → server → global).`,
      });
    }
  }

  // caseExact - only false → true
  if (provided.caseExact !== undefined && provided.caseExact !== baseline.caseExact) {
    if (baseline.caseExact === true && provided.caseExact === false) {
      errors.push({
        schemaId,
        attributeName: attrName,
        characteristic: 'caseExact',
        baselineValue: baseline.caseExact,
        providedValue: provided.caseExact,
        message: `Cannot loosen 'caseExact' from true to false on '${attrName}' (${schemaId}). Only tightening (false→true) is permitted.`,
      });
    }
  }

  // returned - validate: cannot change 'never' to anything else (password)
  if (provided.returned !== undefined && provided.returned !== baseline.returned) {
    if (baseline.returned === 'never' && provided.returned !== 'never') {
      errors.push({
        schemaId,
        attributeName: attrName,
        characteristic: 'returned',
        baselineValue: baseline.returned,
        providedValue: provided.returned,
        message: `Cannot loosen 'returned' from 'never' to '${provided.returned}' on '${attrName}' (${schemaId}). Attributes with returned:never cannot be made visible.`,
      });
    }
  }

  return errors;
}
