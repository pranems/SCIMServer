import {
  applyAttributeProjection,
  applyAttributeProjectionToList,
  stripReturnedNever,
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

  const fullGroup = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: 'group-123',
    displayName: 'Engineering',
    members: [{ value: 'u1', type: 'User' }],
    meta: {
      resourceType: 'Group',
      created: '2025-01-01T00:00:00Z',
      lastModified: '2025-06-01T00:00:00Z',
      location: 'https://example.com/Groups/group-123',
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

    it('should always include schemas, id, meta, and userName for user resources', () => {
      const result = applyAttributeProjection(fullUser, 'emails');
      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:User']);
      expect(result.id).toBe('user-123');
      expect(result.meta).toBeDefined();
      expect(result.userName).toBe('alice@example.com');
      expect(result.displayName).toBeUndefined();
    });

    it('should never exclude userName for user resources', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'userName,displayName');
      expect(result.userName).toBe('alice@example.com');
      expect(result.displayName).toBeUndefined();
    });

    it('should always include displayName for group resources', () => {
      const result = applyAttributeProjection(fullGroup, 'members');
      expect(result.schemas).toEqual(['urn:ietf:params:scim:schemas:core:2.0:Group']);
      expect(result.id).toBe('group-123');
      expect(result.meta).toBeDefined();
      expect(result.displayName).toBe('Engineering');
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

    it('should never exclude always-returned attributes for user resources (schemas, id, meta, userName)', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'schemas,id,meta,userName,displayName');
      expect(result.schemas).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.userName).toBeDefined();
      expect(result.displayName).toBeUndefined();
    });

    it('should never exclude always-returned attributes for group resources (schemas, id, meta, displayName)', () => {
      const result = applyAttributeProjection(fullGroup, undefined, 'schemas,id,meta,displayName');
      expect(result.schemas).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(result.displayName).toBe('Engineering');
    });

    it('should support dotted sub-attribute paths for exclusion', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'name.formatted');
      const name = result.name as Record<string, unknown>;
      expect(name.givenName).toBe('Alice');
      expect(name.familyName).toBe('Example');
      expect(name.formatted).toBeUndefined();
    });

    it('should be case-insensitive', () => {
      const result = applyAttributeProjection(fullUser, undefined, 'EMAILS,ACTIVE');
      expect(result.emails).toBeUndefined();
      expect(result.active).toBeUndefined();
      // displayName and userName are always-returned — they should still be present
      expect(result.displayName).toBe('Alice Example');
      expect(result.userName).toBe('alice@example.com');
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

  it('should strip request-only attrs from all resources when passed', () => {
    const requestOnly = new Set(['active']);
    const result = applyAttributeProjectionToList(resources, undefined, undefined, requestOnly);
    expect(result).toHaveLength(2);
    expect(result[0].active).toBeUndefined();
    expect(result[1].active).toBeUndefined();
    expect(result[0].userName).toBe('alice');
  });
});

// ─── G8e: returned:'request' filtering ────────────────────────────────────────

