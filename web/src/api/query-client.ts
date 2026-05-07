/**
 * query-client.ts - module-level singleton TanStack QueryClient.
 *
 * Phase A4 introduces this module so that:
 *   - The TanStack Router instance (web/src/router.ts) can pass the
 *     same QueryClient into route `context`, letting per-route
 *     `loader` functions call `context.queryClient.ensureQueryData`
 *     to pre-fetch data before the matched component renders.
 *   - The AppShell (web/src/layout/AppShell.tsx) wraps the tree with
 *     `<QueryClientProvider client={queryClient}>` using the *same*
 *     instance, so cache writes from loaders are immediately visible
 *     to hooks.
 *   - Tests can either import this singleton (production-ish behavior)
 *     or replace it with a fresh QueryClient via renderWithRouter for
 *     isolation.
 *
 * Defaults mirror the previous in-component config so behavior is
 * unchanged: 30s stale time, 1 retry, no refetch-on-focus.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A4
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D2 (TanStack Query)
 */
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
