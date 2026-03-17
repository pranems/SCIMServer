/**
 * Built-in Profile Presets — JSON file-backed with hardcoded fallback
 *
 * Presets are loaded from JSON files in the `presets/` directory at startup.
 * Each `<name>.json` file is a complete BuiltInPreset (metadata + profile)
 * with fully expanded attribute definitions — no shorthand abbreviations.
 *
 * If a JSON file is missing or malformed, the module falls back to a
 * minimal hardcoded default. In practice the JSON files should always
 * be present (they ship with the repo).
 *
 * Reload: call `reloadPresetsFromDisk()` (exposed via `POST /admin/profile-presets/reload`)
 * to re-read all JSON files without restarting the server.
 *
 * Custom presets: drop any additional `<name>.json` file into the presets
 * directory and it will be auto-discovered on load/reload.
 *
 * Default preset: `entra-id` (decision D5).
 *
 * @see api/presets/*.json — the source-of-truth preset definitions
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §8
 */
import * as fs from 'fs';
import * as path from 'path';
import type { BuiltInPreset, PresetMetadata } from './endpoint-profile.types';

// ─── Preset Name Constants ─────────────────────────────────────────────────

export const PRESET_ENTRA_ID = 'entra-id';
export const PRESET_ENTRA_ID_MINIMAL = 'entra-id-minimal';
export const PRESET_RFC_STANDARD = 'rfc-standard';
export const PRESET_MINIMAL = 'minimal';
export const PRESET_USER_ONLY = 'user-only';

/** The default preset applied when neither profilePreset nor profile is provided */
export const DEFAULT_PRESET_NAME = PRESET_ENTRA_ID;

/** The 5 built-in preset names in display order */
export const PRESET_NAMES: readonly string[] = [
  PRESET_ENTRA_ID,
  PRESET_ENTRA_ID_MINIMAL,
  PRESET_RFC_STANDARD,
  PRESET_MINIMAL,
  PRESET_USER_ONLY,
];

// ═══════════════════════════════════════════════════════════════════════════════
// Presets Directory Resolution
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the presets directory path.
 *
 * Lookup order:
 * 1. `PRESETS_DIR` environment variable (absolute or relative path)
 * 2. `<cwd>/presets/` — works for `npm run start:dev` and production
 * 3. `<compiled __dirname>/../../../../presets/` — fallback for bundled deploys
 */