describe('applyAttributeProjection with requestOnlyAttrs (G8e)', () => {
  const user = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: 'u1',
    userName: 'alice',
    displayName: 'Alice',
    costCenter: 'CC-100',
    secretField: 'hidden-value',
    meta: { resourceType: 'User' },
  };

  it('should strip request-only attrs when no attributes param specified', () => {
    const requestOnly = new Set(['costcenter', 'secretfield']);
    const result = applyAttributeProjection(user, undefined, undefined, requestOnly);
    expect(result.costCenter).toBeUndefined();
    expect(result.secretField).toBeUndefined();
    expect(result.userName).toBe('alice');
    expect(result.displayName).toBe('Alice');
  });

  it('should include request-only attrs when explicitly in attributes param', () => {
    const requestOnly = new Set(['costcenter']);
    const result = applyAttributeProjection(user, 'costCenter,userName', undefined, requestOnly);
    expect(result.costCenter).toBe('CC-100');
    expect(result.userName).toBe('alice');
    expect(result.displayName).toBeUndefined();
  });

  it('should strip request-only attrs when using excludedAttributes', () => {
    const requestOnly = new Set(['costcenter']);
    const result = applyAttributeProjection(user, undefined, 'displayName', requestOnly);
    expect(result.costCenter).toBeUndefined();
    expect(result.displayName).toBeUndefined();
    expect(result.userName).toBe('alice');
  });

  it('should not strip if requestOnlyAttrs is empty', () => {
    const result = applyAttributeProjection(user, undefined, undefined, new Set());
    expect(result.costCenter).toBe('CC-100');
    expect(result.secretField).toBe('hidden-value');
  });

  it('should not strip if requestOnlyAttrs is undefined', () => {
    const result = applyAttributeProjection(user, undefined, undefined, undefined);
    expect(result).toBe(user); // reference identity — no-op
  });

  it('should handle request-only attrs inside extension URN objects', () => {
    const userWithExt = {
      ...user,
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
        department: 'Engineering',
        costCenter: 'CC-200',
      },
    };
    const requestOnly = new Set(['costcenter']);
    const result = applyAttributeProjection(userWithExt, undefined, undefined, requestOnly);
    expect(result.costCenter).toBeUndefined();
    const ext = result['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
    expect(ext.costCenter).toBeUndefined();
    expect(ext.department).toBe('Engineering');
  });

  it('should be case-insensitive on request-only matching', () => {
    const requestOnly = new Set(['costcenter']);
    const result = applyAttributeProjection(
      { ...user, CostCenter: 'CC-300' },
      undefined, undefined, requestOnly,
    );
    expect(result.CostCenter).toBeUndefined();
  });
});

// ─── G8e: stripReturnedNever ──────────────────────────────────────────────────

describe('stripReturnedNever (G8e)', () => {
  it('should strip never-returned attributes from top level', () => {
    const resource = {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      id: 'u1',
      userName: 'alice',
      password: 'secret123',
      meta: { resourceType: 'User' },
    };
    const neverAttrs = new Set(['password']);
    const result = stripReturnedNever(resource, neverAttrs);
    expect(result.password).toBeUndefined();
    expect(result.userName).toBe('alice');
    expect(result.id).toBe('u1');
  });

  it('should strip never-returned attributes inside extension URN objects', () => {
    const resource = {
      schemas: ['s1'],
      id: 'u1',
      'urn:ext:custom': {
        department: 'Eng',
        apiSecret: 'hidden',
      },
    };
    const neverAttrs = new Set(['apisecret']);
    const result = stripReturnedNever(resource, neverAttrs);
    const ext = result['urn:ext:custom'] as Record<string, unknown>;
    expect(ext.apiSecret).toBeUndefined();
    expect(ext.department).toBe('Eng');
  });

  it('should be case-insensitive', () => {
    const resource = { id: 'u1', Password: 'secret', schemas: ['s'] };
    const result = stripReturnedNever(resource, new Set(['password']));
    expect(result.Password).toBeUndefined();
  });

  it('should return resource as-is when neverAttrs is empty', () => {
    const resource = { id: 'u1', password: 'secret', schemas: ['s'] };
    const result = stripReturnedNever(resource, new Set());
    expect(result).toBe(resource); // reference identity — no-op
    expect(result.password).toBe('secret');
  });

  it('should handle null/undefined neverAttrs gracefully', () => {
    const resource = { id: 'u1', password: 'secret', schemas: ['s'] };
    const result = stripReturnedNever(resource, undefined as unknown as Set<string>);
    expect(result).toBe(resource);
  });

  it('should strip multiple never-returned attributes', () => {
    const resource = { id: 'u1', password: 'p', apiKey: 'k', name: 'test', schemas: ['s'] };
    const result = stripReturnedNever(resource, new Set(['password', 'apikey']));
    expect(result.password).toBeUndefined();
    expect(result.apiKey).toBeUndefined();
    expect(result.name).toBe('test');
  });

  it('should not strip non-matching attributes', () => {
    const resource = { id: 'u1', displayName: 'Alice', userName: 'alice', schemas: ['s'] };
    const result = stripReturnedNever(resource, new Set(['password']));
    expect(result.displayName).toBe('Alice');
    expect(result.userName).toBe('alice');
  });

  it('should mutate the resource in-place for perf', () => {
    const resource = { id: 'u1', password: 'secret', schemas: ['s'] };
    const result = stripReturnedNever(resource, new Set(['password']));
    expect(result).toBe(resource); // same reference
    expect(resource.password).toBeUndefined();
  });
});
