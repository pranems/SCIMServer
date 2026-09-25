/**
 * MeProfilePage tests (Phase L2).
 *
 * Asserts:
 *   1. Endpoint picker renders + drives the useMe(endpointId) call
 *   2. No endpoint picked -> empty state, no fetch
 *   3. Happy path (200): renders userName / displayName / id from MeResource
 *   4. 404 noTarget -> ScimErrorMessage + "OAuth required" hint + link to home
 *   5. PATCH form: Save fires usePatchMe with the assembled SCIM PatchOp body
 *   6. DELETE button opens confirm-by-typing dialog; Delete enables only on exact userName
 *   7. DELETE confirm fires useDeleteMe(endpointId)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MeProfilePage } from './MeProfilePage';
import { setStoredToken } from '../auth/token';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseEndpoints = vi.fn();
const mockUseMe = vi.fn();
const mockPatchMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();
const routerMock = vi.hoisted(() => ({
  initialSearch: {} as Record<string, unknown>,
  setSearch: undefined as React.Dispatch<React.SetStateAction<Record<string, unknown>>> | undefined,
  navigate: vi.fn(),
}));
let patchPending = false;
let deletePending = false;

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useSearch: () => {
      const [search, setSearch] = react.useState(routerMock.initialSearch);
      routerMock.setSearch = setSearch;
      return search;
    },
    useNavigate: () => (options: {
      search?: Record<string, unknown> | ((previous: Record<string, unknown>) => Record<string, unknown>);
    }) => {
      routerMock.navigate(options);
      if (!options.search) return;
      routerMock.setSearch?.((previous) =>
        typeof options.search === 'function' ? options.search(previous) : options.search ?? previous,
      );
    },
  };
});

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: () => mockUseEndpoints(),
    useMe: (id: string) => mockUseMe(id),
    usePatchMe: () => ({
      mutate: vi.fn(),
      mutateAsync: mockPatchMutateAsync,
      isPending: patchPending,
    }),
    useDeleteMe: () => ({
      mutate: vi.fn(),
      mutateAsync: mockDeleteMutateAsync,
      isPending: deletePending,
    }),
  };
});

const sampleEndpoints = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-1', name: 'prod', displayName: 'Production', active: true },
    { id: 'ep-2', name: 'staging', displayName: 'Staging', active: true },
  ],
};

const sampleMe = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  id: 'me-uuid-1',
  userName: 'admin@example.com',
  displayName: 'Site Admin',
  active: true,
  meta: { resourceType: 'User', version: 'W/"v4"' },
};

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

async function selectEndpoint(name: string | RegExp = /Production/i): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Profile endpoint' }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('MeProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMock.initialSearch = {};
    patchPending = false;
    deletePending = false;
    mockUseEndpoints.mockReturnValue({
      data: sampleEndpoints,
      isLoading: false,
      error: null,
    });
    mockUseMe.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    });
    mockPatchMutateAsync.mockResolvedValue({});
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    setStoredToken(makeJwt({ sub: 'admin@example.com' }));
  });

  it('explains that My Profile is OAuth self-service for the token subject', () => {
    renderWithProviders(<MeProfilePage />);
    expect(screen.getByText(/self-service view of the SCIM User identified by this OAuth token/i)).toBeInTheDocument();
  });

  it('does not call /Me for a shared-secret session and directs the operator to OAuth setup', async () => {
    setStoredToken('shared-admin-secret');
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();

    expect(mockUseMe).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('me-oauth-preflight')).toBeInTheDocument();
    expect(screen.queryByTestId('scim-error-message')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open OAuth setup/i })).toBeInTheDocument();
  });

  it('renders the endpoint picker with one option per endpoint from useEndpoints', async () => {
    renderWithProviders(<MeProfilePage />);
    expect(screen.getByTestId('me-endpoint-picker')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Profile endpoint' }));
    expect(await screen.findByRole('option', { name: /Production/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Staging/i })).toBeInTheDocument();
  });

  it('does not call useMe with a real endpoint until the operator picks one', () => {
    renderWithProviders(<MeProfilePage />);
    // Hook is called with empty string until pick (disabled inside the hook).
    expect(mockUseMe).toHaveBeenCalledWith('');
    expect(screen.getByTestId('me-empty')).toBeInTheDocument();
  });

  it('does not call /Me for a stale endpoint id from a copied URL', () => {
    routerMock.initialSearch = { endpointId: 'deleted-endpoint' };
    renderWithProviders(<MeProfilePage />);
    expect(mockUseMe).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('me-stale-endpoint')).toBeInTheDocument();
  });

  it('renders the user profile when useMe returns data', async () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();
    expect(screen.getByTestId('me-profile-card')).toBeInTheDocument();
    expect(screen.getByTestId('me-username')).toHaveTextContent('admin@example.com');
    expect(screen.getByTestId('me-displayname-input')).toBeInTheDocument();
  });

  it('renders the subject-not-found fallback on 404 noTarget error', async () => {
    const { ScimApiError } = await import('../api/scim-error');
    const noTargetError = new ScimApiError({
      status: 404,
      scimType: 'noTarget',
      detail: 'The /Me endpoint requires OAuth authentication with a JWT token whose "sub" claim matches a SCIM User\'s userName.',
    });
    mockUseMe.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: noTargetError,
    });
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();
    expect(screen.getByTestId('me-subject-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('scim-error-message')).not.toBeInTheDocument();
  });

  it('Save fires usePatchMe with a SCIM PatchOp envelope when displayName changes', async () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();

    fireEvent.change(screen.getByTestId('me-displayname-input'), {
      target: { value: 'Site Admin Renamed' },
    });
    fireEvent.click(screen.getByTestId('me-save-button'));

    await waitFor(() => {
      expect(mockPatchMutateAsync).toHaveBeenCalled();
    });
    const body = mockPatchMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:PatchOp']);
    const ops = body.Operations as Array<Record<string, unknown>>;
    expect(ops.some((op) => op.path === 'displayName' && op.value === 'Site Admin Renamed')).toBe(true);
  });

  it('Delete button opens confirm modal; Delete is disabled until userName matches', async () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();
    fireEvent.click(screen.getByTestId('me-delete-button'));

    const input = screen.getByTestId('me-delete-confirm-input') as HTMLInputElement;
    const confirmBtn = screen.getByRole('button', { name: /^Delete \/Me$/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'wrong' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'admin@example.com' } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('Delete confirm fires useDeleteMe', async () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    await selectEndpoint();
    fireEvent.click(screen.getByTestId('me-delete-button'));

    fireEvent.change(screen.getByTestId('me-delete-confirm-input'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Delete \/Me$/i }));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalled();
    });
  });
});
