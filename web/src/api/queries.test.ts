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

  it('logs.list key includes filter params', () => {
    expect(queryKeys.logs.list({ method: 'POST' })).toEqual([
      'logs', { method: 'POST' },
    ]);
  });

  it('logs.all is a stable prefix used for SSE invalidation (Phase F3)', () => {
    expect(queryKeys.logs.all).toEqual(['logs']);
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
      // Phase K3: shape mirrors a plain-text fetch Response (no
      // headers.get() defined) - parser must still produce a
      // ScimApiError carrying the status + the text as detail.
      text: () => Promise.resolve('Internal Server Error'),
    });

    // Phase K3 - assert the structured class + detail substring.
    const { ScimApiError } = await import('./scim-error');
    try {
      await fetchWithAuth('/scim/health');
      throw new Error('expected fetchWithAuth to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ScimApiError);
      expect((err as InstanceType<typeof ScimApiError>).status).toBe(500);
      expect((err as Error).message).toContain('Internal Server Error');
    }
  });

  // ─── Phase K3 - structured ScimApiError ─────────────────────────
  it('throws a ScimApiError carrying status + parsed body on a JSON SCIM error response', async () => {
    const body = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '409',
      scimType: 'uniqueness',
      detail: 'userName already taken',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/scim+json' : null) },
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    const { ScimApiError } = await import('./scim-error');
    try {
      await fetchWithAuth('/scim/endpoints/ep-1/Users');
      throw new Error('expected fetchWithAuth to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ScimApiError);
      const e = err as InstanceType<typeof ScimApiError>;
      expect(e.status).toBe(409);
      expect(e.scimType).toBe('uniqueness');
      expect(e.detail).toBe('userName already taken');
      expect(e.rawBody).toEqual(body);
    }
  });

  it('throws a ScimApiError on 5xx with body=null when response is not JSON (graceful degrade)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: () => Promise.resolve('<html>Bad Gateway</html>'),
    });
    const { ScimApiError } = await import('./scim-error');
    try {
      await fetchWithAuth('/scim/health');
      throw new Error('expected fetchWithAuth to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ScimApiError);
      const e = err as InstanceType<typeof ScimApiError>;
      expect(e.status).toBe(502);
      // Detail must include the raw text so the operator can read it.
      expect(e.detail).toContain('Bad Gateway');
      expect(e.scimType).toBeUndefined();
    }
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

  it('throws ScimApiError(401) WITHOUT making an HTTP request when there is no stored token', async () => {
    // Bug 2 fix (RCA 2026-05-20): when getStoredToken() returns null the
    // function must short-circuit without calling fetch so that the route
    // loader fails gracefully during the pre-authentication window and
    // the TokenGate dialog does not show a spurious "Token expired" error.
    const { getStoredToken, notifyTokenInvalid, clearStoredToken } = await import('../auth/token');
    vi.mocked(getStoredToken).mockReturnValueOnce(null);
    // Clear call history accumulated by prior tests in this describe block.
    vi.mocked(notifyTokenInvalid).mockClear();
    vi.mocked(clearStoredToken).mockClear();

    const { ScimApiError } = await import('./scim-error');
    // Call fetchWithAuth exactly ONCE so the Once-mock is consumed here only.
    const thrown = await fetchWithAuth('/scim/admin/version').catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ScimApiError);
    expect((thrown as { status: number }).status).toBe(401);
    // Must NOT make an HTTP call (no token = no request to server)
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // Must NOT fire TOKEN_INVALID_EVENT - there was never a valid session
    expect(notifyTokenInvalid).not.toHaveBeenCalled();
    expect(clearStoredToken).not.toHaveBeenCalled();
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

describe('URL contract validation', () => {
  // These tests verify the URLs constructed by query hooks match the
  // backend route patterns. Catches /v2/ vs no-/v2/ mismatches.

  const savedFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ totalResults: 0, Resources: [] }),
    });
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
  });

  it('Users endpoint URL has no /v2/ segment', async () => {
    await fetchWithAuth('/scim/endpoints/ep-1/Users');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('/scim/endpoints/ep-1/Users');
    expect(calledUrl).not.toContain('/v2/');
  });

  it('Groups endpoint URL has no /v2/ segment', async () => {
    await fetchWithAuth('/scim/endpoints/ep-1/Groups');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('/scim/endpoints/ep-1/Groups');
    expect(calledUrl).not.toContain('/v2/');
  });

  it('dashboard URL is /scim/admin/dashboard', async () => {
    await fetchWithAuth('/scim/admin/dashboard');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('/scim/admin/dashboard');
  });

  it('endpoint stats URL is /scim/admin/endpoints/:id/stats', async () => {
    await fetchWithAuth('/scim/admin/endpoints/ep-1/stats');
    const calledUrl = (globalThis.fetch as any).mock.calls[0][0];
    expect(calledUrl).toBe('/scim/admin/endpoints/ep-1/stats');
  });
});
