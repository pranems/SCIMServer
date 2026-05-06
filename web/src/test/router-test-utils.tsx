/**
 * router-test-utils.tsx - test helpers for components that consume the
 * TanStack Router context.
 *
 * `renderWithRouter` mounts the given component inside a fresh in-memory
 * router built from the real production route tree. This means tests
 * stay realistic - the same route definitions, search-param schemas, and
 * loader behavior that production uses - while still providing test
 * isolation via createMemoryHistory.
 *
 * Each invocation creates its own QueryClient (no retries, no stale cache
 * between tests) and its own router instance so tests do not leak state
 * into each other.
 *
 * Typical usage:
 *
 *   import { renderWithRouter } from '@/test/router-test-utils';
 *
 *   it('reads endpointId from the URL', () => {
 *     const { getByTestId } = renderWithRouter(<UsersTab />, {
 *       initialUrl: '/endpoints/abc-123/users?page=2',
 *     });
 *     // ...assert on what the component renders given that URL...
 *   });
 *
 * The helper exists because creating the router in every test is verbose
 * and easy to get subtly wrong (default options, history flavor, query
 * client config). Centralizing it keeps tests focused on behavior.
 */
import React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

export interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL the in-memory router opens at. Defaults to `/`. */
  initialUrl?: string;
  /**
   * Route path pattern used to mount the supplied UI. Defaults to a
   * catch-all (`/$`). Override this when the test needs typed route
   * params (e.g. pass `/endpoints/$endpointId/users` so `useParams`
   * exposes `endpointId`).
   */
  routePath?: string;
  /**
   * Optional zod-style search-param validator passed straight through to
   * `createRoute({ validateSearch })`. Required when the rendered
   * component calls `useSearch({ from: routePath })` and expects parsed
   * search params (Phase A3 per-page migration). The function receives
   * the raw URL search params object and should return the validated /
   * coerced shape; in production code this is typically the `.parse`
   * method of one of the schemas in `web/src/routes/search-schemas.ts`.
   */
  validateSearch?: (input: Record<string, unknown>) => unknown;
}

/**
 * Render `ui` inside a fresh QueryClient + in-memory TanStack Router so
 * that hooks like `useParams`, `useSearch`, and `<Link>` work. The router
 * is built from a single route whose `path` defaults to a catch-all so
 * any `initialUrl` resolves; pass `routePath` when the test needs route
 * params parsed under specific names.
 *
 * Each invocation creates its own QueryClient and router instance so
 * tests do not leak state.
 */
export function renderWithRouter(
  ui: React.ReactElement,
  {
    initialUrl = '/',
    routePath = '/$',
    validateSearch,
    ...renderOptions
  }: RenderWithRouterOptions = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });

  const uiRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: routePath,
    component: () => <>{ui}</>,
    // Only set validateSearch when supplied - createRoute treats the
    // property as `undefined` vs missing differently and we want the
    // default route to behave exactly as before when no schema is given.
    ...(validateSearch ? { validateSearch } : {}),
  });

  // Always include an exact "/" so initialUrl="/" resolves even when the
  // caller-supplied routePath is something like '/endpoints/$id'.
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{ui}</>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, uiRoute]),
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
    renderOptions,
  );
}
