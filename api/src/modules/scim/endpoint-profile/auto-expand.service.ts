/**
 * Auto-Expand Service — Phase 13, Steps 2.1 + 2.2
 *
 * Expands shorthand profile input into a full EndpointProfile:
 * 1. Resolves "attributes": "all" → full RFC attribute list
 * 2. For known RFC attributes, fills missing fields from baseline
 * 3. Auto-injects required structural attributes (id, userName, etc.)
 * 4. Auto-injects project defaults (externalId, meta, Group active)
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.6 (Auto-Expand), §5.7 steps 1-2
 */
import type { ScimSchemaDefinition, ScimSchemaAttribute } from '../discovery/scim-schema-registry';
import type { EndpointProfile, ShorthandSchemaInput, ShorthandProfileInput, ServiceProviderConfig } from './endpoint-profile.types';
import {
  RFC_SCHEMA_ATTRIBUTE_MAPS,
  RFC_SCHEMA_ALL_ATTRIBUTES,
  RFC_REQUIRED_ATTRIBUTES,
  PROJECT_AUTO_INJECT_ATTRIBUTES,
  GROUP_ALWAYS_INCLUDE_ATTRIBUTES,
} from './rfc-baseline';
import { SCIM_CORE_GROUP_SCHEMA } from '../common/scim-constants';

// ─── Expand a single attribute ──────────────────────────────────────────

/**
 * Expand a partial attribute by merging it with its RFC baseline.
 * If no baseline exists (custom attribute), the input must be fully defined.
 */
function expandAttribute(
  partial: Partial<ScimSchemaAttribute>,
  schemaId: string,
): ScimSchemaAttribute {
  const attrMap = RFC_SCHEMA_ATTRIBUTE_MAPS.get(schemaId);
  if (!attrMap || !partial.name) {
    // Unknown schema or no name — return as-is (custom attribute)
    return partial as ScimSchemaAttribute;
  }

  const baseline = attrMap.get(partial.name.toLowerCase());
  if (!baseline) {
    // Not a known RFC attribute — return as-is (custom attribute for this schema)
    return partial as ScimSchemaAttribute;
  }

  // Merge: baseline provides defaults, explicit overrides win
  return {
    ...baseline,
    ...stripUndefined(partial),
    // Always keep baseline's subAttributes unless explicitly overridden
    subAttributes: partial.subAttributes ?? baseline.subAttributes,
  } as ScimSchemaAttribute;
}

/** Remove undefined keys so spread doesn't overwrite baseline with undefined */
function stripUndefined(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

// ─── Expand a schema ────────────────────────────────────────────────────

/**
 * Expand a shorthand schema into a full ScimSchemaDefinition.
 * Handles "all" shorthand and partial attribute expansion.
 */
function expandSchema(input: ShorthandSchemaInput): ScimSchemaDefinition {
  let attributes: ScimSchemaAttribute[];

  if (input.attributes === 'all') {
    // Expand to full RFC attribute list
    const allAttrs = RFC_SCHEMA_ALL_ATTRIBUTES.get(input.id);
    if (!allAttrs) {
      throw new Error(
        `Cannot use "attributes": "all" for schema "${input.id}" — no RFC baseline exists. ` +
        `Provide full attribute definitions for custom schemas.`,
      );
    }
    attributes = [...allAttrs] as ScimSchemaAttribute[];
  } else if (Array.isArray(input.attributes)) {
    // Expand each partial attribute
    attributes = input.attributes.map(a => expandAttribute(a, input.id));
  } else {
    // No attributes (extension schema — passthrough storage)
    attributes = [];
  }

  return {
    id: input.id,
    name: input.name,
    description: input.description ?? input.name,
    attributes,
  };
}

// ─── Auto-inject required attributes ────────────────────────────────────

/**
 * Ensure RFC-required and project-default attributes are present on a schema.
 * Adds missing attributes from the RFC baseline without overriding existing ones.
 */
function autoInjectAttributes(schema: ScimSchemaDefinition): ScimSchemaDefinition {
  const existingNames = new Set(schema.attributes.map(a => a.name.toLowerCase()));
  const attrMap = RFC_SCHEMA_ATTRIBUTE_MAPS.get(schema.id);
  const toInject: ScimSchemaAttribute[] = [];

  // 1. RFC-required attributes (id, userName for User, displayName for Group)
  const required = RFC_REQUIRED_ATTRIBUTES.get(schema.id);
  if (required) {
    for (const name of required) {
      if (!existingNames.has(name.toLowerCase()) && attrMap) {
        const baseline = attrMap.get(name.toLowerCase());
        if (baseline) {
          toInject.push(baseline);
          existingNames.add(name.toLowerCase());
        }
      }
    }
  }

  // 2. Project defaults: externalId, meta (on all core schemas with baselines)
  if (attrMap) {
    for (const name of PROJECT_AUTO_INJECT_ATTRIBUTES) {
      if (!existingNames.has(name.toLowerCase())) {
        const baseline = attrMap.get(name.toLowerCase());
        if (baseline) {
          toInject.push(baseline);
          existingNames.add(name.toLowerCase());
        }
      }
    }
  }

  // 3. Group-specific: always include `active` (decision D7)
  if (schema.id === SCIM_CORE_GROUP_SCHEMA && attrMap) {
    for (const name of GROUP_ALWAYS_INCLUDE_ATTRIBUTES) {
      if (!existingNames.has(name.toLowerCase())) {
        const baseline = attrMap.get(name.toLowerCase());
        if (baseline) {
          toInject.push(baseline);
          existingNames.add(name.toLowerCase());
        }
      }
    }
  }

  if (toInject.length === 0) return schema;

  return {
    ...schema,
    attributes: [...toInject, ...schema.attributes],
  };
}

// ─── SPC defaults ───────────────────────────────────────────────────────

/** Fill missing SPC fields with safe defaults */
function expandServiceProviderConfig(input?: Partial<ServiceProviderConfig>): ServiceProviderConfig {
  return {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    ...stripUndefined(input ?? {}),
  } as ServiceProviderConfig;
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Expand a shorthand profile input into a full EndpointProfile.
 *
 * Pipeline: autoExpand → autoInject
 * (Validation/tighten-only happens separately in the orchestrator)
 */
export function expandProfile(input: ShorthandProfileInput): EndpointProfile {
  // 1. Expand schemas
  const expandedSchemas = (input.schemas ?? []).map(s => expandSchema(s));

  // 2. Auto-inject required/project-default attributes
  const injectedSchemas = expandedSchemas.map(s => autoInjectAttributes(s));

  // 3. Resource types (already fully defined in presets/input)
  const resourceTypes = input.resourceTypes ?? [];

  // 4. SPC
  const serviceProviderConfig = expandServiceProviderConfig(input.serviceProviderConfig);

  // 5. Settings
  const settings = input.settings ?? {};

  return {
    schemas: injectedSchemas,
    resourceTypes: [...resourceTypes],
    serviceProviderConfig,
    settings: { ...settings },
  };
}
