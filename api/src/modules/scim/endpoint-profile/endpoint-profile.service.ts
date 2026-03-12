/**
 * Endpoint Profile Service (Orchestrator) — Phase 13, Step 2.5
 *
 * Runs the complete 6-step validation pipeline:
 *   1. AUTO-EXPAND  — Fill missing fields from RFC baseline
 *   2. AUTO-INJECT  — Add required structural attributes
 *   3. TIGHTEN-ONLY — Verify overrides are same-or-tighter
 *   4. SPC-TRUTHFUL — Verify SPC only claims implemented capabilities
 *   5. STORE        — (caller's responsibility — returns expanded profile)
 *   6. HYDRATE      — (caller's responsibility — registry update)
 *
 * This is a pure function module (no NestJS DI needed for Phase 2).
 * Will become an @Injectable() NestJS service in Phase 3.
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.7
 */
import type { EndpointProfile, ShorthandProfileInput, ServiceProviderConfig } from './endpoint-profile.types';
import { expandProfile } from './auto-expand.service';
import { validateAttributeTightenOnly, type TightenOnlyError } from './tighten-only-validator';
import { RFC_SCHEMA_ATTRIBUTE_MAPS } from './rfc-baseline';

// ─── Validation Result ──────────────────────────────────────────────────

export interface ProfileValidationError {
  code: string;
  detail: string;
}

export interface ProfileValidationResult {
  valid: boolean;
  errors: ProfileValidationError[];
  profile?: EndpointProfile;
}

// ─── SPC Truthfulness ───────────────────────────────────────────────────

/**
 * Server capabilities that are always implemented (hardcoded in the server).
 * SPC cannot claim capabilities beyond what the server actually supports.
 */
const SERVER_CAPABILITIES = {
  patch: true,       // PATCH engine is always available
  bulk: true,        // Bulk controller exists (gated per-endpoint by SPC)
  filter: true,      // Filter engine is always available
  sort: true,        // Sort engine is always available
  etag: true,        // ETag support is always available
  changePassword: false, // Not implemented
};

function validateSpcTruthfulness(spc: ServiceProviderConfig): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];

  // changePassword — we don't implement this
  if (spc.changePassword?.supported === true && !SERVER_CAPABILITIES.changePassword) {
    errors.push({
      code: 'SPC_UNIMPLEMENTED',
      detail: 'ServiceProviderConfig claims changePassword.supported=true but the server does not implement password change.',
    });
  }

  // filter.maxResults sanity
  if (spc.filter?.supported && spc.filter.maxResults !== undefined) {
    if (spc.filter.maxResults < 1 || spc.filter.maxResults > 10000) {
      errors.push({
        code: 'SPC_INVALID_VALUE',
        detail: `ServiceProviderConfig filter.maxResults must be between 1 and 10000, got ${spc.filter.maxResults}.`,
      });
    }
  }

  // bulk sanity
  if (spc.bulk?.supported) {
    if (spc.bulk.maxOperations !== undefined && spc.bulk.maxOperations < 1) {
      errors.push({
        code: 'SPC_INVALID_VALUE',
        detail: `ServiceProviderConfig bulk.maxOperations must be >= 1, got ${spc.bulk.maxOperations}.`,
      });
    }
  }

  return errors;
}

// ─── Tighten-Only Validation ────────────────────────────────────────────

function runTightenOnlyValidation(profile: EndpointProfile): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];

  for (const schema of profile.schemas) {
    const attrMap = RFC_SCHEMA_ATTRIBUTE_MAPS.get(schema.id);
    if (!attrMap) continue; // Custom schema — no baseline to compare against

    for (const attr of schema.attributes) {
      const baseline = attrMap.get(attr.name.toLowerCase());
      if (!baseline) continue; // Custom attribute within a known schema — no baseline

      const attrErrors = validateAttributeTightenOnly(schema.id, attr, baseline);
      for (const err of attrErrors) {
        errors.push({
          code: 'TIGHTEN_ONLY_VIOLATION',
          detail: err.message,
        });
      }
    }
  }

  return errors;
}

// ─── Structural Validation ──────────────────────────────────────────────

function validateStructure(profile: EndpointProfile): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];

  // Must have at least one schema
  if (!profile.schemas || profile.schemas.length === 0) {
    errors.push({ code: 'MISSING_SCHEMAS', detail: 'Profile must contain at least one schema.' });
  }

  // Must have at least one resource type
  if (!profile.resourceTypes || profile.resourceTypes.length === 0) {
    errors.push({ code: 'MISSING_RESOURCE_TYPES', detail: 'Profile must contain at least one resourceType.' });
  }

  // Every resource type's core schema must exist in schemas[]
  const schemaIds = new Set(profile.schemas.map(s => s.id));
  for (const rt of profile.resourceTypes) {
    if (!schemaIds.has(rt.schema)) {
      errors.push({
        code: 'RT_MISSING_SCHEMA',
        detail: `ResourceType "${rt.name}" references schema "${rt.schema}" which is not in the schemas array.`,
      });
    }
    for (const ext of rt.schemaExtensions) {
      if (!schemaIds.has(ext.schema)) {
        errors.push({
          code: 'RT_MISSING_EXTENSION_SCHEMA',
          detail: `ResourceType "${rt.name}" references extension schema "${ext.schema}" which is not in the schemas array.`,
        });
      }
    }
  }

  // Schemas must have unique IDs
  const seenIds = new Set<string>();
  for (const s of profile.schemas) {
    if (seenIds.has(s.id)) {
      errors.push({ code: 'DUPLICATE_SCHEMA', detail: `Duplicate schema id: "${s.id}".` });
    }
    seenIds.add(s.id);
  }

  // Resource types must have unique names
  const seenRtNames = new Set<string>();
  for (const rt of profile.resourceTypes) {
    if (seenRtNames.has(rt.name)) {
      errors.push({ code: 'DUPLICATE_RT', detail: `Duplicate resource type name: "${rt.name}".` });
    }
    seenRtNames.add(rt.name);
  }

  return errors;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Validate and expand a shorthand profile input into a full EndpointProfile.
 *
 * Runs the complete pipeline:
 *   expand → inject → tighten-only → SPC truthfulness → structural
 *
 * Returns the expanded profile if valid, or errors if not.
 */
export function validateAndExpandProfile(input: ShorthandProfileInput): ProfileValidationResult {
  // Step 1+2: Auto-expand + auto-inject
  let profile: EndpointProfile;
  try {
    profile = expandProfile(input);
  } catch (err: any) {
    return {
      valid: false,
      errors: [{ code: 'EXPAND_ERROR', detail: err.message }],
    };
  }

  const allErrors: ProfileValidationError[] = [];

  // Step 3: Tighten-only validation
  allErrors.push(...runTightenOnlyValidation(profile));

  // Step 4: SPC truthfulness
  allErrors.push(...validateSpcTruthfulness(profile.serviceProviderConfig));

  // Structural validation
  allErrors.push(...validateStructure(profile));

  if (allErrors.length > 0) {
    return { valid: false, errors: allErrors };
  }

  return { valid: true, errors: [], profile };
}
