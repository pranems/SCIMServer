import {
  isValuePath,
  parseValuePath,
  isExtensionPath,
  parseExtensionPath,
  matchesFilter,
  applyValuePathUpdate,
  removeValuePathEntry,
  applyExtensionUpdate,
  removeExtensionAttribute,
  addValuePathEntry,
  resolveNoPathValue,
} from './scim-patch-path';

describe('scim-patch-path utilities', () => {
  // ─── isValuePath ─────────────────────────────────────────────────────

  describe('isValuePath', () => {
    it('should return true for a path with brackets', () => {
      expect(isValuePath('emails[type eq "work"].value')).toBe(true);
    });

    it('should return false for a simple path', () => {
      expect(isValuePath('displayName')).toBe(false);
    });

    it('should return false for an extension URN path', () => {
      expect(
        isValuePath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager')
      ).toBe(false);
    });
  });

  // ─── parseValuePath ──────────────────────────────────────────────────

  describe('parseValuePath', () => {
    it('should parse emails[type eq "work"].value', () => {
      const result = parseValuePath('emails[type eq "work"].value');
      expect(result).toEqual({
        attribute: 'emails',
        filterAttribute: 'type',
        filterOperator: 'eq',
        filterValue: 'work',
        subAttribute: 'value',
      });
    });

    it('should parse addresses[type eq "work"].streetAddress', () => {
      const result = parseValuePath('addresses[type eq "work"].streetAddress');
      expect(result).toEqual({
        attribute: 'addresses',
        filterAttribute: 'type',
        filterOperator: 'eq',
        filterValue: 'work',
        subAttribute: 'streetAddress',
      });
    });

    it('should parse path without sub-attribute', () => {
      const result = parseValuePath('emails[type eq "work"]');
      expect(result).toEqual({
        attribute: 'emails',
        filterAttribute: 'type',
        filterOperator: 'eq',
        filterValue: 'work',
        subAttribute: undefined,
      });
    });

    it('should return null for a simple attribute path', () => {
      expect(parseValuePath('displayName')).toBeNull();
    });

    it('should return null for an empty string', () => {
      expect(parseValuePath('')).toBeNull();
    });

    it('should handle co operator', () => {
      const result = parseValuePath('emails[value co "example"].type');
      expect(result).toEqual({
        attribute: 'emails',
        filterAttribute: 'value',
        filterOperator: 'co',
        filterValue: 'example',
        subAttribute: 'type',
      });
    });

    it('should handle sw (starts-with) operator', () => {
      const result = parseValuePath('emails[value sw "admin"].type');
      expect(result).toEqual({
        attribute: 'emails',
        filterAttribute: 'value',
        filterOperator: 'sw',
        filterValue: 'admin',
        subAttribute: 'type',
      });
    });

    it('should handle ne (not-equals) operator', () => {
      const result = parseValuePath('emails[type ne "home"].value');
      expect(result).toEqual({
        attribute: 'emails',
        filterAttribute: 'type',
        filterOperator: 'ne',
        filterValue: 'home',
        subAttribute: 'value',
      });
    });

    it('should be case-insensitive for operators', () => {
      const result = parseValuePath('emails[type EQ "work"].value');
      expect(result).not.toBeNull();
      expect(result!.filterOperator).toBe('eq');
    });

    it('should return null for malformed bracket expression', () => {
      expect(parseValuePath('emails[type eq work].value')).toBeNull();
    });

    it('should return null for missing closing bracket', () => {
      expect(parseValuePath('emails[type eq "work".value')).toBeNull();
    });
  });

  // ─── isExtensionPath ─────────────────────────────────────────────────

  describe('isExtensionPath', () => {
    it('should return true for enterprise extension path', () => {
      expect(
        isExtensionPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager')
      ).toBe(true);
    });

    it('should return false for the URN itself without a trailing attribute', () => {
      expect(
        isExtensionPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User')
      ).toBe(false);
    });

    it('should return false for a simple path', () => {
      expect(isExtensionPath('displayName')).toBe(false);
    });

    it('should return false for a valuePath', () => {
      expect(isExtensionPath('emails[type eq "work"].value')).toBe(false);
    });

    it('should match extension URN case-insensitively (RFC 7643 §2.1)', () => {
      expect(
        isExtensionPath('URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER:manager')
      ).toBe(true);
    });

    it('should match extension URN with mixed casing', () => {
      expect(
        isExtensionPath('Urn:Ietf:Params:Scim:Schemas:Extension:Enterprise:2.0:User:Department')
      ).toBe(true);
    });
  });

  // ─── parseExtensionPath ──────────────────────────────────────────────

  describe('parseExtensionPath', () => {
    it('should parse enterprise extension manager path', () => {
      const result = parseExtensionPath(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager'
      );
      expect(result).toEqual({
        schemaUrn: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        attributePath: 'manager',
      });
    });

    it('should parse enterprise extension department path', () => {
      const result = parseExtensionPath(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department'
      );
      expect(result).toEqual({
        schemaUrn: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        attributePath: 'department',
      });
    });

    it('should return null for the URN itself (no attribute)', () => {
      expect(
        parseExtensionPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User')
      ).toBeNull();
    });

    it('should return null for unrecognised URN', () => {
      expect(parseExtensionPath('urn:custom:schema:Foo:bar')).toBeNull();
    });

    it('should parse mixed-case URN and preserve original attribute casing (RFC 7643 §2.1)', () => {
      const result = parseExtensionPath(
        'URN:IETF:PARAMS:SCIM:SCHEMAS:EXTENSION:ENTERPRISE:2.0:USER:Manager'
      );
      expect(result).not.toBeNull();
      expect(result!.schemaUrn).toBe('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User');
      expect(result!.attributePath).toBe('Manager');
    });

    it('should handle all-lowercase URN path', () => {
      const result = parseExtensionPath(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:user:department'
      );
      expect(result).not.toBeNull();
      expect(result!.attributePath).toBe('department');
    });
  });

  // ─── matchesFilter ───────────────────────────────────────────────────

  describe('matchesFilter', () => {
    it('should match eq case-insensitively', () => {
      expect(matchesFilter({ type: 'Work' }, 'type', 'eq', 'work')).toBe(true);
    });

    it('should not match different values', () => {
      expect(matchesFilter({ type: 'home' }, 'type', 'eq', 'work')).toBe(false);
    });

    it('should handle missing attribute', () => {
      expect(matchesFilter({}, 'type', 'eq', 'work')).toBe(false);
    });

    it('should coerce non-string values to string for comparison', () => {
      expect(matchesFilter({ count: 5 }, 'count', 'eq', '5')).toBe(true);
    });

    it('should fall back to strict string equality for unsupported operators', () => {
      // 'sw' is not explicitly implemented, falls back to String(actual) === String(filterValue)
      expect(matchesFilter({ type: 'work' }, 'type', 'sw', 'work')).toBe(true);
      expect(matchesFilter({ type: 'work' }, 'type', 'sw', 'wo')).toBe(false);
    });

    it('should handle null attribute value', () => {
      expect(matchesFilter({ type: null }, 'type', 'eq', 'work')).toBe(false);
    });

    it('should match when attribute name casing differs from object key (RFC 7643 §2.1)', () => {
      expect(matchesFilter({ Type: 'work' }, 'type', 'eq', 'work')).toBe(true);
    });

    it('should match with uppercase attribute name', () => {
      expect(matchesFilter({ TYPE: 'Work' }, 'TYPE', 'eq', 'work')).toBe(true);
    });

    it('should return false with case-mismatched attribute when value does not match', () => {
      expect(matchesFilter({ Type: 'home' }, 'TYPE', 'eq', 'work')).toBe(false);
    });
  });

  // ─── applyValuePathUpdate ────────────────────────────────────────────

  describe('applyValuePathUpdate', () => {
    it('should update sub-attribute of matching array element', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { type: 'work', value: 'old@example.com', primary: true },
          { type: 'home', value: 'home@example.com' },
        ],
      };

      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = applyValuePathUpdate(payload, parsed, 'new@example.com');

      expect((result.emails as Record<string, unknown>[])[0].value).toBe('new@example.com');
      // Other fields untouched
      expect((result.emails as Record<string, unknown>[])[0].primary).toBe(true);
      // Other element untouched
      expect((result.emails as Record<string, unknown>[])[1].value).toBe('home@example.com');
    });

    it('should not modify payload when attribute array is missing', () => {
      const payload: Record<string, unknown> = { displayName: 'Test' };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = applyValuePathUpdate(payload, parsed, 'new@example.com');
      expect(result).toEqual({ displayName: 'Test' });
    });

    it('should not modify payload when no element matches the filter', () => {
      const payload: Record<string, unknown> = {
        emails: [{ type: 'home', value: 'home@example.com' }],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = applyValuePathUpdate(payload, parsed, 'new@example.com');
      expect((result.emails as Record<string, unknown>[])[0].value).toBe('home@example.com');
    });

    it('should replace entire element when no sub-attribute', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { type: 'work', value: 'old@example.com' },
        ],
      };
      const parsed = parseValuePath('emails[type eq "work"]')!;
      const result = applyValuePathUpdate(payload, parsed, { type: 'work', value: 'replaced@example.com' });
      expect((result.emails as Record<string, unknown>[])[0]).toEqual({
        type: 'work',
        value: 'replaced@example.com',
      });
    });

    it('should update addresses sub-attribute', () => {
      const payload: Record<string, unknown> = {
        addresses: [
          { type: 'work', streetAddress: '123 Old St', locality: 'OldCity' },
        ],
      };
      const parsed = parseValuePath('addresses[type eq "work"].streetAddress')!;
      const result = applyValuePathUpdate(payload, parsed, '456 New Ave');
      expect((result.addresses as Record<string, unknown>[])[0].streetAddress).toBe('456 New Ave');
      expect((result.addresses as Record<string, unknown>[])[0].locality).toBe('OldCity');
    });

    it('should skip non-object array elements without crashing', () => {
      const payload: Record<string, unknown> = {
        emails: ['not-an-object', { type: 'work', value: 'old@example.com' }],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = applyValuePathUpdate(payload, parsed, 'new@example.com');
      expect((result.emails as unknown[])[0]).toBe('not-an-object');
      expect((result.emails as Record<string, unknown>[])[1].value).toBe('new@example.com');
    });

    it('should only update the first matching element', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { type: 'work', value: 'first@example.com' },
          { type: 'work', value: 'second@example.com' },
        ],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = applyValuePathUpdate(payload, parsed, 'updated@example.com');
      expect((result.emails as Record<string, unknown>[])[0].value).toBe('updated@example.com');
      expect((result.emails as Record<string, unknown>[])[1].value).toBe('second@example.com');
    });
  });

  // ─── removeValuePathEntry ────────────────────────────────────────────

  describe('removeValuePathEntry', () => {
    it('should remove sub-attribute from matching element', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { type: 'work', value: 'work@example.com', primary: true },
        ],
      };
      const parsed = parseValuePath('emails[type eq "work"].primary')!;
      const result = removeValuePathEntry(payload, parsed);
      const emails = result.emails as Record<string, unknown>[];
      expect(emails[0]).toEqual({ type: 'work', value: 'work@example.com' });
    });

    it('should remove entire matching element when no sub-attribute', () => {
      const payload: Record<string, unknown> = {
        emails: [
          { type: 'work', value: 'work@example.com' },
          { type: 'home', value: 'home@example.com' },
        ],
      };
      const parsed = parseValuePath('emails[type eq "work"]')!;
      const result = removeValuePathEntry(payload, parsed);
      expect((result.emails as Record<string, unknown>[]).length).toBe(1);
      expect((result.emails as Record<string, unknown>[])[0].type).toBe('home');
    });

    it('should be a no-op when no element matches the filter', () => {
      const payload: Record<string, unknown> = {
        emails: [{ type: 'home', value: 'home@example.com' }],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = removeValuePathEntry(payload, parsed);
      // Nothing should change
      expect((result.emails as Record<string, unknown>[]).length).toBe(1);
      expect((result.emails as Record<string, unknown>[])[0].value).toBe('home@example.com');
    });

    it('should be a no-op when attribute array does not exist', () => {
      const payload: Record<string, unknown> = { displayName: 'Test' };
      const parsed = parseValuePath('emails[type eq "work"]')!;
      const result = removeValuePathEntry(payload, parsed);
      expect(result).toEqual({ displayName: 'Test' });
    });
  });

  // ─── applyExtensionUpdate ────────────────────────────────────────────

  describe('applyExtensionUpdate', () => {
    const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should add attribute to existing extension object', () => {
      const payload: Record<string, unknown> = {
        [URN]: { department: 'Engineering' },
      };
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = applyExtensionUpdate(payload, parsed, { value: 'MGR-123' });
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toEqual({ value: 'MGR-123' });
      expect(ext.department).toBe('Engineering');
    });

    it('should create extension object if it does not exist', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = applyExtensionUpdate(payload, parsed, { value: 'MGR-456' });
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toEqual({ value: 'MGR-456' });
    });

    it('should replace existing extension attribute value', () => {
      const payload: Record<string, unknown> = {
        [URN]: { manager: { value: 'OLD' } },
      };
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = applyExtensionUpdate(payload, parsed, { value: 'NEW' });
      expect((result[URN] as Record<string, unknown>).manager).toEqual({ value: 'NEW' });
    });

    it('should handle string value (not just objects)', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseExtensionPath(`${URN}:department`)!;
      const result = applyExtensionUpdate(payload, parsed, 'Finance');
      expect((result[URN] as Record<string, unknown>).department).toBe('Finance');
    });
  });

  // ─── removeExtensionAttribute ────────────────────────────────────────

  describe('removeExtensionAttribute', () => {
    const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should remove attribute from extension object', () => {
      const payload: Record<string, unknown> = {
        [URN]: { manager: { value: 'MGR' }, department: 'Eng' },
      };
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = removeExtensionAttribute(payload, parsed);
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toBeUndefined();
      expect(ext.department).toBe('Eng');
    });

    it('should be a no-op when extension object does not exist', () => {
      const payload: Record<string, unknown> = { displayName: 'Test' };
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = removeExtensionAttribute(payload, parsed);
      expect(result).toEqual({ displayName: 'Test' });
    });

    it('should leave empty extension object when last attribute removed', () => {
      const payload: Record<string, unknown> = {
        [URN]: { manager: { value: 'MGR' } },
      };
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = removeExtensionAttribute(payload, parsed);
      expect(result[URN]).toEqual({});
    });
  });

  // ─── addValuePathEntry (Bug C fix) ───────────────────────────────────

  describe('addValuePathEntry', () => {
    it('should create array and new element when attribute does not exist', () => {
      const payload: Record<string, unknown> = { displayName: 'Test' };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = addValuePathEntry(payload, parsed, 'new@example.com');
      const emails = result.emails as Record<string, unknown>[];
      expect(emails).toHaveLength(1);
      expect(emails[0]).toEqual({ type: 'work', value: 'new@example.com' });
    });

    it('should add new element when no existing element matches filter', () => {
      const payload: Record<string, unknown> = {
        emails: [{ type: 'home', value: 'home@example.com' }],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = addValuePathEntry(payload, parsed, 'work@example.com');
      const emails = result.emails as Record<string, unknown>[];
      expect(emails).toHaveLength(2);
      expect(emails[1]).toEqual({ type: 'work', value: 'work@example.com' });
    });

    it('should update existing element when filter matches', () => {
      const payload: Record<string, unknown> = {
        emails: [{ type: 'work', value: 'old@example.com', primary: true }],
      };
      const parsed = parseValuePath('emails[type eq "work"].value')!;
      const result = addValuePathEntry(payload, parsed, 'new@example.com');
      const emails = result.emails as Record<string, unknown>[];
      expect(emails).toHaveLength(1);
      expect(emails[0].value).toBe('new@example.com');
      expect(emails[0].primary).toBe(true);
    });

    it('should replace entire element when no sub-attribute and filter matches', () => {
      const payload: Record<string, unknown> = {
        emails: [{ type: 'work', value: 'old@example.com' }],
      };
      const parsed = parseValuePath('emails[type eq "work"]')!;
      const result = addValuePathEntry(payload, parsed, { type: 'work', value: 'replaced@example.com' });
      const emails = result.emails as Record<string, unknown>[];
      expect(emails).toHaveLength(1);
      expect(emails[0]).toEqual({ type: 'work', value: 'replaced@example.com' });
    });

    it('should create element with filter criteria when no sub-attribute and no match', () => {
      const payload: Record<string, unknown> = { emails: [] };
      const parsed = parseValuePath('emails[type eq "work"]')!;
      const result = addValuePathEntry(payload, parsed, { type: 'work', value: 'brand-new@example.com' });
      const emails = result.emails as Record<string, unknown>[];
      expect(emails).toHaveLength(1);
      // When no sub-attribute, the value itself replaces the entry
    });

    it('should handle phoneNumbers array creation', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseValuePath('phoneNumbers[type eq "mobile"].value')!;
      const result = addValuePathEntry(payload, parsed, '+1-555-0199');
      const phones = result.phoneNumbers as Record<string, unknown>[];
      expect(phones).toHaveLength(1);
      expect(phones[0]).toEqual({ type: 'mobile', value: '+1-555-0199' });
    });
  });

  // ─── applyExtensionUpdate – manager string wrapping (Bug D fix) ──────

  describe('applyExtensionUpdate – manager string wrapping', () => {
    const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should wrap string manager value as {value} object', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const result = applyExtensionUpdate(payload, parsed, 'MGR-STRING');
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toEqual({ value: 'MGR-STRING' });
    });

    it('should NOT wrap non-manager string attributes', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseExtensionPath(`${URN}:department`)!;
      const result = applyExtensionUpdate(payload, parsed, 'Engineering');
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.department).toBe('Engineering');
    });

    it('should pass through object manager value unchanged', () => {
      const payload: Record<string, unknown> = {};
      const parsed = parseExtensionPath(`${URN}:manager`)!;
      const managerObj = { value: 'MGR-001', displayName: 'Bob' };
      const result = applyExtensionUpdate(payload, parsed, managerObj);
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toEqual({ value: 'MGR-001', displayName: 'Bob' });
    });
  });

  // ─── resolveNoPathValue (Bug A fix) ──────────────────────────────────

  describe('resolveNoPathValue', () => {
    const URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

    it('should resolve dot-notation key to nested object', () => {
      const payload: Record<string, unknown> = {
        name: { givenName: 'Alice', familyName: 'Old' },
      };
      const result = resolveNoPathValue(payload, { 'name.familyName': 'New' });
      expect(result.name).toEqual({ givenName: 'Alice', familyName: 'New' });
    });

    it('should create nested object when parent does not exist', () => {
      const payload: Record<string, unknown> = {};
      const result = resolveNoPathValue(payload, { 'name.givenName': 'Alice' });
      expect(result.name).toEqual({ givenName: 'Alice' });
    });

    it('should resolve extension URN keys', () => {
      const payload: Record<string, unknown> = {};
      const result = resolveNoPathValue(payload, {
        [`${URN}:employeeNumber`]: 'EMP-999',
      });
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.employeeNumber).toBe('EMP-999');
    });

    it('should resolve flat keys directly', () => {
      const payload: Record<string, unknown> = { displayName: 'Old' };
      const result = resolveNoPathValue(payload, { displayName: 'Updated' });
      expect(result.displayName).toBe('Updated');
    });

    it('should handle mixed key types in one call', () => {
      const payload: Record<string, unknown> = {
        displayName: 'Old',
        name: { givenName: 'Alice', familyName: 'Old' },
      };
      const result = resolveNoPathValue(payload, {
        displayName: 'Updated Name',
        'name.givenName': 'Alicia',
        [`${URN}:department`]: 'Platform',
      });
      expect(result.displayName).toBe('Updated Name');
      expect((result.name as Record<string, unknown>).givenName).toBe('Alicia');
      expect((result.name as Record<string, unknown>).familyName).toBe('Old');
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.department).toBe('Platform');
    });

    it('should not clobber sibling attributes when updating dot-notation', () => {
      const payload: Record<string, unknown> = {
        name: { givenName: 'Alice', familyName: 'Example', formatted: 'Alice Example' },
      };
      const result = resolveNoPathValue(payload, { 'name.givenName': 'Bob' });
      const name = result.name as Record<string, unknown>;
      expect(name.givenName).toBe('Bob');
      expect(name.familyName).toBe('Example');
      expect(name.formatted).toBe('Alice Example');
    });

    it('should wrap manager URN value as {value} object when string', () => {
      const payload: Record<string, unknown> = {};
      const result = resolveNoPathValue(payload, {
        [`${URN}:manager`]: 'MGR-STRING',
      });
      const ext = result[URN] as Record<string, unknown>;
      expect(ext.manager).toEqual({ value: 'MGR-STRING' });
    });
  });
});
