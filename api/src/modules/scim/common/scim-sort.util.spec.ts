/**
 * Unit tests for SCIM Sort Utility — RFC 7644 §3.4.2.3
 */
import {
  resolveUserSortParams,
  resolveGroupSortParams,
} from './scim-sort.util';

describe('scim-sort.util', () => {
  describe('resolveUserSortParams', () => {
    it('should default to createdAt ascending when no sortBy', () => {
      const result = resolveUserSortParams();
      expect(result).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should default to ascending when sortOrder not specified', () => {
      const result = resolveUserSortParams('userName');
      expect(result).toEqual({ field: 'userName', direction: 'asc' });
    });

    it('should map userName to userName (case-insensitive)', () => {
      expect(resolveUserSortParams('userName')).toEqual({ field: 'userName', direction: 'asc' });
      expect(resolveUserSortParams('USERNAME')).toEqual({ field: 'userName', direction: 'asc' });
      expect(resolveUserSortParams('UserName')).toEqual({ field: 'userName', direction: 'asc' });
    });

    it('should map id to scimId', () => {
      expect(resolveUserSortParams('id')).toEqual({ field: 'scimId', direction: 'asc' });
    });

    it('should map externalId to externalId (case-insensitive)', () => {
      expect(resolveUserSortParams('externalId')).toEqual({ field: 'externalId', direction: 'asc' });
      expect(resolveUserSortParams('EXTERNALID')).toEqual({ field: 'externalId', direction: 'asc' });
    });

    it('should map displayName to displayName', () => {
      expect(resolveUserSortParams('displayName')).toEqual({ field: 'displayName', direction: 'asc' });
    });

    it('should map meta.created to createdAt', () => {
      expect(resolveUserSortParams('meta.created')).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should map meta.lastModified to updatedAt (case-insensitive)', () => {
      expect(resolveUserSortParams('meta.lastModified')).toEqual({ field: 'updatedAt', direction: 'asc' });
      expect(resolveUserSortParams('meta.lastmodified')).toEqual({ field: 'updatedAt', direction: 'asc' });
    });

    it('should handle descending sort order', () => {
      expect(resolveUserSortParams('userName', 'descending')).toEqual({ field: 'userName', direction: 'desc' });
    });

    it('should handle ascending sort order explicitly', () => {
      expect(resolveUserSortParams('userName', 'ascending')).toEqual({ field: 'userName', direction: 'asc' });
    });

    it('should fall back to createdAt for unknown attribute', () => {
      expect(resolveUserSortParams('unknownAttribute')).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should fall back to createdAt descending for unknown attribute with descending', () => {
      expect(resolveUserSortParams('noSuchField', 'descending')).toEqual({ field: 'createdAt', direction: 'desc' });
    });

    it('should map active attribute', () => {
      expect(resolveUserSortParams('active')).toEqual({ field: 'active', direction: 'asc' });
    });
  });

  describe('resolveGroupSortParams', () => {
    it('should default to createdAt ascending when no sortBy', () => {
      const result = resolveGroupSortParams();
      expect(result).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should map displayName to displayName', () => {
      expect(resolveGroupSortParams('displayName')).toEqual({ field: 'displayName', direction: 'asc' });
    });

    it('should map id to scimId', () => {
      expect(resolveGroupSortParams('id')).toEqual({ field: 'scimId', direction: 'asc' });
    });

    it('should map meta.created to createdAt', () => {
      expect(resolveGroupSortParams('meta.created')).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should handle descending sort order', () => {
      expect(resolveGroupSortParams('displayName', 'descending')).toEqual({ field: 'displayName', direction: 'desc' });
    });

    it('should fall back to createdAt for unknown attribute', () => {
      expect(resolveGroupSortParams('members')).toEqual({ field: 'createdAt', direction: 'asc' });
    });

    it('should be case-insensitive for attribute names', () => {
      expect(resolveGroupSortParams('DISPLAYNAME')).toEqual({ field: 'displayName', direction: 'asc' });
      expect(resolveGroupSortParams('Meta.Created')).toEqual({ field: 'createdAt', direction: 'asc' });
    });
  });
});
