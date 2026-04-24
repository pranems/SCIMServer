import {
  parseScimFilter,
  evaluateFilter,
  resolveAttrPath,
  extractFilterPaths,
} from './scim-filter-parser';
import type { FilterNode, CompareNode, LogicalNode, NotNode, ValuePathNode } from './scim-filter-parser';

// ─── Parser Tests ────────────────────────────────────────────────────────────

describe('ScimFilterParser', () => {
  describe('parseScimFilter - simple comparisons', () => {
    it('should parse eq with string value', () => {
      const ast = parseScimFilter('userName eq "john"') as CompareNode;
      expect(ast.type).toBe('compare');
      expect(ast.attrPath).toBe('userName');
      expect(ast.op).toBe('eq');
      expect(ast.value).toBe('john');
    });

    it('should parse ne with string value', () => {
      const ast = parseScimFilter('active ne "false"') as CompareNode;
      expect(ast.op).toBe('ne');
    });

    it('should parse co (contains)', () => {
      const ast = parseScimFilter('displayName co "admin"') as CompareNode;
      expect(ast.op).toBe('co');
      expect(ast.value).toBe('admin');
    });

    it('should parse sw (starts with)', () => {
      const ast = parseScimFilter('userName sw "j"') as CompareNode;
      expect(ast.op).toBe('sw');
    });

    it('should parse ew (ends with)', () => {
      const ast = parseScimFilter('userName ew "@example.com"') as CompareNode;
      expect(ast.op).toBe('ew');
    });

    it('should parse gt, ge, lt, le', () => {
      for (const op of ['gt', 'ge', 'lt', 'le']) {
        const ast = parseScimFilter(`meta.lastModified ${op} "2025-01-01"`) as CompareNode;
        expect(ast.op).toBe(op);
      }
    });

    it('should parse pr (presence)', () => {
      const ast = parseScimFilter('title pr') as CompareNode;
      expect(ast.type).toBe('compare');
      expect(ast.attrPath).toBe('title');
      expect(ast.op).toBe('pr');
      expect(ast.value).toBeUndefined();
    });

    it('should parse boolean value', () => {
      const ast = parseScimFilter('active eq true') as CompareNode;
      expect(ast.value).toBe(true);
    });

    it('should parse false boolean', () => {
      const ast = parseScimFilter('active eq false') as CompareNode;
      expect(ast.value).toBe(false);
    });

    it('should parse null value', () => {
      const ast = parseScimFilter('externalId eq null') as CompareNode;
      expect(ast.value).toBe(null);
    });

    it('should parse numeric value', () => {
      const ast = parseScimFilter('age eq 25') as CompareNode;
      expect(ast.value).toBe(25);
    });

    it('should parse dotted attribute path', () => {
      const ast = parseScimFilter('name.givenName eq "John"') as CompareNode;
      expect(ast.attrPath).toBe('name.givenName');
      expect(ast.value).toBe('John');
    });

    it('should handle operators case-insensitively', () => {
      const ast = parseScimFilter('userName EQ "john"') as CompareNode;
      expect(ast.op).toBe('eq');
    });
  });

  describe('parseScimFilter - logical expressions', () => {
    it('should parse AND', () => {
      const ast = parseScimFilter('userName eq "john" and active eq true') as LogicalNode;
      expect(ast.type).toBe('logical');
      expect(ast.op).toBe('and');
      expect((ast.left as CompareNode).attrPath).toBe('userName');
      expect((ast.right as CompareNode).attrPath).toBe('active');
    });

    it('should parse OR', () => {
      const ast = parseScimFilter('active eq true or active eq false') as LogicalNode;
      expect(ast.type).toBe('logical');
      expect(ast.op).toBe('or');
    });

    it('should parse AND with higher precedence than OR', () => {
      // "a or b and c" → "a or (b and c)"
      const ast = parseScimFilter('title pr or active eq true and userName eq "j"') as LogicalNode;
      expect(ast.op).toBe('or');
      expect((ast.right as LogicalNode).op).toBe('and');
    });

    it('should parse chained AND', () => {
      const ast = parseScimFilter('a eq "1" and b eq "2" and c eq "3"') as LogicalNode;
      expect(ast.op).toBe('and');
      expect((ast.left as LogicalNode).op).toBe('and');
    });
  });

  describe('parseScimFilter - NOT and grouping', () => {
    it('should parse NOT expression', () => {
      const ast = parseScimFilter('not (active eq false)') as NotNode;
      expect(ast.type).toBe('not');
      expect((ast.filter as CompareNode).op).toBe('eq');
    });

    it('should parse grouped expression', () => {
      const ast = parseScimFilter('(userName eq "john")') as CompareNode;
      expect(ast.type).toBe('compare');
      expect(ast.attrPath).toBe('userName');
    });

    it('should parse complex grouping with OR and AND', () => {
      const ast = parseScimFilter('(a eq "1" or b eq "2") and c eq "3"') as LogicalNode;
      expect(ast.op).toBe('and');
      expect((ast.left as LogicalNode).op).toBe('or');
    });
  });

  describe('parseScimFilter - value paths', () => {
    it('should parse value path filter', () => {
      const ast = parseScimFilter('emails[type eq "work"]') as ValuePathNode;
      expect(ast.type).toBe('valuePath');
      expect(ast.attrPath).toBe('emails');
      expect((ast.filter as CompareNode).attrPath).toBe('type');
      expect((ast.filter as CompareNode).value).toBe('work');
    });

    it('should parse value path with compound filter', () => {
      const ast = parseScimFilter('emails[type eq "work" and value co "@example.com"]') as ValuePathNode;
      expect(ast.type).toBe('valuePath');
      expect((ast.filter as LogicalNode).op).toBe('and');
    });
  });

  describe('parseScimFilter - URN paths', () => {
    it('should parse URN-prefixed attribute as a single attribute path', () => {
      const ast = parseScimFilter(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering"'
      ) as CompareNode;
      expect(ast.type).toBe('compare');
      expect(ast.attrPath).toBe('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department');
      expect(ast.value).toBe('Engineering');
    });
  });

  describe('parseScimFilter - error handling', () => {
    it('should throw on empty filter', () => {
      expect(() => parseScimFilter('')).toThrow();
    });

    it('should throw on unterminated string', () => {
      expect(() => parseScimFilter('userName eq "john')).toThrow(/Unterminated/);
    });

    it('should throw on missing comparison value', () => {
      expect(() => parseScimFilter('userName eq')).toThrow();
    });

    it('should throw on unexpected token after valid expression', () => {
      expect(() => parseScimFilter('userName eq "john" extra')).toThrow(/Unexpected/);
    });
  });
});

