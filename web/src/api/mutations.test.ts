/**
 * Mutation hook tests (Phase C5 + v0.44.1 hardening).
 *
 * Each hook is tested for:
 *   1. Success path: mutationFn fires the correct HTTP call;
 *      onSettled invalidates the expected query keys.
 *   2. Rollback path (optimistic mutations only): onMutate snapshots
 *      the cache, onError restores it.
 *   3. If-Match header propagation (PATCH/DELETE only).
 *
 * We mock globalThis.fetch and inspect the QueryClient's cache
 * directly rather than waiting for React renders - these are unit
 * tests for the mutation wiring, not integration tests for the UI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreateCredential,
  useDeleteCredential,
  useUpdateEndpointConfig,
  useCreateUser,
  useCreateGroup,
  useUpdateUser,
  useDeleteUser,
  useUpdateGroup,
  useDeleteGroup,
  queryKeys,
  type ScimListResponse,
} from './queries';
import type { EndpointOverviewResponse, EndpointResponse } from '@scim/types/dashboard.types';

// ─── Shared helpers ──────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, queryClient };
}

const EP_ID = 'ep-1';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  });
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Mock the token module so fetchWithAuth adds the Authorization header.
vi.mock('../auth/token', () => ({
  getStoredToken: vi.fn(() => 'test-token'),
  clearStoredToken: vi.fn(),
  notifyTokenInvalid: vi.fn(),
}));

/** Build a SCIM list response containing a single resource with the given id. */
function seedUserList(qc: QueryClient, id: string, extra: Record<string, unknown> = {}) {
  const list: ScimListResponse = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 20,
    Resources: [{ id, userName: 'alice@x.com', active: true, ...extra }],
  };
  qc.setQueryData(queryKeys.users.byEndpoint(EP_ID, { startIndex: 1, count: 20 }), list);
  return list;
}

function seedGroupList(qc: QueryClient, id: string, extra: Record<string, unknown> = {}) {
  const list: ScimListResponse = {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 20,
    Resources: [{ id, displayName: 'Engineering', ...extra }],
  };
  qc.setQueryData(queryKeys.groups.byEndpoint(EP_ID, { startIndex: 1, count: 20 }), list);
  return list;
}

// ─── useCreateCredential ─────────────────────────────────────────────

describe('useCreateCredential', () => {
  it('success: POSTs to the credential endpoint and invalidates overview', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCredential(EP_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ label: 'Test' });
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/endpoints/${EP_ID}/credentials`);
    const calledOpts = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(calledOpts.method).toBe('POST');

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});

// ─── useDeleteCredential (optimistic) ────────────────────────────────

describe('useDeleteCredential', () => {
  it('success: removes the credential from the cached overview', async () => {
    const { wrapper, queryClient } = createWrapper();
    // Seed the overview cache with one credential.
    const seedOverview: EndpointOverviewResponse = {
      endpoint: { id: EP_ID, name: 'x', preset: null, active: true, scimBasePath: '', createdAt: '' },
      stats: { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 },
      credentials: [{ id: 'c1', credentialType: 'bearer', label: 'X', active: true, createdAt: '', expiresAt: null }],
      recentActivity: [],
      configFlags: {},
    };
    queryClient.setQueryData(queryKeys.endpoints.overview(EP_ID), seedOverview);

    const { result } = renderHook(() => useDeleteCredential(EP_ID), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('c1');
    });

    // Tightened (F-8): assert the optimistic cache state. By the time
    // mutateAsync resolves, onMutate has already removed the row;
    // onSettled has fired an invalidate but our mocked fetch returns
    // an empty refetch so the optimistic state stays.
    const cached = queryClient.getQueryData<EndpointOverviewResponse>(
      queryKeys.endpoints.overview(EP_ID),
    );
    expect(cached?.credentials).toHaveLength(0);

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/credentials/c1`);
  });

  it('rollback: restores the credential on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    const seedOverview: EndpointOverviewResponse = {
      endpoint: { id: EP_ID, name: 'x', preset: null, active: true, scimBasePath: '', createdAt: '' },
      stats: { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 },
      credentials: [{ id: 'c1', credentialType: 'bearer', label: 'X', active: true, createdAt: '', expiresAt: null }],
      recentActivity: [],
      configFlags: {},
    };
    queryClient.setQueryData(queryKeys.endpoints.overview(EP_ID), seedOverview);

    // Make the server fail.
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('boom') });

    const { result } = renderHook(() => useDeleteCredential(EP_ID), { wrapper });

    try {
      await act(async () => { await result.current.mutateAsync('c1'); });
    } catch {
      // Expected to throw.
    }

    // After rollback, the credential should still be in the cache.
    const cached = queryClient.getQueryData<EndpointOverviewResponse>(
      queryKeys.endpoints.overview(EP_ID),
    );
    expect(cached?.credentials).toHaveLength(1);
    expect(cached?.credentials[0].id).toBe('c1');
  });
});

