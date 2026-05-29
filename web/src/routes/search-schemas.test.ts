/**
 * search-schemas.test.ts - unit tests for URL search param schemas.
 *
 * These zod schemas drive type-safe parsing of URL search params for
 * paginated lists (Users, Groups, Logs) and filter inputs. They are
 * consumed by TanStack Router routes in Phase A3, but live in their
 * own module so they can be unit-tested independently and reused by
 * non-router code (e.g. the global LogsPage filter inputs).
 *
 * Behavioral guarantees verified here:
 *  - Sensible defaults when params are absent (page=1, pageSize=20).
 *  - Coercion: query strings arrive as strings; numbers must coerce.
 *  - Bounds: page >= 1, pageSize in [1, 100], rejects garbage.
 *  - Optional filters: empty string and undefined both treated as "no filter".
 *  - Time range enum is a closed set; unknown values rejected.
 */

import { describe, it, expect } from 'vitest';
import {
  paginationSchema,
  usersSearchSchema,
  groupsSearchSchema,
  logsSearchSchema,
  globalLogsSearchSchema,
  endpointsSearchSchema,
  TIME_RANGE_VALUES,
  type PaginationSearch,
  type LogsSearch,
} from './search-schemas';

describe('paginationSchema', () => {
  it('returns defaults when called with empty object (Phase N4: pageSize optional)', () => {
    const result = paginationSchema.parse({});
    expect(result).toEqual({ page: 1 });
    expect(result.pageSize).toBeUndefined();
  });

  it('coerces numeric strings (URL search params arrive as strings)', () => {
    const result = paginationSchema.parse({ page: '3', pageSize: '50' });
    expect(result).toEqual({ page: 3, pageSize: 50 });
  });

  it('rejects page < 1', () => {
    expect(() => paginationSchema.parse({ page: 0 })).toThrow();
    expect(() => paginationSchema.parse({ page: -5 })).toThrow();
  });

  it('rejects pageSize > 100 (server-side max)', () => {
    expect(() => paginationSchema.parse({ pageSize: 101 })).toThrow();
  });

  it('rejects pageSize < 1', () => {
    expect(() => paginationSchema.parse({ pageSize: 0 })).toThrow();
  });

  it('rejects non-numeric values', () => {
    expect(() => paginationSchema.parse({ page: 'abc' })).toThrow();
  });
});

describe('usersSearchSchema', () => {
  it('extends pagination with optional filter', () => {
    const result = usersSearchSchema.parse({});
    expect(result).toEqual({ page: 1 });
    expect((result as { filter?: string }).filter).toBeUndefined();
  });

  it('accepts filter string', () => {
    const result = usersSearchSchema.parse({ filter: 'userName eq "alice"' });
    expect(result.filter).toBe('userName eq "alice"');
  });

  it('treats empty filter string as undefined (clean URL)', () => {
    const result = usersSearchSchema.parse({ filter: '' });
    expect(result.filter).toBeUndefined();
  });
});

describe('groupsSearchSchema', () => {
  it('mirrors usersSearchSchema shape', () => {
    const result = groupsSearchSchema.parse({ page: '2', filter: 'displayName co "admin"' });
    expect(result).toEqual({ page: 2, filter: 'displayName co "admin"' });
  });
});

describe('logsSearchSchema (per-endpoint)', () => {
  it('returns defaults including no urlContains', () => {
    const result = logsSearchSchema.parse({});
    expect(result).toEqual({ page: 1 });
    expect((result as LogsSearch).urlContains).toBeUndefined();
  });

  it('accepts urlContains substring', () => {
    const result = logsSearchSchema.parse({ urlContains: '/Users' });
    expect(result.urlContains).toBe('/Users');
  });

  it('treats empty urlContains as undefined', () => {
    const result = logsSearchSchema.parse({ urlContains: '' });
    expect(result.urlContains).toBeUndefined();
  });
});

describe('globalLogsSearchSchema', () => {
  it('supports endpoint filter, status filter, time range, and urlContains', () => {
    const result = globalLogsSearchSchema.parse({
      endpointId: 'ep-123',
      status: '500',
      timeRange: '24h',
      urlContains: '/Groups',
    });
    expect(result).toEqual({
      page: 1,
      endpointId: 'ep-123',
      status: 500,
      timeRange: '24h',
      urlContains: '/Groups',
    });
  });

  it('rejects unknown timeRange enum value', () => {
    expect(() => globalLogsSearchSchema.parse({ timeRange: 'forever' })).toThrow();
  });

  it('accepts each TIME_RANGE_VALUES entry', () => {
    for (const v of TIME_RANGE_VALUES) {
      expect(() => globalLogsSearchSchema.parse({ timeRange: v })).not.toThrow();
    }
  });

  it('rejects non-numeric status code', () => {
    expect(() => globalLogsSearchSchema.parse({ status: 'OK' })).toThrow();
  });
});

describe('endpointsSearchSchema', () => {
  it('returns defaults including no search query', () => {
    const result = endpointsSearchSchema.parse({});
    expect(result).toEqual({});
    expect((result as { q?: string }).q).toBeUndefined();
  });

  it('accepts search query string', () => {
    const result = endpointsSearchSchema.parse({ q: 'production' });
    expect(result.q).toBe('production');
  });
});

describe('exported types', () => {
  it('PaginationSearch is assignable from parse result', () => {
    const value: PaginationSearch = paginationSchema.parse({});
    expect(value.page).toBe(1);
    expect(value.pageSize).toBeUndefined();
  });
});
