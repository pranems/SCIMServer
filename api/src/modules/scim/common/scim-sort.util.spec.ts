/**
 * Unit tests for SCIM Sort Utility - RFC 7644 §3.4.2.3
 */
import {
  resolveUserSortParams,
  resolveGroupSortParams,
} from './scim-sort.util';

describe('scim-sort.util', () => {
  describe('resolveUserSortParams', () => {
    it('should default to createdAt ascending caseExact when no sortBy', () => {
      const result = resolveUserSortParams();
      expect(result).toEqual({ field: 'createdAt', direction: 'asc', caseExact: true });
    });

    it('should default to ascending when sortOrder not specified', () => {
      const result = resolveUserSortParams('userName');
      expect(result.direction).toBe('asc');
    });

    it('should map userName to userName (case-insensitive)', () => {
      expect(resolveUserSortParams('userName').field).toBe('userName');
      expect(resolveUserSortParams('USERNAME').field).toBe('userName');
      expect(resolveUserSortParams('UserName').field).toBe('userName');
    });

    it('should map id to scimId', () => {
      expect(resolveUserSortParams('id').field).toBe('scimId');
    });

    it('should map externalId to externalId (case-insensitive)', () => {
      expect(resolveUserSortParams('externalId').field).toBe('externalId');
      expect(resolveUserSortParams('EXTERNALID').field).toBe('externalId');
    });

    it('should map displayName to displayName', () => {
      expect(resolveUserSortParams('displayName').field).toBe('displayName');
    });

    it('should map meta.created to createdAt', () => {
      expect(resolveUserSortParams('meta.created').field).toBe('createdAt');
    });

    it('should map meta.lastModified to updatedAt (case-insensitive)', () => {
      expect(resolveUserSortParams('meta.lastModified').field).toBe('updatedAt');
      expect(resolveUserSortParams('meta.lastmodified').field).toBe('updatedAt');
    });

    it('should handle descending sort order', () => {
      expect(resolveUserSortParams('userName', 'descending').direction).toBe('desc');
    });

    it('should handle ascending sort order explicitly', () => {
      expect(resolveUserSortParams('userName', 'ascending').direction).toBe('asc');
    });

    it('should fall back to createdAt for unknown attribute', () => {
      expect(resolveUserSortParams('unknownAttribute').field).toBe('createdAt');
    });

    it('should fall back to createdAt descending for unknown attribute with descending', () => {
      const result = resolveUserSortParams('noSuchField', 'descending');
      expect(result).toEqual({ field: 'createdAt', direction: 'desc', caseExact: true });
    });

    it('should map active attribute', () => {
      expect(resolveUserSortParams('active').field).toBe('active');
    });

    // ─── caseExact-aware sorting ────────────────────────────────

    it('should set caseExact=false when sortBy attr is not in caseExactPaths', () => {
      const caseExactPaths = new Set(['id', 'externalid']);
      const result = resolveUserSortParams('userName', undefined, caseExactPaths);
      expect(result.caseExact).toBe(false);
    });

    it('should set caseExact=true when sortBy attr IS in caseExactPaths', () => {
      const caseExactPaths = new Set(['id', 'externalid']);
      const result = resolveUserSortParams('externalId', undefined, caseExactPaths);
      expect(result.caseExact).toBe(true);
    });

    it('should set caseExact=false when no caseExactPaths provided', () => {
      const result = resolveUserSortParams('userName');
      expect(result.caseExact).toBe(false);
    });

    it('should set caseExact=true for fallback field when sortBy is unknown', () => {
      const caseExactPaths = new Set(['id']);
      const result = resolveUserSortParams('badField', undefined, caseExactPaths);
      expect(result.caseExact).toBe(true); // createdAt fallback is always caseExact
    });

    it('should set caseExact=true for id sort', () => {
      const caseExactPaths = new Set(['id']);
      const result = resolveUserSortParams('id', undefined, caseExactPaths);
      expect(result.caseExact).toBe(true);
    });
  });

  describe('resolveGroupSortParams', () => {
    it('should default to createdAt ascending caseExact when no sortBy', () => {
      const result = resolveGroupSortParams();
      expect(result).toEqual({ field: 'createdAt', direction: 'asc', caseExact: true });
    });

    it('should map displayName to displayName', () => {
      expect(resolveGroupSortParams('displayName').field).toBe('displayName');
    });

    it('should map id to scimId', () => {
      expect(resolveGroupSortParams('id').field).toBe('scimId');
    });

    it('should map meta.created to createdAt', () => {
      expect(resolveGroupSortParams('meta.created').field).toBe('createdAt');
    });

    it('should handle descending sort order', () => {
      expect(resolveGroupSortParams('displayName', 'descending').direction).toBe('desc');
    });

    it('should fall back to createdAt for unknown attribute', () => {
      expect(resolveGroupSortParams('members').field).toBe('createdAt');
    });

    it('should be case-insensitive for attribute names', () => {
      expect(resolveGroupSortParams('DISPLAYNAME').field).toBe('displayName');
      expect(resolveGroupSortParams('Meta.Created').field).toBe('createdAt');
    });

    // ─── caseExact-aware sorting ────────────────────────────────

    it('should set caseExact=true when sortBy attr is in caseExactPaths', () => {
      const caseExactPaths = new Set(['id', 'externalid']);
      const result = resolveGroupSortParams('externalId', undefined, caseExactPaths);
      expect(result.caseExact).toBe(true);
    });

    it('should set caseExact=false for displayName when not in caseExactPaths', () => {
      const caseExactPaths = new Set(['id']);
      const result = resolveGroupSortParams('displayName', undefined, caseExactPaths);
      expect(result.caseExact).toBe(false);
    });
  });

  // ─── G6: writeOnly attributes in sortBy ─────────────────────────

  describe('G6 - writeOnly attribute in sortBy silently ignored', () => {
    it('should fall back to default sort for password (writeOnly, not in sort map)', () => {
      const result = resolveUserSortParams('password');
      expect(result.field).toBe('createdAt'); // silent fallback per RFC 7644 §3.4.2.3
      expect(result.direction).toBe('asc');
    });

    it('should fall back for any unknown/writeOnly attribute on Groups', () => {
      const result = resolveGroupSortParams('password');
      expect(result.field).toBe('createdAt');
    });

    it('should NOT leak writeOnly attribute values via sort ordering', () => {
      // Password is writeOnly - if it were in the sort map, an attacker could
      // infer password values by observing sort ordering. The silent fallback
      // to createdAt prevents this. RFC 7644 §3.4.2.3: unknown attrs SHALL be ignored.
      const userResult = resolveUserSortParams('password');
      const groupResult = resolveGroupSortParams('password');
      expect(userResult.field).toBe('createdAt');
      expect(groupResult.field).toBe('createdAt');
    });
  });
});
