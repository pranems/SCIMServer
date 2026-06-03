/**
 * Schema-Characteristic Test Helper (RFC 7643 §2.2 + §7)
 *
 * STANDING RULE for tests against /Schemas attribute definitions:
 *   1. Check for the presence of an attribute characteristic.
 *   2. If present, enforce the published value as authoritative.
 *   3. If absent, substitute the RFC-defined default for that characteristic.
 *
 * Tests must NEVER hardcode an expected value that ignores either branch -
 * doing so creates churn every time a preset legitimately tightens or
 * relaxes a characteristic (e.g. uniqueness 'none' -> 'server').
 *
 * RFC 7643 §2.2 Default Characteristic Values
 * --------------------------------------------
 *   required        : false
 *   caseExact       : false   (case-insensitive)
 *   mutability      : readWrite
 *   returned        : default
 *   uniqueness      : none
 *   multiValued     : false
 *   type            : "string"
 */

export type SchemaAttribute = {
  name?: string;
  type?: string;
  multiValued?: boolean;
  required?: boolean;
  caseExact?: boolean;
  mutability?: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  returned?: 'always' | 'never' | 'default' | 'request';
  uniqueness?: 'none' | 'server' | 'global';
  referenceTypes?: string[];
  subAttributes?: SchemaAttribute[];
  canonicalValues?: string[];
  description?: string;
} & Record<string, unknown>;

/** RFC 7643 §2.2 defaults applied when a characteristic is omitted. */
export const RFC_CHAR_DEFAULTS = Object.freeze({
  required: false,
  caseExact: false,
  mutability: 'readWrite',
  returned: 'default',
  uniqueness: 'none',
  multiValued: false,
  type: 'string',
} as const);

export type CharacteristicKey = keyof typeof RFC_CHAR_DEFAULTS;

/** Valid SCIM keywords per RFC 7643 §7. */
export const VALID_MUTABILITY = ['readOnly', 'readWrite', 'immutable', 'writeOnly'] as const;
export const VALID_RETURNED = ['always', 'never', 'default', 'request'] as const;
export const VALID_UNIQUENESS = ['none', 'server', 'global'] as const;
export const VALID_TYPE = [
  'string',
  'boolean',
  'decimal',
  'integer',
  'dateTime',
  'reference',
  'binary',
  'complex',
] as const;

/**
 * Maps each characteristic key to its allowed value type (broader than the
 * default-literal type returned by RFC_CHAR_DEFAULTS).
 */
export type CharacteristicValueOf<K extends CharacteristicKey> =
  K extends 'required' | 'caseExact' | 'multiValued' ? boolean :
  K extends 'mutability' ? typeof VALID_MUTABILITY[number] :
  K extends 'returned' ? typeof VALID_RETURNED[number] :
  K extends 'uniqueness' ? typeof VALID_UNIQUENESS[number] :
  K extends 'type' ? typeof VALID_TYPE[number] :
  never;

/**
 * Returns the EFFECTIVE value of a characteristic per RFC 7643 §2.2:
 * the published value if present, else the RFC default.
 */
export function effectiveCharacteristic<K extends CharacteristicKey>(
  attr: SchemaAttribute | undefined,
  key: K,
): CharacteristicValueOf<K> {
  const published = attr?.[key];
  if (published === undefined || published === null) {
    return RFC_CHAR_DEFAULTS[key] as unknown as CharacteristicValueOf<K>;
  }
  return published as unknown as CharacteristicValueOf<K>;
}

/**
 * Asserts the EFFECTIVE characteristic value matches `expected` -
 * accepts either an explicitly published value OR an absent characteristic
 * (in which case the RFC default is substituted before comparison).
 */
export function expectEffectiveCharacteristic<K extends CharacteristicKey>(
  attr: SchemaAttribute | undefined,
  key: K,
  expected: CharacteristicValueOf<K>,
): void {
  expect(effectiveCharacteristic(attr, key)).toBe(expected);
}

/**
 * Asserts the EFFECTIVE characteristic value is one of the given allowed
 * keywords. Use this when a server is permitted to tighten or relax a
 * characteristic - e.g. RFC 7643 §7 allows a server to advertise
 * uniqueness:'none' while still enforcing 'server' internally, OR to
 * advertise 'server' for clarity. Both are valid; this helper accepts
 * either.
 *
 * If the characteristic is absent, the RFC default is substituted before
 * the membership check.
 */
export function expectCharacteristicIn<K extends CharacteristicKey>(
  attr: SchemaAttribute | undefined,
  key: K,
  allowed: readonly CharacteristicValueOf<K>[],
): void {
  const effective = effectiveCharacteristic(attr, key);
  expect(allowed).toContain(effective);
}

/**
 * Locates a sub-attribute by name. Returns undefined if absent (caller
 * should assert presence separately when required).
 */
export function findSubAttribute(
  attr: SchemaAttribute | undefined,
  subName: string,
): SchemaAttribute | undefined {
  return attr?.subAttributes?.find((s) => s?.name === subName);
}

/**
 * Locates a top-level attribute by name within a Schema body.
 */
export function findAttribute(
  schemaBody: { attributes?: SchemaAttribute[] } | undefined,
  attrName: string,
): SchemaAttribute | undefined {
  return schemaBody?.attributes?.find((a) => a?.name === attrName);
}