// ─── useUpdateEndpointConfig (optimistic) ────────────────────────────

describe('useUpdateEndpointConfig', () => {
  it('success: PATCHes and invalidates detail + overview', async () => {
    const { wrapper, queryClient } = createWrapper();
    queryClient.setQueryData<Partial<EndpointResponse>>(
      queryKeys.endpoints.detail(EP_ID),
      { id: EP_ID, name: 'x', active: true } as EndpointResponse,
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateEndpointConfig(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ displayName: 'New' });
    });

    const calledOpts = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(calledOpts.method).toBe('PATCH');
    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.detail(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });

  it('rollback: restores the original detail on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    const original: EndpointResponse = {
      id: EP_ID, name: 'x', active: true, scimBasePath: '',
      createdAt: '', updatedAt: '', _links: { self: '', stats: '', credentials: '', scim: '' },
    };
    queryClient.setQueryData(queryKeys.endpoints.detail(EP_ID), original);

    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') });

    const { result } = renderHook(() => useUpdateEndpointConfig(EP_ID), { wrapper });
    try {
      await act(async () => { await result.current.mutateAsync({ displayName: 'New' }); });
    } catch { /* expected */ }

    const cached = queryClient.getQueryData<EndpointResponse>(
      queryKeys.endpoints.detail(EP_ID),
    );
    expect(cached?.name).toBe('x');
    const cachedAny = cached as unknown as { displayName?: unknown };
    expect(cachedAny.displayName).toBeUndefined();
  });

  it('cold cache: still PATCHes and invalidates without an optimistic snapshot', async () => {
    // F-7: previous coverage skipped this branch. Without seeded
    // detail, onMutate snapshots nothing but onSettled must still
    // fire its invalidations so a route loader picks up the change.
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateEndpointConfig(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ displayName: 'New' });
    });

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.detail(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});

// ─── useCreateUser ───────────────────────────────────────────────────

describe('useCreateUser', () => {
  it('success: POSTs to the SCIM Users endpoint and invalidates user list + dashboard + overview', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'alice' });
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/endpoints/${EP_ID}/Users`);

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      // F-6: assert all three invalidations the production code emits.
      expect(keys).toContain(JSON.stringify(queryKeys.users.all(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});

// ─── useCreateGroup ──────────────────────────────────────────────────

describe('useCreateGroup', () => {
  it('success: POSTs to the SCIM Groups endpoint and invalidates group list + dashboard + overview', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Engineering' });
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/endpoints/${EP_ID}/Groups`);

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.groups.all(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});

// ─── useUpdateUser (optimistic + If-Match) ──────────────────────────

describe('useUpdateUser', () => {
  it('success: optimistically merges body into the cached list page, then invalidates', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedUserList(queryClient, 'u1');

    const { result } = renderHook(() => useUpdateUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', body: { active: false } });
    });

    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('PATCH');
    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.users.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    const row = cached?.Resources[0] as Record<string, unknown>;
    expect(row.active).toBe(false);
    expect(row.userName).toBe('alice@x.com');
  });

  it('rollback: restores the cached list on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedUserList(queryClient, 'u1');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('') });

    const { result } = renderHook(() => useUpdateUser(EP_ID), { wrapper });
    try {
      await act(async () => {
        await result.current.mutateAsync({ userId: 'u1', body: { active: false } });
      });
    } catch { /* expected */ }

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.users.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    const row = cached?.Resources[0] as Record<string, unknown>;
    expect(row.active).toBe(true); // rolled back
  });

  it('forwards If-Match header when supplied (RequireIfMatch endpoints)', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        userId: 'u1',
        body: { active: false },
        ifMatch: 'W/"v3"',
      });
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"v3"');
  });

  it('omits If-Match header when not supplied', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', body: { active: false } });
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBeUndefined();
  });
});

