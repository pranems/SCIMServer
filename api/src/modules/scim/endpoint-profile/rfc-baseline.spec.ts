/**
 * Unit Tests — RFC Baseline Constants (Phase 13, Step 1.2)
 *
 * Validates that the RFC baseline attribute maps, required attribute lists,
 * and project auto-inject constants are correctly structured and contain
 * the expected entries per RFC 7643 §4.1/§4.2/§4.3.
 */
import {
  RFC_USER_ATTRIBUTES,
  RFC_GROUP_ATTRIBUTES,
  RFC_ENTERPRISE_USER_ATTRIBUTES,
  RFC_USER_ATTRIBUTE_MAP,
  RFC_GROUP_ATTRIBUTE_MAP,
  RFC_ENTERPRISE_USER_ATTRIBUTE_MAP,
  RFC_SCHEMA_ATTRIBUTE_MAPS,
  RFC_SCHEMA_ALL_ATTRIBUTES,
  RFC_REQUIRED_ATTRIBUTES,
  PROJECT_AUTO_INJECT_ATTRIBUTES,
  GROUP_ALWAYS_INCLUDE_ATTRIBUTES,
} from './rfc-baseline';
import {
  SCIM_CORE_USER_SCHEMA,
  SCIM_CORE_GROUP_SCHEMA,
  SCIM_ENTERPRISE_USER_SCHEMA,
} from '../common/scim-constants';

