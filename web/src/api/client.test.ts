import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setStoredToken, clearStoredToken, TOKEN_STORAGE_KEY } from '../auth/token';

// We need to test the client module functions.
// Since they use global fetch, we mock it.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Dynamic import after mock is in place
const { fetchLogs, clearLogs, fetchLog, fetchLocalVersion, createManualUser, createManualGroup } = await import('./client');

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    setStoredToken('test-token');
  });

  afterEach(() => {
    clearStoredToken();
  });

  describe('fetchLogs', () => {
    it('calls GET /scim/admin/logs with auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50, count: 0, hasNext: false, hasPrev: false }),
      });

      await fetchLogs();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/logs');
      expect(init.headers.get('Authorization')).toBe('Bearer test-token');
    });

    it('includes query params when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0, page: 2, pageSize: 10, count: 0, hasNext: false, hasPrev: false }),
      });

      await fetchLogs({ page: 2, pageSize: 10, method: 'POST' });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('page=2');
      expect(url).toContain('pageSize=10');
      expect(url).toContain('method=POST');
    });

    it('omits empty/undefined params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50, count: 0, hasNext: false, hasPrev: false }),
      });

      await fetchLogs({ page: 1, method: undefined, status: undefined });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('page=1');
      expect(url).not.toContain('method');
      expect(url).not.toContain('status');
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(fetchLogs()).rejects.toThrow('Failed to load logs: 500');
    });
  });

  describe('clearLogs', () => {
    it('calls POST /scim/admin/logs/clear', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 204 });

      await clearLogs();

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/logs/clear');
      expect(init.method).toBe('POST');
    });
  });

  describe('fetchLog', () => {
    it('calls GET /scim/admin/logs/:id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'abc', method: 'GET', url: '/test', createdAt: '2026-01-01' }),
      });

      const result = await fetchLog('abc');
      expect(result.id).toBe('abc');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/logs/abc');
    });

    it('throws on 404', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(fetchLog('missing')).rejects.toThrow('Failed to load log missing: 404');
    });
  });

  describe('fetchLocalVersion', () => {
    it('calls GET /scim/admin/version', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ version: '0.35.0', runtime: { node: 'v24' } }),
      });

      const result = await fetchLocalVersion();
      expect(result.version).toBe('0.35.0');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/version');
    });
  });

  describe('auth behavior', () => {
    it('throws when no token is stored', async () => {
      clearStoredToken();
      await expect(fetchLogs()).rejects.toThrow('SCIM authentication token not configured');
    });

    it('clears token on 401 response', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(fetchLogs()).rejects.toThrow('401');
      expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    });
  });

  describe('createManualUser', () => {
    it('sends POST to /scim/admin/users/manual', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'new-id', userName: 'test@example.com' }),
      });

      const result = await createManualUser({ userName: 'test@example.com' });
      expect(result.id).toBe('new-id');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/users/manual');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ userName: 'test@example.com' });
    });

    it('extracts error detail from SCIM error response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        text: () => Promise.resolve(JSON.stringify({ detail: 'User already exists' })),
      });

      await expect(createManualUser({ userName: 'dup@test.com' })).rejects.toThrow('User already exists');
    });
  });

  describe('createManualGroup', () => {
    it('sends POST to /scim/admin/groups/manual', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'grp-1', displayName: 'Test Group' }),
      });

      const result = await createManualGroup({ displayName: 'Test Group' });
      expect(result.id).toBe('grp-1');
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/scim/admin/groups/manual');
      expect(init.method).toBe('POST');
    });
  });
});
