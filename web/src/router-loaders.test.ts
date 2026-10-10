/**
 * router-loaders.test.ts - asserts that every production route in
 * web/src/router.ts has a `loader` wired up to its matching
 * queryOptions helper without blocking route rendering.
 *
 * Phase A4 added per-route loaders so navigation feels instant: hovering
 * a `<Link>` triggers the loader (via `defaultPreload: 'intent'`) which
 * starts warming the TanStack Query cache via `prefetchQuery`. A warm
 * response is reused, while a slow response leaves the application shell
 * and the page-owned loading state visible.
 *
 * The tests lock both structural loader presence and the nonblocking source
 * contract. Integration and Playwright tests cover runtime behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { router, routeTree } from './router';
import { dashboardLoader } from './routes/index';

interface RouteShape {
  id?: string;
  fullPath?: string;
  options?: { loader?: unknown };
  children?: RouteShape[];
}

function flattenRoutes(node: RouteShape, acc: RouteShape[] = []): RouteShape[] {
  acc.push(node);
  for (const child of node.children ?? []) {
    flattenRoutes(child, acc);
  }
  return acc;
}

describe('router loaders (Phase A4)', () => {
  const routeSources = import.meta.glob('./routes/*.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  });
  const allRoutes = flattenRoutes(routeTree as unknown as RouteShape);
  const routesNeedingLoaders = [
    { fullPath: '/endpoints', label: '/endpoints' },
    { fullPath: '/endpoints/$endpointId', label: '/endpoints/$endpointId' },
    { fullPath: '/endpoints/$endpointId/', label: '/endpoints/$endpointId (overview index)' },
    { fullPath: '/endpoints/$endpointId/users', label: '/endpoints/$endpointId/users' },
    { fullPath: '/endpoints/$endpointId/groups', label: '/endpoints/$endpointId/groups' },
    { fullPath: '/endpoints/$endpointId/logs', label: '/endpoints/$endpointId/logs' },
    { fullPath: '/endpoints/$endpointId/settings', label: '/endpoints/$endpointId/settings' },
    { fullPath: '/logs', label: '/logs' },
    { fullPath: '/settings', label: '/settings' },
  ] as const;

  it.each(routesNeedingLoaders)(
    'route $label has a loader function wired to its queryOptions',
    ({ fullPath }) => {
      const match = allRoutes.find((r) => r.fullPath === fullPath);
      expect(match, `route ${fullPath} should be present in routeTree`).toBeDefined();
      expect(typeof match?.options?.loader).toBe('function');
    },
  );

  it('dashboard index route (/) has a loader (matched separately - both root + index share fullPath="/")', () => {
    // The root layout route and the dashboard index route both report
    // fullPath="/" because the index lives directly under root. Match
    // by id="/" to find the index specifically (root id is "__root__").
    const indexMatch = allRoutes.find((r) => r.id === '/');
    expect(indexMatch, 'dashboard index route should be present').toBeDefined();
    expect(typeof indexMatch?.options?.loader).toBe('function');
  });

  it('dashboard loader starts prefetch without blocking the application shell', () => {
    const neverSettles = new Promise<never>(() => {});
    const prefetchQuery = vi.fn().mockReturnValue(neverSettles);

    const result = dashboardLoader({
      context: {
        queryClient: { prefetchQuery },
      },
    });

    expect(result).toBeUndefined();
    expect(prefetchQuery).toHaveBeenCalledTimes(1);
  });

  it('keeps every route loader nonblocking so slow data cannot hide the shell', () => {
    const blockingRoutes = Object.entries(routeSources)
      .filter(([, source]) => String(source).includes('ensureQueryData'))
      .map(([path]) => path);

    expect(blockingRoutes).toEqual([]);
  });

  it('router context exposes a queryClient so loaders can ensureQueryData', () => {
    // The router was constructed with `context: { queryClient }`. Loaders
    // receive that context as `{ context }`. Without it the
    // `context.queryClient.ensureQueryData(...)` calls in route files
    // would crash at first navigation. Inspecting the router options
    // directly is the cheapest way to lock this in.
    const ctx = (router.options as { context?: { queryClient?: unknown } }).context;
    expect(ctx).toBeDefined();
    expect(ctx?.queryClient).toBeDefined();
  });

  it('preserves Phase A1 router defaults (preload + staleTime)', () => {
    // Phase A4 must not regress the prefetch-on-intent behavior - it's
    // what makes loaders feel like magic in the browser.
    expect(router.options.defaultPreload).toBe('intent');
    expect(router.options.defaultPreloadStaleTime).toBe(30_000);
  });
});
