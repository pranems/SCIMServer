/**
 * Phase 8 Next - V16/V17: Schema-aware boolean sanitization logic
 *
 * Tests the pure algorithm underlying sanitizeBooleanStrings
 * without NestJS service dependencies.
 */

/** Pure reimplementation of the sanitize logic for testing in isolation */
function sanitizeBooleanStrings(obj: Record<string, unknown>, booleanKeys: Set<string>): void {
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          sanitizeBooleanStrings(item as Record<string, unknown>, booleanKeys);
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      sanitizeBooleanStrings(value as Record<string, unknown>, booleanKeys);
    } else if (typeof value === 'string' && booleanKeys.has(key.toLowerCase())) {
      const lower = value.toLowerCase();
      if (lower === 'true') obj[key] = true;
      else if (lower === 'false') obj[key] = false;
    }
  }
}

describe('sanitizeBooleanStrings - schema-aware (V16/V17)', () => {
  const booleanKeys = new Set(['active', 'primary']);

  it('should convert string "true" to boolean true for known boolean keys', () => {
    const obj: Record<string, unknown> = { active: 'true' };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.active).toBe(true);
  });

  it('should convert string "false" to boolean false for known boolean keys', () => {
    const obj: Record<string, unknown> = { active: 'false' };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.active).toBe(false);
  });

  it('should convert case-insensitively (True, FALSE, etc.)', () => {
    const obj: Record<string, unknown> = { active: 'True', primary: 'FALSE' };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.active).toBe(true);
    expect(obj.primary).toBe(false);
  });

  it('should NOT convert string values for non-boolean keys (V16 core fix)', () => {
    const obj: Record<string, unknown> = {
      roles: [
        { value: 'true', display: 'True Admin', primary: 'true' },
        { value: 'false', display: 'False Flag', primary: 'false' },
      ],
    };
    sanitizeBooleanStrings(obj, booleanKeys);

    const roles = obj.roles as Array<Record<string, unknown>>;
    // "value" and "display" are NOT boolean keys - must remain untouched
    expect(roles[0].value).toBe('true');
    expect(roles[0].display).toBe('True Admin');
    expect(roles[1].value).toBe('false');
    expect(roles[1].display).toBe('False Flag');
    // "primary" IS a boolean key - must be converted
    expect(roles[0].primary).toBe(true);
    expect(roles[1].primary).toBe(false);
  });

  it('should recurse into nested objects', () => {
    const obj: Record<string, unknown> = {
      name: { givenName: 'John' },
      emails: [{ value: 'john@example.com', primary: 'true' }],
    };
    sanitizeBooleanStrings(obj, booleanKeys);

    const emails = obj.emails as Array<Record<string, unknown>>;
    expect(emails[0].primary).toBe(true);
    expect(emails[0].value).toBe('john@example.com');
  });

  it('should handle already-boolean values without error', () => {
    const obj: Record<string, unknown> = { active: true };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.active).toBe(true);
  });

  it('should ignore null and undefined values', () => {
    const obj: Record<string, unknown> = { active: null, primary: undefined };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.active).toBeNull();
    expect(obj.primary).toBeUndefined();
  });

  it('should ignore numeric and non-true/false strings', () => {
    const obj: Record<string, unknown> = { active: 'yes', primary: '1' };
    sanitizeBooleanStrings(obj, booleanKeys);
    // "yes" and "1" are not "true"/"false" - should remain as-is
    expect(obj.active).toBe('yes');
    expect(obj.primary).toBe('1');
  });

  it('should handle deeply nested structures', () => {
    const obj: Record<string, unknown> = {
      level1: {
        level2: {
          level3: [{ primary: 'true', value: 'true' }],
        },
      },
    };
    sanitizeBooleanStrings(obj, booleanKeys);

    const leaf = (obj.level1 as any).level2.level3[0];
    expect(leaf.primary).toBe(true);
    expect(leaf.value).toBe('true'); // "value" is not a boolean key
  });

  it('should not touch keys not in booleanKeys set', () => {
    const obj: Record<string, unknown> = {
      userName: 'true',
      displayName: 'false',
      active: 'true',
    };
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj.userName).toBe('true');
    expect(obj.displayName).toBe('false');
    expect(obj.active).toBe(true);
  });

  it('should work with empty booleanKeys set', () => {
    const obj: Record<string, unknown> = { active: 'true', primary: 'false' };
    sanitizeBooleanStrings(obj, new Set());
    // Nothing should be converted
    expect(obj.active).toBe('true');
    expect(obj.primary).toBe('false');
  });

  it('should handle empty object', () => {
    const obj: Record<string, unknown> = {};
    sanitizeBooleanStrings(obj, booleanKeys);
    expect(obj).toEqual({});
  });

  it('should handle mixed array items (objects + primitives)', () => {
    const obj: Record<string, unknown> = {
      tags: ['admin', 42, null, { primary: 'true' }],
    };
    sanitizeBooleanStrings(obj, booleanKeys);
    const tags = obj.tags as unknown[];
    expect(tags[0]).toBe('admin');
    expect(tags[1]).toBe(42);
    expect(tags[2]).toBeNull();
    expect((tags[3] as any).primary).toBe(true);
  });
});
