/**
 * Built-in Profile Presets — Compile-time embedded
 *
 * Presets are statically imported from co-located JSON files at build time.
 * Each JSON file is a complete BuiltInPreset (metadata + profile)
 * with fully expanded attribute definitions — no shorthand abbreviations.
 *
 * Default preset: `entra-id` (decision D5).
 *
 * @see src/modules/scim/endpoint-profile/presets/*.json
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §8
 */
import type { BuiltInPreset } from './endpoint-profile.types';

// Compile-time JSON imports (requires resolveJsonModule: true in tsconfig)
import entraIdJson from './presets/entra-id.json';
import entraIdMinimalJson from './presets/entra-id-minimal.json';
import rfcStandardJson from './presets/rfc-standard.json';
import minimalJson from './presets/minimal.json';
import userOnlyJson from './presets/user-only.json';
import userOnlyWithCustomExtJson from './presets/user-only-with-custom-ext.json';

// ─── Preset Name Constants ─────────────────────────────────────────────────

export const PRESET_ENTRA_ID = 'entra-id';
export const PRESET_ENTRA_ID_MINIMAL = 'entra-id-minimal';
export const PRESET_RFC_STANDARD = 'rfc-standard';
export const PRESET_MINIMAL = 'minimal';
export const PRESET_USER_ONLY = 'user-only';
/** @deprecated Renamed in settings v7. Use PRESET_USER_ONLY_WITH_CUSTOM_EXT. */
export const PRESET_LEXMARK = 'user-only-with-custom-ext';
export const PRESET_USER_ONLY_WITH_CUSTOM_EXT = 'user-only-with-custom-ext';

/** The default preset applied when neither profilePreset nor profile is provided */
export const DEFAULT_PRESET_NAME = PRESET_ENTRA_ID;

/** The 5 built-in preset names in display order */
export const PRESET_NAMES: readonly string[] = [
  PRESET_ENTRA_ID,
  PRESET_ENTRA_ID_MINIMAL,
  PRESET_RFC_STANDARD,
  PRESET_MINIMAL,
  PRESET_USER_ONLY,
  PRESET_USER_ONLY_WITH_CUSTOM_EXT,
];

// ═══════════════════════════════════════════════════════════════════════════════
// Preset Registry (compile-time populated)
// ═══════════════════════════════════════════════════════════════════════════════

const presetMap = new Map<string, BuiltInPreset>([
  [PRESET_ENTRA_ID, entraIdJson as unknown as BuiltInPreset],
  [PRESET_ENTRA_ID_MINIMAL, entraIdMinimalJson as unknown as BuiltInPreset],
  [PRESET_RFC_STANDARD, rfcStandardJson as unknown as BuiltInPreset],
  [PRESET_MINIMAL, minimalJson as unknown as BuiltInPreset],
  [PRESET_USER_ONLY, userOnlyJson as unknown as BuiltInPreset],
  [PRESET_USER_ONLY_WITH_CUSTOM_EXT, userOnlyWithCustomExtJson as unknown as BuiltInPreset],
]);

/** Backward compat aliases — resolve old names to current preset names */
const PRESET_ALIASES: Record<string, string> = {
  'lexmark': PRESET_USER_ONLY_WITH_CUSTOM_EXT,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Proxy object that delegates to the preset map.
 * Exposes a Map-like interface that existing code expects.
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
  // Check for backward-compat aliases first
  const resolvedName = PRESET_ALIASES[name] ?? name;
  const preset = presetMap.get(resolvedName);
  if (!preset) {
    const validNames = [...presetMap.keys()].join(', ');
    throw new Error(`Unknown preset "${name}". Valid presets: ${validNames}`);
  }
  return preset;
}
