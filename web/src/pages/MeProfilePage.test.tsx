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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { MeProfilePage } from './MeProfilePage';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseEndpoints = vi.fn();
const mockUseMe = vi.fn();
const mockPatchMutateAsync = vi.fn();
const mockDeleteMutateAsync = vi.fn();
let patchPending = false;
let deletePending = false;

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

describe('MeProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('renders the endpoint picker with one option per endpoint from useEndpoints', () => {
    renderWithProviders(<MeProfilePage />);
    expect(screen.getByTestId('me-endpoint-picker')).toBeInTheDocument();
    expect(screen.getByTestId('me-endpoint-option-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('me-endpoint-option-ep-2')).toBeInTheDocument();
  });

  it('does not call useMe with a real endpoint until the operator picks one', () => {
    renderWithProviders(<MeProfilePage />);
    // Hook is called with empty string until pick (disabled inside the hook).
    expect(mockUseMe).toHaveBeenCalledWith('');
    expect(screen.getByTestId('me-empty')).toBeInTheDocument();
  });

  it('renders the user profile when useMe returns data', () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    fireEvent.click(screen.getByTestId('me-endpoint-option-ep-1'));
    expect(screen.getByTestId('me-profile-card')).toBeInTheDocument();
    expect(screen.getByTestId('me-username')).toHaveTextContent('admin@example.com');
    expect(screen.getByTestId('me-displayname-input')).toBeInTheDocument();
  });

  it('renders the OAuth-required fallback on 404 noTarget error', async () => {
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
    fireEvent.click(screen.getByTestId('me-endpoint-option-ep-1'));
    // ScimErrorMessage primitive renders with default testid.
    expect(screen.getByTestId('scim-error-message')).toBeInTheDocument();
    // Page-level hint pointing at the auth model.
    expect(screen.getByTestId('me-oauth-required-hint')).toBeInTheDocument();
  });

  it('Save fires usePatchMe with a SCIM PatchOp envelope when displayName changes', async () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    fireEvent.click(screen.getByTestId('me-endpoint-option-ep-1'));

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

  it('Delete button opens confirm modal; Delete is disabled until userName matches', () => {
    mockUseMe.mockReturnValue({
      data: sampleMe,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<MeProfilePage />);
    fireEvent.click(screen.getByTestId('me-endpoint-option-ep-1'));
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
    fireEvent.click(screen.getByTestId('me-endpoint-option-ep-1'));
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
