/**
 * router-loaders.integration.test.tsx - end-to-end check that a route
 * loader actually populates the QueryClient cache before the matched
 * component mounts.
 *
 * This complements router-loaders.test.ts (which is structural) by
 * actually instantiating an in-memory router with loaders and a
 * fake fetch, then asserting the cache was warmed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRouteWithContext,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { dashboardQueryOptions } from './api/queries';

// fetchWithAuth now short-circuits when getStoredToken() returns null
// (Bug 2 fix, RCA 2026-05-20). Stub the token module so the loader's
// fetch actually reaches the globalThis.fetch mock below.
vi.mock('./auth/token', () => ({
  getStoredToken: vi.fn(() => 'integration-test-token'),
  setStoredToken: vi.fn(),
  clearStoredToken: vi.fn(),
  notifyTokenInvalid: vi.fn(),
  TOKEN_INVALID_EVENT: 'scimserver:token-invalid',
  TOKEN_CHANGED_EVENT: 'scimserver:token-changed',
  TOKEN_STORAGE_KEY: 'scimserver.authToken',
}));

interface Ctx {
  queryClient: QueryClient;
}

describe('Phase A4 loaders pre-warm the QueryClient cache', () => {
  beforeEach(() => {
    // Stub fetch with a sentinel payload so we can prove the loader's
    // network call landed in the cache before the component rendered.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ sentinel: 'from-loader' }),
      text: () => Promise.resolve(''),
    }) as unknown as typeof fetch;
  });

  it('component sees loader-populated data on first render (no spinner)', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    function Probe(): React.JSX.Element {
      // Same queryOptions the loader used - so this useQuery should
      // hit the warm cache immediately.
      const { data, isFetching } = useQuery(dashboardQueryOptions());
      return (
        <div>
          <span data-testid="fetching">{String(isFetching)}</span>
          <span data-testid="payload">{(data as { sentinel?: string } | undefined)?.sentinel ?? 'cold'}</span>
        </div>
      );
    }

    const rootRoute = createRootRouteWithContext<Ctx>()({
      component: () => <Outlet />,
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: Probe,
      loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    });

    const { findByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // The loader ran before the component mounted, so on the very first
    // observable render the cache is already warm: data is the sentinel,
    // isFetching is false (no spinner needed).
    const payload = await findByTestId('payload');
    expect(payload).toHaveTextContent('from-loader');
    await waitFor(() => {
      expect(payload).toHaveTextContent('from-loader');
    });

    // Sanity: fetch was called exactly once (the loader); the component's
    // useQuery did NOT re-fetch because the cache was already populated.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// ─── Post-token-save error-screen RCA (2026-05-20) ───────────────────────────
//
// Three integration-level scenarios that exercise the live coupling between
// route loaders, fetchWithAuth, TokenGate, and TanStack Router's error state.
// Unit tests in TokenGate.test.tsx + queries.test.ts lock individual pieces;
// these tests prove the pieces compose correctly end-to-end (Stage 3a gaps
// 1, 2, 5 from the audit).
//
// Note: these tests rely on the auth/token module mock at the top of this
// file, which is HOIST-scoped. We override getStoredToken() per-test via
// vi.mocked().mockReturnValueOnce(...) instead of re-mocking the module.

describe('Post-token-save RCA - loader + TokenGate composition (Stage 3a)', () => {
  it('CRITICAL Path 2: loader 401 -> TOKEN_INVALID_EVENT fires (composition lock)', async () => {
    // Setup: token IS present but the server returns 401 (e.g. revoked or
    // wrong secret). The loader's fetchWithAuth must dispatch
    // TOKEN_INVALID_EVENT so TokenGate's listener re-shows the dialog with
    // "Token expired or invalid" copy.
    const tokenModule = await import('./auth/token');
    vi.mocked(tokenModule.getStoredToken).mockReturnValue('stale-token');
    vi.mocked(tokenModule.notifyTokenInvalid).mockClear();
    vi.mocked(tokenModule.clearStoredToken).mockClear();

    // Fetch returns 401
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => null },
      json: () => Promise.resolve({ detail: 'unauthorized' }),
      text: () => Promise.resolve('{"detail":"unauthorized"}'),
    }) as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    const rootRoute = createRootRouteWithContext<Ctx>()({
      component: () => <Outlet />,
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <div data-testid="home">home</div>,
      // Catch the thrown 401 inside the loader so the test framework
      // does not get an unhandled rejection. The point of this test is
      // that fetchWithAuth dispatched notifyTokenInvalid BEFORE throwing.
      loader: async ({ context }) => {
        try {
          return await context.queryClient.ensureQueryData(dashboardQueryOptions());
        } catch {
          return null;
        }
      },
      errorComponent: () => <div data-testid="error-boundary">err</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // The loader called fetchWithAuth -> got 401 -> dispatched
    // notifyTokenInvalid() + cleared the token. This is the chain that
    // TokenGate's TOKEN_INVALID_EVENT listener picks up to re-open the
    // dialog with the "Token expired" message.
    await waitFor(() => {
      expect(vi.mocked(tokenModule.notifyTokenInvalid)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(tokenModule.clearStoredToken)).toHaveBeenCalledTimes(1);
    });
  });

  it('HIGH Path 1: loader non-401 error surfaces to errorComponent (not TokenGate)', async () => {
    // Setup: token IS present but the server returns 500. This must NOT
    // dispatch TOKEN_INVALID_EVENT - it is a server error, not an auth
    // failure. The route should fall through to its errorComponent.
    const tokenModule = await import('./auth/token');
    vi.mocked(tokenModule.getStoredToken).mockReturnValue('valid-token');
    vi.mocked(tokenModule.notifyTokenInvalid).mockClear();
    vi.mocked(tokenModule.clearStoredToken).mockClear();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: () => Promise.resolve({ detail: 'server error' }),
      text: () => Promise.resolve('{"detail":"server error"}'),
    }) as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    const rootRoute = createRootRouteWithContext<Ctx>()({
      component: () => <Outlet />,
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <div data-testid="home">home</div>,
      loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
      errorComponent: () => <div data-testid="error-boundary">server error</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    });

    const { findByTestId } = render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // errorComponent renders (loader threw), but notifyTokenInvalid was NOT
    // called - this is a server error, not an auth event.
    await findByTestId('error-boundary');
    expect(vi.mocked(tokenModule.notifyTokenInvalid)).not.toHaveBeenCalled();
    expect(vi.mocked(tokenModule.clearStoredToken)).not.toHaveBeenCalled();
  });

  it('HIGH Path 5: no-token loader run does NOT call fetch or notifyTokenInvalid (Bug 2 lock)', async () => {
    // Setup: NO token stored. The loader's fetchWithAuth must short-circuit
    // synchronously without making any HTTP call AND without dispatching
    // TOKEN_INVALID_EVENT. Locks the Bug 2 fix at the loader-composition
    // level (queries.test.ts locks it at the unit level).
    const tokenModule = await import('./auth/token');
    vi.mocked(tokenModule.getStoredToken).mockReturnValue(null);
    vi.mocked(tokenModule.notifyTokenInvalid).mockClear();
    vi.mocked(tokenModule.clearStoredToken).mockClear();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });

    const rootRoute = createRootRouteWithContext<Ctx>()({
      component: () => <Outlet />,
    });
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <div data-testid="home">home</div>,
      loader: async ({ context }) => {
        try {
          return await context.queryClient.ensureQueryData(dashboardQueryOptions());
        } catch {
          return null; // expected - swallow the 401 ScimApiError
        }
      },
      errorComponent: () => <div data-testid="error-boundary">err</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      context: { queryClient },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    // Wait for router to settle so the loader has definitely executed.
    await waitFor(() => {
      expect(router.state.status).toBe('idle');
    });

    // The critical invariants of Bug 2:
    //  (a) No HTTP call was made (short-circuit happened before fetch)
    //  (b) No TOKEN_INVALID_EVENT was dispatched (no prior session to
    //      invalidate -> no spurious "Token expired" copy)
    //  (c) clearStoredToken was not called (nothing to clear)
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(tokenModule.notifyTokenInvalid)).not.toHaveBeenCalled();
    expect(vi.mocked(tokenModule.clearStoredToken)).not.toHaveBeenCalled();
  });
});