export function getPresetsDir(): string {
  if (process.env.PRESETS_DIR) {
    return path.resolve(process.env.PRESETS_DIR);
  }
  const cwdPresets = path.join(process.cwd(), 'presets');
  if (fs.existsSync(cwdPresets)) {
    return cwdPresets;
  }
  // Compiled location: dist/modules/scim/endpoint-profile/ → ../../../../presets
  const distPresets = path.resolve(__dirname, '..', '..', '..', '..', 'presets');
  if (fs.existsSync(distPresets)) {
    return distPresets;
  }
  return cwdPresets; // Default even if it doesn't exist
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON File Loader
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a parsed preset JSON deeply.
 * Returns an array of human-readable error strings. Empty = valid.
 * Exported for unit testing.
 */
export function validatePreset(preset: any, fileName: string): string[] {
  const errors: string[] = [];
  const ctx = `[${fileName}]`;

  // ── Top-level structure ──
  if (!preset || typeof preset !== 'object') {
    return [`${ctx} Not a valid JSON object`];
  }
  if (!preset.metadata?.name || typeof preset.metadata.name !== 'string') {
    errors.push(`${ctx} metadata.name is missing or not a string`);
  }
  if (!preset.metadata?.description || typeof preset.metadata.description !== 'string') {
    errors.push(`${ctx} metadata.description is missing or not a string`);
  }
  if (!preset.profile || typeof preset.profile !== 'object') {
    errors.push(`${ctx} profile is missing or not an object`);
    return errors; // Can't validate further
  }

  const p = preset.profile;

  // ── Schemas ──
  if (!Array.isArray(p.schemas) || p.schemas.length === 0) {
    errors.push(`${ctx} profile.schemas must be a non-empty array`);
  } else {
    for (let i = 0; i < p.schemas.length; i++) {
      const s = p.schemas[i];
      const sCtx = `${ctx} schemas[${i}]`;
      if (!s.id || typeof s.id !== 'string') errors.push(`${sCtx} missing id`);
      if (!s.name || typeof s.name !== 'string') errors.push(`${sCtx} missing name`);
      // Attributes: must be an array of objects, or undefined for passthrough extensions
      if (s.attributes !== undefined) {
        if (s.attributes === 'all') {
          errors.push(`${sCtx} uses "all" abbreviation — JSON presets must have fully expanded attribute arrays`);
        } else if (!Array.isArray(s.attributes)) {
          errors.push(`${sCtx} attributes must be an array or undefined, got ${typeof s.attributes}`);
        } else {
          for (let j = 0; j < s.attributes.length; j++) {
            const a = s.attributes[j];
            const aCtx = `${sCtx}.attributes[${j}]`;
            if (!a.name || typeof a.name !== 'string') errors.push(`${aCtx} missing name`);
            if (!a.type || typeof a.type !== 'string') errors.push(`${aCtx} (${a.name || '?'}) missing type`);
            if (a.multiValued === undefined) errors.push(`${aCtx} (${a.name || '?'}) missing multiValued`);
            if (a.required === undefined) errors.push(`${aCtx} (${a.name || '?'}) missing required`);
            if (!a.mutability) errors.push(`${aCtx} (${a.name || '?'}) missing mutability`);
            if (!a.returned) errors.push(`${aCtx} (${a.name || '?'}) missing returned`);
            if (!a.description) errors.push(`${aCtx} (${a.name || '?'}) missing description`);
            // Validate subAttributes for complex types
            if (a.type === 'complex' && !a.subAttributes) {
              errors.push(`${aCtx} (${a.name}) is complex but missing subAttributes`);
            }
            if (a.subAttributes && Array.isArray(a.subAttributes)) {
              for (let k = 0; k < a.subAttributes.length; k++) {
                const sub = a.subAttributes[k];
                const subCtx = `${aCtx}.subAttributes[${k}]`;
                if (!sub.name) errors.push(`${subCtx} missing name`);
                if (!sub.type) errors.push(`${subCtx} (${sub.name || '?'}) missing type`);
                if (sub.multiValued === undefined) errors.push(`${subCtx} (${sub.name || '?'}) missing multiValued`);
                if (sub.required === undefined) errors.push(`${subCtx} (${sub.name || '?'}) missing required`);
                if (!sub.mutability) errors.push(`${subCtx} (${sub.name || '?'}) missing mutability`);
                if (!sub.returned) errors.push(`${subCtx} (${sub.name || '?'}) missing returned`);
              }
            }
          }
        }
      }
    }
  }

  // ── Resource Types ──
  if (!Array.isArray(p.resourceTypes) || p.resourceTypes.length === 0) {
    errors.push(`${ctx} profile.resourceTypes must be a non-empty array`);
  } else {
    const schemaIds = new Set((p.schemas || []).map((s: any) => s.id));
    for (let i = 0; i < p.resourceTypes.length; i++) {
      const rt = p.resourceTypes[i];
      const rtCtx = `${ctx} resourceTypes[${i}]`;
      if (!rt.id) errors.push(`${rtCtx} missing id`);
      if (!rt.name) errors.push(`${rtCtx} missing name`);
      if (!rt.endpoint) errors.push(`${rtCtx} missing endpoint`);
      if (!rt.description) errors.push(`${rtCtx} missing description`);
      if (!rt.schema) errors.push(`${rtCtx} missing schema`);
      else if (!schemaIds.has(rt.schema)) errors.push(`${rtCtx} schema "${rt.schema}" not found in schemas array`);
      if (!Array.isArray(rt.schemaExtensions)) errors.push(`${rtCtx} missing schemaExtensions array`);
      else {
        for (const ext of rt.schemaExtensions) {
          if (!schemaIds.has(ext.schema)) {
            errors.push(`${rtCtx} extension schema "${ext.schema}" not found in schemas array`);
          }
        }
      }
    }
  }

  // ── ServiceProviderConfig ──
  if (!p.serviceProviderConfig || typeof p.serviceProviderConfig !== 'object') {
    errors.push(`${ctx} profile.serviceProviderConfig missing`);
  } else {
    const spc = p.serviceProviderConfig;
    for (const cap of ['patch', 'bulk', 'filter', 'sort', 'etag', 'changePassword']) {
      if (!spc[cap] || spc[cap].supported === undefined) {
        errors.push(`${ctx} serviceProviderConfig.${cap} missing or missing .supported`);
      }
    }
    if (spc.filter && spc.filter.supported && !spc.filter.maxResults) {
      errors.push(`${ctx} serviceProviderConfig.filter.supported=true but maxResults missing`);
    }
  }

  // ── Settings ──
  if (p.settings !== undefined && typeof p.settings !== 'object') {
    errors.push(`${ctx} profile.settings must be an object`);
  }

  return errors;
}

/**
 * Load a single preset from a JSON file.
 * Returns null if the file doesn't exist, fails to parse, or fails deep validation.
 */
function loadPresetFile(presetsDir: string, name: string): { preset: BuiltInPreset | null; errors: string[] } {
  const filePath = path.join(presetsDir, `${name}.json`);
  try {
    if (!fs.existsSync(filePath)) {
      return { preset: null, errors: [] }; // Not an error — just missing
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr: any) {
      return { preset: null, errors: [`[${name}.json] Invalid JSON: ${parseErr.message}`] };
    }

    // Deep validation
    const errors = validatePreset(parsed, `${name}.json`);
    if (errors.length > 0) {
      return { preset: null, errors };
    }

    // Enforce: file name is the canonical preset name
    if (parsed.metadata.name !== name) {
      console.warn(`[presets] Name mismatch in ${filePath}: overriding metadata.name "${parsed.metadata.name}" with file name "${name}"`);
      parsed.metadata.name = name;
    }

    // Ensure settings object exists
    if (!parsed.profile.settings) {
      parsed.profile.settings = {};
    }

    return { preset: parsed as BuiltInPreset, errors: [] };
  } catch (err: any) {
    return { preset: null, errors: [`[${name}.json] Read error: ${err.message}`] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hardcoded Fallbacks (safety net — used only when JSON files are missing)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal fallback presets — used when the JSON files are not found.
 * These contain the shorthand format; the auto-expand engine fills in details.
 */
function buildFallbackPreset(name: string): BuiltInPreset {
  const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const CORE_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
  const ENT_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

  const baseSpc = {
    patch: { supported: true },
    bulk: { supported: false },
    filter: { supported: true, maxResults: 200 },
    sort: { supported: false },
    etag: { supported: true },
    changePassword: { supported: false },
  };

  switch (name) {
    case PRESET_ENTRA_ID:
      return {
        metadata: { name, description: 'Entra ID provisioning (fallback).', default: true },
        profile: {
          schemas: [
            { id: CORE_USER, name: 'User', attributes: 'all' as any },
            { id: ENT_USER, name: 'EnterpriseUser', attributes: 'all' as any },
            { id: CORE_GROUP, name: 'Group', attributes: 'all' as any },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', description: 'User Account', endpoint: '/Users', schema: CORE_USER, schemaExtensions: [{ schema: ENT_USER, required: false }] },
            { id: 'Group', name: 'Group', description: 'Group', endpoint: '/Groups', schema: CORE_GROUP, schemaExtensions: [] },
          ],
          serviceProviderConfig: baseSpc,
          settings: { AllowAndCoerceBooleanStrings: 'True', VerbosePatchSupported: 'True', MultiOpPatchRequestAddMultipleMembersToGroup: 'True', MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True', PatchOpAllowRemoveAllMembers: 'True' },
        },
      };
    case PRESET_RFC_STANDARD:
      return {
        metadata: { name, description: 'Full RFC 7643 (fallback).' },
        profile: {
          schemas: [
            { id: CORE_USER, name: 'User', attributes: 'all' as any },
            { id: ENT_USER, name: 'EnterpriseUser', attributes: 'all' as any },
            { id: CORE_GROUP, name: 'Group', attributes: 'all' as any },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', description: 'User Account', endpoint: '/Users', schema: CORE_USER, schemaExtensions: [{ schema: ENT_USER, required: false }] },
            { id: 'Group', name: 'Group', description: 'Group', endpoint: '/Groups', schema: CORE_GROUP, schemaExtensions: [] },
          ],
          serviceProviderConfig: { ...baseSpc, bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 }, sort: { supported: true } },
          settings: {},
        },
      };
    default:
      // Generic minimal fallback for entra-id-minimal, minimal, user-only
      return {
        metadata: { name, description: `${name} preset (fallback).` },
        profile: {
          schemas: [
            { id: CORE_USER, name: 'User', attributes: [{ name: 'userName' }, { name: 'displayName' }, { name: 'active' }, { name: 'emails' }, { name: 'externalId' }, { name: 'password' }] as any },
            { id: CORE_GROUP, name: 'Group', attributes: [{ name: 'displayName' }, { name: 'members' }, { name: 'externalId' }] as any },
          ],
          resourceTypes: [
            { id: 'User', name: 'User', description: 'User Account', endpoint: '/Users', schema: CORE_USER, schemaExtensions: [] },
            { id: 'Group', name: 'Group', description: 'Group', endpoint: '/Groups', schema: CORE_GROUP, schemaExtensions: [] },
          ],
          serviceProviderConfig: baseSpc,
          settings: {},
        },
      };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mutable Preset Registry
// ═══════════════════════════════════════════════════════════════════════════════

/** The live preset map — refreshed by loadPresetsFromDisk() */
let presetMap = new Map<string, BuiltInPreset>();

/** Result of the last load operation */
let lastLoadResult: { loaded: string[]; fallback: string[]; custom: string[]; dir: string; validationErrors: string[] } | null = null;

/**
 * Load (or reload) all presets from the presets directory.
 *
 * For each of the 5 built-in names: tries the JSON file first, validates deeply,
 * falls back to hardcoded if the file is missing or fails validation.
 * Also auto-discovers any additional `*.json` files as custom presets.
 *
 * @returns Summary of what was loaded and from where, plus any validation errors.
 */
export function loadPresetsFromDisk(): { loaded: string[]; fallback: string[]; custom: string[]; dir: string; validationErrors: string[] } {
  const dir = getPresetsDir();
  const loaded: string[] = [];
  const fallback: string[] = [];
  const custom: string[] = [];
  const validationErrors: string[] = [];
  const newMap = new Map<string, BuiltInPreset>();

  // 1. Load the 5 known presets (JSON file → validate → hardcoded fallback)
  for (const name of PRESET_NAMES) {
    const result = loadPresetFile(dir, name);
    if (result.errors.length > 0) {
      // Validation failed — log warnings and fall back
      for (const err of result.errors) {
        console.warn(`[presets] Validation error: ${err}`);
        validationErrors.push(err);
      }
      console.warn(`[presets] Falling back to hardcoded preset for "${name}" due to ${result.errors.length} validation error(s)`);
      newMap.set(name, buildFallbackPreset(name));
      fallback.push(name);
    } else if (result.preset) {
      newMap.set(name, result.preset);
      loaded.push(name);
    } else {
      // File doesn't exist — use fallback silently
      newMap.set(name, buildFallbackPreset(name));
      fallback.push(name);
    }
  }

  // 2. Auto-discover additional JSON files (operator custom presets)
  try {
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const name = file.replace(/\.json$/, '');
        if (newMap.has(name)) continue; // Already loaded above
        const result = loadPresetFile(dir, name);
        if (result.errors.length > 0) {
          for (const err of result.errors) {
            console.warn(`[presets] Custom preset validation error: ${err}`);
            validationErrors.push(err);
          }
          // Skip invalid custom presets entirely (no fallback for custom ones)
        } else if (result.preset) {
          newMap.set(name, result.preset);
          custom.push(name);
        }
      }
    }
  } catch {
    // Directory not readable — known presets already covered via fallback
  }

  presetMap = newMap;
  lastLoadResult = { loaded, fallback, custom, dir, validationErrors };
  return lastLoadResult;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Proxy object that delegates to the mutable presetMap.
 * Exposes the same Map-like interface that existing code expects.
 */
export const BUILT_IN_PRESETS = {
  get(name: string): BuiltInPreset | undefined { return presetMap.get(name); },
  has(name: string): boolean { return presetMap.has(name); },
  keys(): IterableIterator<string> { return presetMap.keys(); },
  values(): IterableIterator<BuiltInPreset> { return presetMap.values(); },
  get size(): number { return presetMap.size; },
  [Symbol.iterator](): IterableIterator<[string, BuiltInPreset]> { return presetMap[Symbol.iterator](); },
};

/**
 * Get a preset by name.
 * @throws Error if the preset name is not in the registry.
 */
export function getBuiltInPreset(name: string): BuiltInPreset {
  const preset = presetMap.get(name);
  if (!preset) {
    const validNames = [...presetMap.keys()].join(', ');
    throw new Error(`Unknown preset "${name}". Valid presets: ${validNames}`);
  }
  return preset;
}

/**
 * Get metadata for all loaded presets (for `GET /admin/profile-presets`).
 */
export function getAllPresetMetadata(): PresetMetadata[] {
  return [...presetMap.values()].map(p => p.metadata);
}

/**
 * Reload all presets from disk. Callable from the admin API.
 * Returns a summary of what was loaded from files vs fallback.
 */
export function reloadPresetsFromDisk() {
  return loadPresetsFromDisk();
}

/**
 * Get the result of the last load/reload operation.
 */
export function getLastLoadResult() {
  return lastLoadResult;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Startup — initial load on module import
// ═══════════════════════════════════════════════════════════════════════════════

const _init = loadPresetsFromDisk();
if (_init.loaded.length > 0) {
  console.log(`[presets] Loaded ${_init.loaded.length} preset(s) from JSON files in ${_init.dir}: ${_init.loaded.join(', ')}`);
}
if (_init.fallback.length > 0) {
  console.log(`[presets] Using hardcoded fallback for ${_init.fallback.length} preset(s) (JSON missing or invalid): ${_init.fallback.join(', ')}`);
}
if (_init.custom.length > 0) {
  console.log(`[presets] Discovered ${_init.custom.length} custom preset(s): ${_init.custom.join(', ')}`);
}
if (_init.validationErrors.length > 0) {
  console.warn(`[presets] ⚠ ${_init.validationErrors.length} validation error(s) found — affected presets fell back to hardcoded defaults`);
}
