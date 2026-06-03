/**
 * MSW integration tests - Phase H1.
 *
 * Validates that the network-level mock server correctly serves every
 * admin BFF surface and that errors propagate through fetchWithAuth +
 * useQuery in the same way they would against the real backend.
 *
 * These tests intentionally do NOT mock `../api/queries` - the whole
 * point is to exercise the real hook + fetch pipeline against the
 * MSW-served fixtures. Existing page-level tests still mock the hooks
 * directly (faster, more focused); the MSW path is reserved for
 * integration / contract tests where the network layer is the subject.
 *
 * @see web/src/test/msw/server.ts
 * @see docs/PHASE_H1_MSW_HANDLERS.md
 */
import React from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { server } from './msw/server';
import { errorHandlers } from './msw/error-handlers';
import {
  FIXTURE_DASHBOARD,
  FIXTURE_ENDPOINT_ID,
  FIXTURE_ENDPOINT_LIST,
  FIXTURE_ENDPOINT_OVERVIEW,
  FIXTURE_VERSION,
  FIXTURE_LOGS,
} from './msw/fixtures';

import {
  useDashboard,
  useEndpoints,
  useEndpointOverview,
  useVersion,
  useGlobalLogs,
} from '../api/queries';
import { setStoredToken } from '../auth/token';

// Per Phase H1 setup.ts opt-in pattern, every MSW-driven file installs
// its own lifecycle. `onUnhandledRequest: 'error'` is intentional here
// so a missing handler in this integration suite causes a hard fail
// (we want full coverage of the documented BFF surface).
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Helper: render a query hook inside a fresh QueryClient so each test
// is fully isolated from cache leakage. retry:false makes failed
// requests surface immediately instead of triggering the default 3x
// retry that would slow down every error-path assertion.
function renderHookWithQuery<T>(hook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  // Ensure a token is present so the auth wrapper does not short-circuit.
  // The MSW handlers do not validate the bearer, but `fetchWithAuth`
  // cleared the token if a 401 happens in a sibling test.
  setStoredToken('msw-test-bearer');
});

describe('MSW integration - happy path through fetchWithAuth + useQuery', () => {
  it('useDashboard resolves the FIXTURE_DASHBOARD shape', async () => {
    const { result } = renderHookWithQuery(() => useDashboard());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_DASHBOARD);
    expect(result.current.error).toBeNull();
  });

  it('useEndpoints resolves the envelope with one fixture endpoint', async () => {
    const { result } = renderHookWithQuery(() => useEndpoints());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalResults).toBe(FIXTURE_ENDPOINT_LIST.totalResults);
    expect(result.current.data?.endpoints[0]?.id).toBe(FIXTURE_ENDPOINT_ID);
  });

  it('useEndpointOverview resolves the BFF aggregate', async () => {
    const { result } = renderHookWithQuery(() =>
      useEndpointOverview(FIXTURE_ENDPOINT_ID),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(FIXTURE_ENDPOINT_OVERVIEW);
  });

  it('useVersion resolves the version + runtime envelope', async () => {
    const { result } = renderHookWithQuery(() => useVersion());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.version).toBe(FIXTURE_VERSION.version);
    expect(result.current.data?.storage.persistenceBackend).toBe('inmemory');
  });

  it('useGlobalLogs resolves the logs envelope with one fixture row', async () => {
    const { result } = renderHookWithQuery(() => useGlobalLogs({ page: 1, pageSize: 20 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(FIXTURE_LOGS.total);
    expect(result.current.data?.items[0]?.id).toBe('log-1');
  });
});

describe('MSW integration - error handler overrides', () => {
  it('useDashboard surfaces an error when the server returns 500', async () => {
    // Override the default handler with the 500 variant for this test
    // only. resetHandlers() in afterEach (setup.ts) wipes it after.
    server.use(errorHandlers.dashboard500());
    const { result } = renderHookWithQuery(() => useDashboard());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('useEndpoints surfaces an auth error when the server returns 401', async () => {
    server.use(errorHandlers.endpoints401());
    const { result } = renderHookWithQuery(() => useEndpoints());
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The fetchWithAuth wrapper rethrows 401 with a known message; the
    // error path also clears the stored token via clearStoredToken().
    expect((result.current.error as Error).message).toMatch(/Authentication required/);
  });

  it('useEndpointOverview surfaces a 404 when the endpoint id is unknown', async () => {
    server.use(errorHandlers.endpointOverview404());
    const { result } = renderHookWithQuery(() =>
      useEndpointOverview('does-not-exist'),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