describe('rfc-baseline', () => {
  // ─── Re-exported attribute arrays ──────────────────────────────────────

  describe('RFC_USER_ATTRIBUTES', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(RFC_USER_ATTRIBUTES)).toBe(true);
      expect(RFC_USER_ATTRIBUTES.length).toBeGreaterThan(0);
    });

    it('should contain id (RFC 7643 §3.1)', () => {
      const id = (RFC_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'id');
      expect(id).toBeDefined();
      expect(id!.required).toBe(true);
      expect(id!.mutability).toBe('readOnly');
      expect(id!.returned).toBe('always');
      expect(id!.uniqueness).toBe('server');
    });

    it('should contain userName (RFC 7643 §4.1 — only required client attribute)', () => {
      const userName = (RFC_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'userName');
      expect(userName).toBeDefined();
      expect(userName!.required).toBe(true);
      expect(userName!.mutability).toBe('readWrite');
      expect(userName!.uniqueness).toBe('server');
    });

    it('should contain all standard User attributes', () => {
      const names = (RFC_USER_ATTRIBUTES as readonly any[]).map((a: any) => a.name);
      expect(names).toContain('name');
      expect(names).toContain('displayName');
      expect(names).toContain('emails');
      expect(names).toContain('active');
      expect(names).toContain('phoneNumbers');
      expect(names).toContain('addresses');
      expect(names).toContain('roles');
      expect(names).toContain('groups');
      expect(names).toContain('password');
      expect(names).toContain('externalId');
      expect(names).toContain('meta');
    });

    it('should have password as writeOnly/returned:never', () => {
      const password = (RFC_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'password');
      expect(password).toBeDefined();
      expect(password!.mutability).toBe('writeOnly');
      expect(password!.returned).toBe('never');
    });

    it('should have non-required optional attributes', () => {
      const displayName = (RFC_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'displayName');
      expect(displayName).toBeDefined();
      expect(displayName!.required).toBe(false);
    });

    it('should have emails as complex multiValued', () => {
      const emails = (RFC_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'emails');
      expect(emails).toBeDefined();
      expect(emails!.type).toBe('complex');
      expect(emails!.multiValued).toBe(true);
      expect(emails!.subAttributes).toBeDefined();
      expect(emails!.subAttributes!.length).toBeGreaterThan(0);
    });
  });

  describe('RFC_GROUP_ATTRIBUTES', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(RFC_GROUP_ATTRIBUTES)).toBe(true);
      expect(RFC_GROUP_ATTRIBUTES.length).toBeGreaterThan(0);
    });

    it('should contain id (RFC 7643 §3.1)', () => {
      const id = (RFC_GROUP_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'id');
      expect(id).toBeDefined();
      expect(id!.required).toBe(true);
      expect(id!.mutability).toBe('readOnly');
    });

    it('should contain displayName (RFC 7643 §4.2 — required)', () => {
      const dn = (RFC_GROUP_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'displayName');
      expect(dn).toBeDefined();
      expect(dn!.required).toBe(true);
    });

    it('should contain members as complex multiValued', () => {
      const members = (RFC_GROUP_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'members');
      expect(members).toBeDefined();
      expect(members!.type).toBe('complex');
      expect(members!.multiValued).toBe(true);
    });

    it('should NOT contain active (settings v7: D7 removed)', () => {
      const active = (RFC_GROUP_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'active');
      expect(active).toBeUndefined();
    });
  });

  describe('RFC_ENTERPRISE_USER_ATTRIBUTES', () => {
    it('should be a non-empty array', () => {
      expect(Array.isArray(RFC_ENTERPRISE_USER_ATTRIBUTES)).toBe(true);
      expect(RFC_ENTERPRISE_USER_ATTRIBUTES.length).toBeGreaterThan(0);
    });

    it('should contain employeeNumber', () => {
      const attr = (RFC_ENTERPRISE_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'employeeNumber');
      expect(attr).toBeDefined();
      expect(attr!.type).toBe('string');
    });

    it('should contain manager (complex)', () => {
      const manager = (RFC_ENTERPRISE_USER_ATTRIBUTES as readonly any[]).find((a: any) => a.name === 'manager');
      expect(manager).toBeDefined();
      expect(manager!.type).toBe('complex');
      expect(manager!.subAttributes).toBeDefined();
    });

    it('should contain all 6 enterprise attributes', () => {
      const names = (RFC_ENTERPRISE_USER_ATTRIBUTES as readonly any[]).map((a: any) => a.name);
      expect(names).toContain('employeeNumber');
      expect(names).toContain('costCenter');
      expect(names).toContain('organization');
      expect(names).toContain('division');
      expect(names).toContain('department');
      expect(names).toContain('manager');
      expect(names).toHaveLength(6);
    });
  });

  // ─── Attribute Lookup Maps ─────────────────────────────────────────────

  describe('RFC_USER_ATTRIBUTE_MAP', () => {
    it('should be a Map', () => {
      expect(RFC_USER_ATTRIBUTE_MAP).toBeInstanceOf(Map);
    });

    it('should resolve userName (case-insensitive key)', () => {
      const attr = RFC_USER_ATTRIBUTE_MAP.get('username');
      expect(attr).toBeDefined();
      expect(attr!.name).toBe('userName');
      expect(attr!.required).toBe(true);
    });

    it('should resolve externalid (lowercase lookup)', () => {
      const attr = RFC_USER_ATTRIBUTE_MAP.get('externalid');
      expect(attr).toBeDefined();
      expect(attr!.name).toBe('externalId');
    });

    it('should not resolve unknown attribute', () => {
      expect(RFC_USER_ATTRIBUTE_MAP.get('nonexistent')).toBeUndefined();
    });

    it('should have same count as User attribute array', () => {
      expect(RFC_USER_ATTRIBUTE_MAP.size).toBe(RFC_USER_ATTRIBUTES.length);
    });
  });

  describe('RFC_GROUP_ATTRIBUTE_MAP', () => {
    it('should resolve displayname (lowercase)', () => {
      const attr = RFC_GROUP_ATTRIBUTE_MAP.get('displayname');
      expect(attr).toBeDefined();
      expect(attr!.name).toBe('displayName');
    });

    it('should resolve members', () => {
      expect(RFC_GROUP_ATTRIBUTE_MAP.get('members')).toBeDefined();
    });

    it('should have same count as Group attribute array', () => {
      expect(RFC_GROUP_ATTRIBUTE_MAP.size).toBe(RFC_GROUP_ATTRIBUTES.length);
    });
  });

  describe('RFC_ENTERPRISE_USER_ATTRIBUTE_MAP', () => {
    it('should resolve employeenumber (lowercase)', () => {
      const attr = RFC_ENTERPRISE_USER_ATTRIBUTE_MAP.get('employeenumber');
      expect(attr).toBeDefined();
      expect(attr!.name).toBe('employeeNumber');
    });

    it('should have same count as EnterpriseUser attribute array', () => {
      expect(RFC_ENTERPRISE_USER_ATTRIBUTE_MAP.size).toBe(RFC_ENTERPRISE_USER_ATTRIBUTES.length);
    });
  });

  // ─── Schema URN → Attribute Map Registry ──────────────────────────────

  describe('RFC_SCHEMA_ATTRIBUTE_MAPS', () => {
    it('should contain 3 schema URNs', () => {
      expect(RFC_SCHEMA_ATTRIBUTE_MAPS.size).toBe(3);
    });

    it('should have User schema map', () => {
      const map = RFC_SCHEMA_ATTRIBUTE_MAPS.get(SCIM_CORE_USER_SCHEMA);
      expect(map).toBeDefined();
      expect(map).toBe(RFC_USER_ATTRIBUTE_MAP);
    });

    it('should have Group schema map', () => {
      const map = RFC_SCHEMA_ATTRIBUTE_MAPS.get(SCIM_CORE_GROUP_SCHEMA);
      expect(map).toBeDefined();
      expect(map).toBe(RFC_GROUP_ATTRIBUTE_MAP);
    });

    it('should have EnterpriseUser schema map', () => {
      const map = RFC_SCHEMA_ATTRIBUTE_MAPS.get(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(map).toBeDefined();
      expect(map).toBe(RFC_ENTERPRISE_USER_ATTRIBUTE_MAP);
    });

    it('should not have unknown schema URN', () => {
      expect(RFC_SCHEMA_ATTRIBUTE_MAPS.get('urn:unknown:schema')).toBeUndefined();
    });
  });

  describe('RFC_SCHEMA_ALL_ATTRIBUTES', () => {
    it('should contain 3 schema URNs', () => {
      expect(RFC_SCHEMA_ALL_ATTRIBUTES.size).toBe(3);
    });

    it('should return full User attribute array for "all" expansion', () => {
      const attrs = RFC_SCHEMA_ALL_ATTRIBUTES.get(SCIM_CORE_USER_SCHEMA);
      expect(attrs).toBeDefined();
      expect(attrs!.length).toBe(RFC_USER_ATTRIBUTES.length);
    });

    it('should return full Group attribute array', () => {
      const attrs = RFC_SCHEMA_ALL_ATTRIBUTES.get(SCIM_CORE_GROUP_SCHEMA);
      expect(attrs).toBeDefined();
      expect(attrs!.length).toBe(RFC_GROUP_ATTRIBUTES.length);
    });

    it('should return full EnterpriseUser attribute array', () => {
      const attrs = RFC_SCHEMA_ALL_ATTRIBUTES.get(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(attrs).toBeDefined();
      expect(attrs!.length).toBe(RFC_ENTERPRISE_USER_ATTRIBUTES.length);
    });
  });

  // ─── Required Attributes ──────────────────────────────────────────────

  describe('RFC_REQUIRED_ATTRIBUTES', () => {
    it('should have User with id + userName required', () => {
      const required = RFC_REQUIRED_ATTRIBUTES.get(SCIM_CORE_USER_SCHEMA);
      expect(required).toBeDefined();
      expect(required).toContain('id');
      expect(required).toContain('userName');
      expect(required).toHaveLength(2);
    });

    it('should have Group with id + displayName required', () => {
      const required = RFC_REQUIRED_ATTRIBUTES.get(SCIM_CORE_GROUP_SCHEMA);
      expect(required).toBeDefined();
      expect(required).toContain('id');
      expect(required).toContain('displayName');
      expect(required).toHaveLength(2);
    });

    it('should have EnterpriseUser with no required attributes', () => {
      const required = RFC_REQUIRED_ATTRIBUTES.get(SCIM_ENTERPRISE_USER_SCHEMA);
      expect(required).toBeDefined();
      expect(required).toHaveLength(0);
    });
  });

  // ─── Project Auto-Inject Constants ────────────────────────────────────

  describe('PROJECT_AUTO_INJECT_ATTRIBUTES', () => {
    it('should include externalId', () => {
      expect(PROJECT_AUTO_INJECT_ATTRIBUTES).toContain('externalId');
    });

    it('should include meta', () => {
      expect(PROJECT_AUTO_INJECT_ATTRIBUTES).toContain('meta');
    });

    it('should have exactly 2 entries', () => {
      expect(PROJECT_AUTO_INJECT_ATTRIBUTES).toHaveLength(2);
    });
  });

  describe('GROUP_ALWAYS_INCLUDE_ATTRIBUTES', () => {
    it('should include active (project addition for soft-delete)', () => {
      expect(GROUP_ALWAYS_INCLUDE_ATTRIBUTES).toContain('active');
    });

    it('should have exactly 1 entry', () => {
      expect(GROUP_ALWAYS_INCLUDE_ATTRIBUTES).toHaveLength(1);
    });
  });
});
