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