// ─── Evaluator Tests ─────────────────────────────────────────────────────────

describe('evaluateFilter', () => {
  const user = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: '123',
    userName: 'John.Doe@example.com',
    displayName: 'John Doe',
    active: true,
    title: 'Engineer',
    name: {
      givenName: 'John',
      familyName: 'Doe',
    },
    emails: [
      { value: 'john@work.com', type: 'work', primary: true },
      { value: 'john@home.com', type: 'home', primary: false },
    ],
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
      department: 'Engineering',
      manager: { value: 'mgr-1' },
    },
    meta: {
      resourceType: 'User',
      created: '2025-01-15T10:00:00Z',
      lastModified: '2025-06-01T12:00:00Z',
      location: 'https://example.com/Users/123',
    },
  };

  describe('eq operator', () => {
    it('should match case-insensitively for strings', () => {
      const ast = parseScimFilter('userName eq "john.doe@example.com"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should not match different value', () => {
      const ast = parseScimFilter('userName eq "jane"');
      expect(evaluateFilter(ast, user)).toBe(false);
    });

    it('should match boolean values', () => {
      const ast = parseScimFilter('active eq true');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should match null for missing attributes', () => {
      const ast = parseScimFilter('externalId eq null');
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('ne operator', () => {
    it('should return true when values differ', () => {
      const ast = parseScimFilter('userName ne "jane"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should return false when values are equal', () => {
      const ast = parseScimFilter('active ne true');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('co operator', () => {
    it('should match substring', () => {
      const ast = parseScimFilter('displayName co "ohn"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should be case-insensitive', () => {
      const ast = parseScimFilter('displayName co "OHN"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('sw operator', () => {
    it('should match prefix', () => {
      const ast = parseScimFilter('userName sw "john"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should not match non-prefix', () => {
      const ast = parseScimFilter('userName sw "doe"');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('ew operator', () => {
    it('should match suffix', () => {
      const ast = parseScimFilter('userName ew "example.com"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('gt / ge / lt / le operators', () => {
    it('should compare date strings', () => {
      const ast = parseScimFilter('meta.lastModified gt "2025-03-01"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should handle le', () => {
      const ast = parseScimFilter('meta.created le "2025-12-31"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('pr operator', () => {
    it('should return true for present attribute', () => {
      const ast = parseScimFilter('title pr');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should return false for missing attribute', () => {
      const ast = parseScimFilter('externalId pr');
      expect(evaluateFilter(ast, user)).toBe(false);
    });

    it('should return true for non-empty array', () => {
      const ast = parseScimFilter('emails pr');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should return false for empty array', () => {
      const ast = parseScimFilter('groups pr');
      expect(evaluateFilter(ast, { ...user, groups: [] })).toBe(false);
    });
  });

  describe('logical AND', () => {
    it('should return true when both sides match', () => {
      const ast = parseScimFilter('active eq true and userName sw "john"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should return false when one side fails', () => {
      const ast = parseScimFilter('active eq false and userName sw "john"');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('logical OR', () => {
    it('should return true when either side matches', () => {
      const ast = parseScimFilter('active eq false or userName sw "john"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should return false when neither matches', () => {
      const ast = parseScimFilter('active eq false or userName eq "jane"');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('NOT expression', () => {
    it('should negate the result', () => {
      const ast = parseScimFilter('not (active eq false)');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should negate a true match', () => {
      const ast = parseScimFilter('not (active eq true)');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('dotted paths', () => {
    it('should resolve nested attributes', () => {
      const ast = parseScimFilter('name.givenName eq "John"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should resolve meta sub-attributes', () => {
      const ast = parseScimFilter('meta.resourceType eq "User"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('value paths', () => {
    it('should match multi-valued complex attributes', () => {
      const ast = parseScimFilter('emails[type eq "work"]');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should not match when no element satisfies the sub-filter', () => {
      const ast = parseScimFilter('emails[type eq "other"]');
      expect(evaluateFilter(ast, user)).toBe(false);
    });

    it('should handle compound sub-filters', () => {
      const ast = parseScimFilter('emails[type eq "work" and primary eq true]');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should reject when compound sub-filter partially fails', () => {
      const ast = parseScimFilter('emails[type eq "home" and primary eq true]');
      expect(evaluateFilter(ast, user)).toBe(false);
    });
  });

  describe('URN paths', () => {
    it('should resolve enterprise extension attribute', () => {
      const ast = parseScimFilter(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering"'
      );
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should resolve nested URN path', () => {
      const ast = parseScimFilter(
        'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager.value eq "mgr-1"'
      );
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  describe('complex real-world filters', () => {
    it('should handle Entra ID typical filter', () => {
      const ast = parseScimFilter('userName eq "John.Doe@example.com"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should handle compound OR with presence check', () => {
      const ast = parseScimFilter('title pr or displayName co "admin"');
      expect(evaluateFilter(ast, user)).toBe(true);
    });

    it('should handle deeply nested logical expressions', () => {
      const ast = parseScimFilter(
        '(userName sw "john" and active eq true) or (displayName co "Admin" and title pr)'
      );
      expect(evaluateFilter(ast, user)).toBe(true);
    });
  });

  // ─── P2 R-CASE-1: caseExact-aware evaluateFilter ─────────────────

  describe('R-CASE-1: caseExact-aware filtering', () => {
    it('should perform case-sensitive eq when attr is caseExact', () => {
      const caseExactAttrs = new Set(['id']);
      const ast = parseScimFilter('id eq "123"');
      // Exact case match → true
      expect(evaluateFilter(ast, user, caseExactAttrs)).toBe(true);
      // Wrong case → false (case-sensitive!)
      const ast2 = parseScimFilter('id eq "ABC"');
      const resource = { ...user, id: 'abc' };
      expect(evaluateFilter(ast2, resource, caseExactAttrs)).toBe(false);
    });

    it('should remain case-insensitive for non-caseExact attrs', () => {
      const caseExactAttrs = new Set(['id']);
      const ast = parseScimFilter('userName eq "JOHN.DOE@EXAMPLE.COM"');
      // userName is NOT caseExact, so case-insensitive match should work
      expect(evaluateFilter(ast, user, caseExactAttrs)).toBe(true);
    });

    it('should perform case-sensitive co (contains) for caseExact attrs', () => {
      const caseExactAttrs = new Set(['meta.location']);
      const ast = parseScimFilter('meta.location co "Users"');
      expect(evaluateFilter(ast, user, caseExactAttrs)).toBe(true);
      const ast2 = parseScimFilter('meta.location co "users"');
      // lowercase "users" should NOT match "Users" in the URL when caseExact
      expect(evaluateFilter(ast2, user, caseExactAttrs)).toBe(false);
    });

    it('should perform case-sensitive sw (starts with) for caseExact attrs', () => {
      const caseExactAttrs = new Set(['meta.location']);
      const ast = parseScimFilter('meta.location sw "https://example"');
      expect(evaluateFilter(ast, user, caseExactAttrs)).toBe(true);
      const ast2 = parseScimFilter('meta.location sw "HTTPS://EXAMPLE"');
      expect(evaluateFilter(ast2, user, caseExactAttrs)).toBe(false);
    });

    it('should remain case-insensitive when no caseExactAttrs provided', () => {
      // Without caseExactAttrs, all comparisons should be case-insensitive (SCIM default)
      const ast = parseScimFilter('id eq "ABC"');
      const resource = { ...user, id: 'abc' };
      expect(evaluateFilter(ast, resource)).toBe(true);
    });

    it('should propagate caseExactAttrs through AND/OR logical nodes', () => {
      const caseExactAttrs = new Set(['id']);
      const resource = { ...user, id: 'CaseSensitiveId' };
      // id is caseExact: exact match + userName case-insensitive
      const ast = parseScimFilter('id eq "CaseSensitiveId" and userName eq "JOHN.DOE@EXAMPLE.COM"');
      expect(evaluateFilter(ast, resource, caseExactAttrs)).toBe(true);
      // Wrong case for id → AND fails
      const ast2 = parseScimFilter('id eq "casesensitiveid" and userName eq "JOHN.DOE@EXAMPLE.COM"');
      expect(evaluateFilter(ast2, resource, caseExactAttrs)).toBe(false);
    });

    it('should propagate caseExactAttrs through NOT nodes', () => {
      const caseExactAttrs = new Set(['id']);
      const resource = { ...user, id: 'ABC' };
      // not (id eq "abc") → "abc" ≠ "ABC" case-sensitively → inner is false → NOT makes it true
      const ast = parseScimFilter('not (id eq "abc")');
      expect(evaluateFilter(ast, resource, caseExactAttrs)).toBe(true);
    });
  });
});

// ─── resolveAttrPath Tests ───────────────────────────────────────────────────

describe('resolveAttrPath', () => {
  const resource = {
    userName: 'test',
    name: { givenName: 'Test', familyName: 'User' },
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
      department: 'Eng',
    },
  };

  it('should resolve top-level attribute', () => {
    expect(resolveAttrPath(resource, 'userName')).toBe('test');
  });

  it('should resolve dotted path', () => {
    expect(resolveAttrPath(resource, 'name.givenName')).toBe('Test');
  });

  it('should return undefined for missing path', () => {
    expect(resolveAttrPath(resource, 'nonExistent')).toBeUndefined();
  });

  it('should resolve URN-prefixed path', () => {
    expect(
      resolveAttrPath(resource, 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department')
    ).toBe('Eng');
  });

  it('should be case-insensitive for attribute lookup', () => {
    expect(resolveAttrPath(resource, 'USERNAME')).toBe('test');
    expect(resolveAttrPath(resource, 'Name.GivenName')).toBe('Test');
  });
});

// ─── V12: Filter Depth Guard ─────────────────────────────────────────────────

describe('ScimFilterParser - depth guard (V12)', () => {
  it('should parse moderately nested filters without error', () => {
    // 10 levels of nesting - well within limit
    const filter = '(' .repeat(10) + 'userName eq "a"' + ')'.repeat(10);
    const ast = parseScimFilter(filter);
    expect(ast).toBeDefined();
  });

  it('should reject filters that exceed MAX_FILTER_DEPTH (50)', () => {
    // 51 levels of parenthesised nesting
    const filter = '(' .repeat(51) + 'userName eq "a"' + ')'.repeat(51);
    expect(() => parseScimFilter(filter)).toThrow(
      /exceeds maximum nesting depth of 50/,
    );
  });

  it('should reject deeply nested parenthesised chains', () => {
    // Each "not (" increments depth by 1 (guardDepth in NOT branch);
    // decrement happens after recursion returns. Need > 50 to trigger.
    let filter = '';
    for (let i = 0; i < 51; i++) filter += 'not (';
    filter += 'userName pr';
    for (let i = 0; i < 51; i++) filter += ')';
    expect(() => parseScimFilter(filter)).toThrow(
      /exceeds maximum nesting depth/,
    );
  });

  it('should accept exactly 50 levels of nesting', () => {
    // Exactly at the boundary - should still succeed
    const filter = '(' .repeat(50) + 'userName eq "a"' + ')'.repeat(50);
    expect(() => parseScimFilter(filter)).not.toThrow();
  });
});

// ─── extractFilterPaths ──────────────────────────────────────────────────────

describe('extractFilterPaths', () => {
  it('should extract single attribute path from simple filter', () => {
    const ast = parseScimFilter('userName eq "john"');
    const paths = extractFilterPaths(ast);
    expect(paths).toEqual(['userName']);
  });

  it('should extract multiple attribute paths from logical filter', () => {
    const ast = parseScimFilter('userName eq "john" and active eq "true"');
    const paths = extractFilterPaths(ast);
    expect(paths).toContain('userName');
    expect(paths).toContain('active');
    expect(paths).toHaveLength(2);
  });

  it('should deduplicate attribute paths', () => {
    const ast = parseScimFilter('userName eq "a" or userName sw "b"');
    const paths = extractFilterPaths(ast);
    expect(paths).toEqual(['userName']);
  });

  it('should extract paths from valuePath (bracket) filters', () => {
    const ast = parseScimFilter('emails[type eq "work"]');
    const paths = extractFilterPaths(ast);
    expect(paths).toContain('emails');
    expect(paths).toContain('type');
  });

  it('should extract paths from NOT filters', () => {
    const ast = parseScimFilter('not (userName eq "john")');
    const paths = extractFilterPaths(ast);
    expect(paths).toContain('userName');
  });

  it('should extract paths from presence (pr) filters', () => {
    const ast = parseScimFilter('title pr');
    const paths = extractFilterPaths(ast);
    expect(paths).toEqual(['title']);
  });

  it('should extract dotted sub-attribute paths', () => {
    const ast = parseScimFilter('name.givenName eq "John"');
    const paths = extractFilterPaths(ast);
    expect(paths).toEqual(['name.givenName']);
  });

  it('should extract URN-prefixed paths', () => {
    const ast = parseScimFilter(
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department eq "Engineering"',
    );
    const paths = extractFilterPaths(ast);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('department');
  });
});
