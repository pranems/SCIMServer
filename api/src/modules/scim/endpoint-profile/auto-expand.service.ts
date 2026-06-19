/**
 * Auto-Expand Service - Phase 13, Steps 2.1 + 2.2
 *
 * Expands shorthand profile input into a full EndpointProfile:
 * 1. Resolves "attributes": "all" → full RFC attribute list
 * 2. For known RFC attributes, fills missing fields from baseline
 * 3. Auto-injects required structural attributes (id, userName, etc.)
 * 4. Auto-injects project defaults (externalId, meta)
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §5.6 (Auto-Expand), §5.7 steps 1-2
 */
import type { ScimSchemaDefinition, ScimSchemaAttribute } from '../discovery/scim-schema-registry';
import type {
  EndpointProfile,
  ShorthandSchemaInput,
  ShorthandProfileInput,
  ServiceProviderConfig,
  ProfileAuthentication,
  AuthenticationMethod,
} from './endpoint-profile.types';
import {
  RFC_SCHEMA_ATTRIBUTE_MAPS,
  RFC_SCHEMA_ALL_ATTRIBUTES,
  RFC_REQUIRED_ATTRIBUTES,
  PROJECT_AUTO_INJECT_ATTRIBUTES,
} from './rfc-baseline';
import { isUnsafeObjectKey } from '../../../security/safe-object-key';
// Settings v7: SCIM_CORE_GROUP_SCHEMA import removed (D7 Group active removed)

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
    // Unknown schema or no name - return as-is (custom attribute)
    return partial as ScimSchemaAttribute;
  }

  const baseline = attrMap.get(partial.name.toLowerCase());
  if (!baseline) {
    // Not a known RFC attribute - return as-is (custom attribute for this schema)
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
    // CWE-1321: never write a prototype-polluting key from user input.
    if (isUnsafeObjectKey(k)) continue;
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
        `Cannot use "attributes": "all" for schema "${input.id}" - no RFC baseline exists. ` +
        `Provide full attribute definitions for custom schemas.`,
      );
    }
    attributes = [...allAttrs] as ScimSchemaAttribute[];
  } else if (Array.isArray(input.attributes)) {
    // Expand each partial attribute
    attributes = input.attributes.map(a => expandAttribute(a, input.id));
  } else {
    // No attributes (extension schema - passthrough storage)
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

  // 3. (D7 removed in settings v7 - Groups no longer have active)

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
// ─── Authentication model expansion (A0) ────────────────────────────────

/** Current schema version of the embedded profile.authentication block. */
export const CURRENT_AUTH_SCHEMA_VERSION = 1;

/**
 * Key fragments that mark a config entry as secret. Matched against the key with
 * all non-alphanumerics removed and lower-cased, so `client_secret`,
 * `clientSecret`, `private-key`, `credentialHash`, etc. all match while public
 * trust values (`issuer`, `audience`, `jwksUri`, ...) do not.
 */
const SECRET_KEY_FRAGMENTS = ['secret', 'password', 'passphrase', 'privatekey', 'credentialhash'];

function isSecretKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_FRAGMENTS.some((fragment) => norm.includes(fragment));
}

/** Remove secret-looking keys from a method's non-secret Class-A config. */
function stripSecretsFromConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    // CWE-1321: never write a prototype-polluting key from user input.
    if (isUnsafeObjectKey(key)) continue;
    if (!isSecretKey(key)) out[key] = value;
  }
  return out;
}

/**
 * Project one method to its known, non-secret fields. Unknown keys (including
 * any secret-looking ones) are dropped so the stored/returned shape can never
 * carry secret material (architecture section 2.3, the three data classes).
 */
function expandAuthenticationMethod(method: AuthenticationMethod): AuthenticationMethod {
  const out: AuthenticationMethod = { id: method.id, type: method.type };
  if (method.displayName !== undefined) out.displayName = method.displayName;
  if (method.description !== undefined) out.description = method.description;
  if (method.specUri !== undefined) out.specUri = method.specUri;
  if (method.plane !== undefined) out.plane = method.plane;
  if (method.tokenEndpointAuthMethod !== undefined) out.tokenEndpointAuthMethod = method.tokenEndpointAuthMethod;
  if (method.enabled !== undefined) out.enabled = method.enabled;
  if (method.priority !== undefined) out.priority = method.priority;
  if (method.lifecycleStatus !== undefined) out.lifecycleStatus = method.lifecycleStatus;
  if (method.config !== undefined && method.config !== null && typeof method.config === 'object') {
    out.config = stripSecretsFromConfig(method.config);
  }
  if (method.credentialRef !== undefined) out.credentialRef = method.credentialRef;
  return out;
}

/**
 * Normalize an inert authentication block on expand (A0): default the
 * schemaVersion, coerce methods to an array, and project each method to its
 * known non-secret fields. INERT - no resolver consults the result yet.
 */
export function expandAuthentication(auth: ProfileAuthentication): ProfileAuthentication {
  const methods = Array.isArray(auth.methods) ? auth.methods.map(expandAuthenticationMethod) : [];
  const result: ProfileAuthentication = {
    schemaVersion: typeof auth.schemaVersion === 'number' ? auth.schemaVersion : CURRENT_AUTH_SCHEMA_VERSION,
    methods,
  };
  if (auth.defaultMethodId !== undefined) result.defaultMethodId = auth.defaultMethodId;
  if (auth.policy !== undefined) result.policy = auth.policy;
  return result;
}

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

  const profile: EndpointProfile = {
    schemas: injectedSchemas,
    resourceTypes: [...resourceTypes],
    serviceProviderConfig,
    settings: { ...settings },
  };

  // 6. A0 - thread the inert authentication block through unchanged (secrets stripped).
  if (input.authentication) {
    profile.authentication = expandAuthentication(input.authentication);
  }

  return profile;
}