// ─── useDeleteUser (optimistic + If-Match) ──────────────────────────

describe('useDeleteUser', () => {
  it('success: optimistically removes the row from every cached list page', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedUserList(queryClient, 'u1');

    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('u1');
    });

    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('DELETE');
    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.users.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    expect(cached?.Resources).toHaveLength(0);
    expect(cached?.totalResults).toBe(0);
  });

  it('rollback: restores the cached list on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedUserList(queryClient, 'u1');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 412, text: () => Promise.resolve('') });

    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    try {
      await act(async () => { await result.current.mutateAsync('u1'); });
    } catch { /* expected */ }

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.users.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    expect(cached?.Resources).toHaveLength(1);
    expect(cached?.totalResults).toBe(1);
  });

  it('forwards If-Match header when supplied via object form', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedUserList(queryClient, 'u1');

    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', ifMatch: 'W/"v9"' });
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"v9"');
  });

  it('accepts the legacy bare-string variant for backward compatibility', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('u1');
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/Users/u1');
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBeUndefined();
  });

  it('invalidates user list + dashboard + overview on settle', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('u1');
    });

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.users.all(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});

// ─── useUpdateGroup (optimistic + If-Match) ─────────────────────────

describe('useUpdateGroup', () => {
  it('success: optimistically merges body into the cached list page', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedGroupList(queryClient, 'g1');

    const { result } = renderHook(() => useUpdateGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ groupId: 'g1', body: { displayName: 'Renamed' } });
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`/endpoints/${EP_ID}/Groups/g1`);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('PATCH');

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.groups.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    const row = cached?.Resources[0] as Record<string, unknown>;
    expect(row.displayName).toBe('Renamed');
  });

  it('rollback: restores the cached group list on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedGroupList(queryClient, 'g1');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('') });

    const { result } = renderHook(() => useUpdateGroup(EP_ID), { wrapper });
    try {
      await act(async () => {
        await result.current.mutateAsync({ groupId: 'g1', body: { displayName: 'Renamed' } });
      });
    } catch { /* expected */ }

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.groups.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    const row = cached?.Resources[0] as Record<string, unknown>;
    expect(row.displayName).toBe('Engineering');
  });

  it('forwards If-Match header when supplied', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({
        groupId: 'g1',
        body: { displayName: 'X' },
        ifMatch: 'W/"v2"',
      });
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"v2"');
  });
});

// ─── useDeleteGroup (optimistic + If-Match) ─────────────────────────

describe('useDeleteGroup', () => {
  it('success: optimistically removes the row from every cached list page', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedGroupList(queryClient, 'g1');

    const { result } = renderHook(() => useDeleteGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('g1');
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(`/endpoints/${EP_ID}/Groups/g1`);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('DELETE');

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.groups.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    expect(cached?.Resources).toHaveLength(0);
    expect(cached?.totalResults).toBe(0);
  });

  it('rollback: restores the cached group list on server error', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedGroupList(queryClient, 'g1');
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 412, text: () => Promise.resolve('') });

    const { result } = renderHook(() => useDeleteGroup(EP_ID), { wrapper });
    try {
      await act(async () => { await result.current.mutateAsync('g1'); });
    } catch { /* expected */ }

    const cached = queryClient.getQueryData<ScimListResponse>(
      queryKeys.groups.byEndpoint(EP_ID, { startIndex: 1, count: 20 }),
    );
    expect(cached?.Resources).toHaveLength(1);
  });

  it('forwards If-Match header when supplied via object form', async () => {
    const { wrapper, queryClient } = createWrapper();
    seedGroupList(queryClient, 'g1');

    const { result } = renderHook(() => useDeleteGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ groupId: 'g1', ifMatch: 'W/"v5"' });
    });

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"v5"');
  });

  it('invalidates group list + dashboard + overview on settle', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteGroup(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('g1');
    });

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(queryKeys.groups.all(EP_ID)));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
      expect(keys).toContain(JSON.stringify(queryKeys.endpoints.overview(EP_ID)));
    });
  });
});
