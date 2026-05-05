/**
 * Query key factory and fetchWithAuth tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryKeys, fetchWithAuth } from './queries';

// Mock the token module
vi.mock('../auth/token', () => ({
  getStoredToken: vi.fn(() => 'test-token'),
  clearStoredToken: vi.fn(),
  notifyTokenInvalid: vi.fn(),
}));

describe('queryKeys', () => {
  it('dashboard key is stable', () => {
    expect(queryKeys.dashboard).toEqual(['dashboard']);
  });

  it('endpoint detail key includes id', () => {
    expect(queryKeys.endpoints.detail('ep-1')).toEqual(['endpoints', 'ep-1']);
  });

  it('users key includes endpointId and params', () => {
    expect(queryKeys.users.byEndpoint('ep-1', { page: 2 })).toEqual([
      'users', 'ep-1', { page: 2 },
    ]);
  });

  it('logs key includes filter params', () => {
    expect(queryKeys.logs.all({ method: 'POST' })).toEqual([
      'logs', { method: 'POST' },
    ]);
  });
});

describe('fetchWithAuth', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('adds Authorization header with stored token', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'test' }),
    });

    await fetchWithAuth('/scim/admin/version');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/scim/admin/version',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('throws on non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(fetchWithAuth('/scim/health')).rejects.toThrow('HTTP 500');
  });

  it('clears token and notifies on 401', async () => {
    const { clearStoredToken, notifyTokenInvalid } = await import('../auth/token');

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(fetchWithAuth('/scim/admin/version')).rejects.toThrow('Authentication required');
    expect(clearStoredToken).toHaveBeenCalled();
    expect(notifyTokenInvalid).toHaveBeenCalled();
  });

  it('returns parsed JSON on success', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '0.41.0' }),
    });

    const result = await fetchWithAuth('/scim/admin/version');
    expect(result).toEqual({ version: '0.41.0' });
  });
});
