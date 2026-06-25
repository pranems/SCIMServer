/**
 * Capability resolver (Phase 1, Gaps 2-7, 10).
 *
 * Resolves a per-endpoint capability (boolean) or limit (number) with precedence
 * **stored SPC -> settings flag -> registry default**, plus a parent-dependency
 * short-circuit (a dependent setting is inert when its parent capability is off).
 *
 * Design notes:
 * - Settings are NOT all booleans; the registry declares four value-types
 *   (boolean | logLevel | primaryEnforcement | structured). Phase 1 only needs
 *   the boolean + numeric resolvers (the 10 gaps use those); enum/structured
 *   resolution is documented in the design doc for when a future gap needs it.
 * - Never throws: a malformed value falls back to the supplied default
 *   (OpenFeature typed-evaluation "never throw, return default" rule).
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §8.2, §8.4, §8.5
 * @see RFC 7644 §4 - ServiceProviderConfig
 */
import type { EndpointProfile, ServiceProviderConfig } from '../endpoint-profile/endpoint-profile.types';

/** Parse a settings boolean (native or "True"/"False"/"1"/"0"); undefined if unset/unparseable. */
function parseSettingBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || value === '1') return true;
    if (lower === 'false' || value === '0') return false;
  }
  return undefined;
}

/**
 * Resolve a boolean capability with precedence SPC -> settings -> default.
 *
 * @param profile      The endpoint profile (may be undefined -> default).
 * @param spcPath      Selector reading the capability from serviceProviderConfig.
 * @param settingKey   Optional settings flag key checked when SPC has no value.
 * @param defaultValue Registry default when neither SPC nor settings is set.
 */
export function resolveBooleanCapability(
  profile: EndpointProfile | undefined,
  spcPath: (spc: ServiceProviderConfig) => boolean | undefined,
  settingKey: string | undefined,
  defaultValue: boolean,
): boolean {
  const spc = profile?.serviceProviderConfig;
  if (spc) {
    const v = spcPath(spc);
    if (typeof v === 'boolean') return v; // 1. stored SPC wins
  }
  if (settingKey && profile?.settings) {
    const s = parseSettingBoolean((profile.settings as Record<string, unknown>)[settingKey]);
    if (s !== undefined) return s; // 2. settings flag
  }
  return defaultValue; // 3. registry default
}

/**
 * Resolve a positive-integer limit from the per-endpoint SPC, else the default.
 */
export function resolveNumericLimit(
  profile: EndpointProfile | undefined,
  spcPath: (spc: ServiceProviderConfig) => number | undefined,
  defaultValue: number,
): number {
  const spc = profile?.serviceProviderConfig;
  const v = spc ? spcPath(spc) : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : defaultValue;
}

/**
 * Resolve a boolean setting that only applies when a parent capability is on.
 * When the parent is off, returns `inertValue` and never consults the child
 * (prerequisite-flag / short-circuit pattern). Otherwise returns `resolveChild()`.
 *
 * @param profile          The endpoint profile.
 * @param parentSpcPath    Selector reading the parent capability from SPC.
 * @param parentSettingKey Optional settings flag for the parent.
 * @param parentDefault    Registry default for the parent capability.
 * @param resolveChild     Thunk resolving the child value when the parent is on.
 * @param inertValue       Value returned when the parent is off.
 */
export function resolveDependentBoolean(
  profile: EndpointProfile | undefined,
  parentSpcPath: (spc: ServiceProviderConfig) => boolean | undefined,
  parentSettingKey: string | undefined,
  parentDefault: boolean,
  resolveChild: () => boolean,
  inertValue: boolean,
): boolean {
  const parentOn = resolveBooleanCapability(profile, parentSpcPath, parentSettingKey, parentDefault);
  if (!parentOn) return inertValue; // short-circuit: child is inert
  return resolveChild();
}
