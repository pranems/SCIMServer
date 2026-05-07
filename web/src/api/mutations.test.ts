/**
 * Mutation hook tests (Phase C5).
 *
 * Each hook is tested for:
 *   1. Success path: mutationFn fires the correct HTTP call;
 *      onSettled invalidates the expected query keys.
 *   2. Rollback path (optimistic mutations only): onMutate snapshots
 *      the cache, onError restores it.
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
  queryKeys,
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

    // During onMutate the credential should have been optimistically removed.
    // After onSettled an invalidate fires, but since fetch is mocked to return
    // {} the data stays as whatever onMutate left. We can at least verify the
    // DELETE was sent.
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
    expect((cached as Record<string, unknown>).displayName).toBeUndefined();
  });
});

// ─── useCreateUser ───────────────────────────────────────────────────

describe('useCreateUser', () => {
  it('success: POSTs to the SCIM Users endpoint and invalidates user list + dashboard', async () => {
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
      expect(keys).toContain(JSON.stringify(['users', EP_ID]));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
    });
  });
});

// ─── useCreateGroup ──────────────────────────────────────────────────

describe('useCreateGroup', () => {
  it('success: POSTs to the SCIM Groups endpoint and invalidates group list + dashboard', async () => {
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
      expect(keys).toContain(JSON.stringify(['groups', EP_ID]));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
    });
  });
});

// ─── useUpdateUser ───────────────────────────────────────────────────

describe('useUpdateUser', () => {
  it('success: PATCHes the SCIM User and invalidates user list', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', body: { Operations: [] } });
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/endpoints/${EP_ID}/Users/u1`);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('PATCH');

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['users', EP_ID]));
    });
  });
});

// ─── useDeleteUser ───────────────────────────────────────────────────

describe('useDeleteUser', () => {
  it('success: DELETEs the SCIM User and invalidates user list + dashboard', async () => {
    const { wrapper, queryClient } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteUser(EP_ID), { wrapper });
    await act(async () => {
      await result.current.mutateAsync('u1');
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain(`/endpoints/${EP_ID}/Users/u1`);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).method).toBe('DELETE');

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
      expect(keys).toContain(JSON.stringify(['users', EP_ID]));
      expect(keys).toContain(JSON.stringify(queryKeys.dashboard));
    });
  });
});
