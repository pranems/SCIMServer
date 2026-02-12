import {
  applyAttributeProjection,
  applyAttributeProjectionToList,
} from './scim-attribute-projection';

describe('applyAttributeProjection', () => {
  const fullUser = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: 'user-123',
    userName: 'alice@example.com',
    displayName: 'Alice Example',
    active: true,
    externalId: 'ext-001',
    name: {
      givenName: 'Alice',
      familyName: 'Example',
      formatted: 'Alice Example',
    },
    emails: [
      { value: 'alice@work.com', type: 'work', primary: true },
    ],
    meta: {
      resourceType: 'User',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-06-01T00:00:00Z',
      location: 'https://example.com/Users/user-123',
      version: 'W/"2025-06-01T00:00:00Z"',
    },
  };

  // ─── No projection ──────────────────────────────────────────────────────

  it('should return resource as-is when neither attributes nor excludedAttributes specified', () => {
    const result = applyAttributeProjection(fullUser);
    expect(result).toBe(fullUser);
  });

  it('should return resource as-is when both params are undefined', () => {
    const result = applyAttributeProjection(fullUser, undefined, undefined);
    expect(result).toBe(fullUser);
  });

  // ─── attributes (include only) ─────────────────────────────────────────

  describe('attributes parameter', () => {
    it('should include only specified attributes plus always-returned ones', () => {
      const result = applyAttributeProjection(fullUser, 'userName,displayName');
      expect(result.schemas).toBeDefined();
      expect(result.id).toBe('user-123');
      expect(result.meta).toBeDefined();
      expect(result.userName).toBe('alice@example.com');
      expect(result.displayName).toBe('Alice Example');
      expect(result.active).toBeUndefined();
      expect(result.externalId).toBeUndefined();
      expect(result.emails).toBeUndefined();
      expect(result.name).toBeUndefined();
    });

    it('should always include schemas, id, and meta', () => {
      const result = applyAttributeProjection(fullUser, 'userName');
      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
      expect(result.id).toBe('user-123');
      expect(result.meta).toBeDefined();
    });

    it('should support dotted sub-attribute paths', () => {
      const result = applyAttributeProjection(fullUser, 'name.givenName');
      expect(result.name).toEqual({ givenName: 'Alice' });
      expect((result.name as any).familyName).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const result = applyAttributeProjection(fullUser, 'USERNAME,DISPLAYNAME');
      expect(result.userName).toBe('alice@example.com');
      expect(result.displayName).toBe('Alice Example');
    });

    it('should handle attribute that does not exist gracefully', () => {
      const result = applyAttributeProjection(fullUser, 'nonExistent,userName');
      expect(result.userName).toBe('alice@example.com');
      expect(result).not.toHaveProperty('nonExistent');
    });

    it('should include full attribute when both full and sub are requested', () => {
      const result = applyAttributeProjection(fullUser, 'name,name.givenName');
      expect(result.name).toEqual(fullUser.name);
    });
  });

  // ─── excludedAttributes ─────────────────────────────────────────────────

  describe('excludedAttributes parameter', () => {
    it('should exclude specified attributes', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'emails,name');
      expect(result.userName).toBe('alice@example.com');
      expect(result.displayName).toBe('Alice Example');
      expect(result.emails).toBeUndefined();
      expect(result.name).toBeUndefined();
    });

    it('should never exclude always-returned attributes (schemas, id, meta)', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'schemas,id,meta');
      expect(result.schemas).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.meta).toBeDefined();
    });

    it('should support dotted sub-attribute paths for exclusion', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'name.formatted');
      const name = result.name as Record<string, unknown>;
      expect(name.givenName).toBe('Alice');
      expect(name.familyName).toBe('Example');
      expect(name.formatted).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'EMAILS,DISPLAYNAME');
      expect(result.emails).toBeUndefined();
      expect(result.displayName).toBeUndefined();
    });
  });

  // ─── precedence ─────────────────────────────────────────────────────────

  describe('precedence', () => {
    it('should give attributes precedence over excludedAttributes per RFC 7644 §3.4.2.5', () => {
      const result = applyAttributeProjection(
        fullUser,
        'userName',        // include
        'userName'         // exclude
      );
      // attributes wins → userName should be included
      expect(result.userName).toBe('alice@example.com');
    });
  });
});

// ─── List Projection ──────────────────────────────────────────────────────

describe('applyAttributeProjectionToList', () => {
  const resources = [
    { schemas: ['s1'], id: '1', userName: 'alice', active: true, meta: {} },
    { schemas: ['s1'], id: '2', userName: 'bob', active: false, meta: {} },
  ];

  it('should return resources as-is when no projection params', () => {
    const result = applyAttributeProjectionToList(resources);
    expect(result).toBe(resources);
  });

  it('should apply projection to all resources in the list', () => {
    const result = applyAttributeProjectionToList(resources, 'userName');
    expect(result).toHaveLength(2);
    expect(result[0].userName).toBe('alice');
    expect(result[0].active).toBeUndefined();
    expect(result[1].userName).toBe('bob');
    expect(result[1].active).toBeUndefined();
  });

  it('should apply exclusion to all resources in the list', () => {
    const result = applyAttributeProjectionToList(resources, undefined, 'active');
    expect(result).toHaveLength(2);
    expect(result[0].active).toBeUndefined();
    expect(result[1].active).toBeUndefined();
    expect(result[0].userName).toBe('alice');
  });
});
