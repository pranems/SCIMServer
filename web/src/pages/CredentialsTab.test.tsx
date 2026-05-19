/**
 * CredentialsTab tests (Phase E1).
 *
 * Asserts the spec contract per UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.1:
 *   - Loads from useEndpointOverview (Phase B BFF, no extra round trip)
 *   - Skeleton on loading; EmptyState when zero credentials
 *   - Add credential button opens FormDialog
 *   - On create success: shows plaintext token EXACTLY ONCE with copy button
 *   - Delete row -> confirm dialog -> useDeleteCredential
 *   - 403 (PerEndpointCredentialsEnabled=False) -> warning banner +
 *     disabled create button
 *   - Mutation error -> errorMessage in dialog (no silent failure)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CredentialsTab } from './CredentialsTab';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

const mockUseEndpointOverview = vi.fn();
const mockCreateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
let createMutationState = { isPending: false };
let deleteMutationState = { isPending: false };

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: (...args: unknown[]) => mockUseEndpointOverview(...args),
    useCreateCredential: () => ({
      mutate: mockCreateMutate,
      isPending: createMutationState.isPending,
    }),
    useDeleteCredential: () => ({
      mutate: mockDeleteMutate,
      isPending: deleteMutationState.isPending,
    }),
  };
});

const baseOverview: EndpointOverviewResponse = {
  endpoint: {
    id: 'ep-1',
    name: 'prod',
    displayName: 'Production',
    preset: 'entra-id',
    active: true,
    scimBasePath: '/scim/endpoints/ep-1/v2',
    createdAt: '2026-01-01T00:00:00Z',
  },
  stats: {
    userCount: 0,
    activeUserCount: 0,
    groupCount: 0,
    activeGroupCount: 0,
    genericResourceCount: 0,
  },
  credentials: [],
  recentActivity: [],
  configFlags: { PerEndpointCredentialsEnabled: true },
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('CredentialsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMutationState = { isPending: false };
    deleteMutationState = { isPending: false };
  });

  // ─── Loading / error / empty states ────────────────────────────────

  it('shows LoadingSkeleton on isLoading', () => {
    mockUseEndpointOverview.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-skeleton')).toBeInTheDocument();
  });

  it('shows error block on error', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-error')).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('shows EmptyState when flag enabled but no credentials exist', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-empty')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-empty-title')).toHaveTextContent(
      /No credentials configured/i,
    );
  });

  // ─── Flag-disabled banner ──────────────────────────────────────────

  it('shows warning banner and disables Add button when flag is off', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { PerEndpointCredentialsEnabled: false } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-flag-disabled-banner')).toBeInTheDocument();
    const addBtn = screen.getByTestId('credentials-create-button');
    expect(addBtn).toBeDisabled();
  });

  it('shows warning banner when flag is missing entirely (treated as off)', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: {} },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-flag-disabled-banner')).toBeInTheDocument();
  });

  // ─── List rendering ────────────────────────────────────────────────

  it('renders one card per credential', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-1',
          credentialType: 'bearer',
          label: 'Entra production',
          active: true,
          createdAt: '2026-04-01T10:00:00Z',
          expiresAt: null,
        },
        {
          id: 'cred-2',
          credentialType: 'bearer',
          label: null,
          active: false,
          createdAt: '2026-03-15T09:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    expect(screen.getByTestId('credentials-list')).toBeInTheDocument();
    expect(screen.getByTestId('credential-row-cred-1')).toBeInTheDocument();
    expect(screen.getByTestId('credential-row-cred-2')).toBeInTheDocument();
    // Active vs Revoked badges
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    // Headline shows the count
    expect(screen.getByText(/Credentials \(2\)/)).toBeInTheDocument();
  });

  // ─── Create flow ───────────────────────────────────────────────────

  it('opens create dialog when Add button clicked', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    expect(screen.getByTestId('credentials-create-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-label-input')).toBeInTheDocument();
  });

  it('passes label to mutation on Create submit', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    // Fluent UI's Input renders the actual <input> as the testid
    // element OR a child of it depending on version. Cover both.
    const inputContainer = screen.getByTestId('credentials-label-input');
    const input = inputContainer.tagName === 'INPUT'
      ? inputContainer
      : inputContainer.querySelector('input') ?? inputContainer;
    fireEvent.change(input, { target: { value: 'My new cred' } });

    // Submit by clicking the form's Create button (FormDialog Submit
    // is the primary button in the dialog footer).
    const dialog = screen.getByTestId('credentials-create-dialog');
    const submit = dialog.querySelector('button[type="submit"]');
    expect(submit).toBeTruthy();
    fireEvent.click(submit!);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate.mock.calls[0][0]).toMatchObject({ label: 'My new cred' });
  });

  it('passes undefined label when input is empty (no whitespace string)', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    const submit = dialog.querySelector('button[type="submit"]');
    fireEvent.click(submit!);

    expect(mockCreateMutate.mock.calls[0][0]).toEqual({ label: undefined });
  });

  it('shows plaintext token + copy button after successful create', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    // mutate(args, opts) - we simulate the onSuccess callback firing
    // synchronously with the server's plaintext token response.
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onSuccess?.({
        id: 'new-cred-id',
        label: 'Entra prod',
        token: 'super-secret-bearer-token-123',
        createdAt: '2026-05-08T12:00:00Z',
      });
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(screen.getByTestId('credentials-plaintext')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-token-value')).toHaveTextContent(
      'super-secret-bearer-token-123',
    );
    expect(screen.getByTestId('credentials-copy-button')).toBeInTheDocument();
  });

  it('surfaces mutation error in the dialog (no silent failure)', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onError?.(new Error('403 Forbidden - flag disabled on server'));
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(screen.getByText(/403 Forbidden/)).toBeInTheDocument();
  });

  // ─── Delete flow ───────────────────────────────────────────────────

  it('opens delete confirmation when delete icon clicked', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-x',
          credentialType: 'bearer',
          label: 'Doomed',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credential-delete-cred-x'));
    expect(screen.getByTestId('credentials-delete-dialog')).toBeInTheDocument();
    // Title text is broken across nodes ("Revoke credential" + label)
    // - assert via the dialog's textContent for resilience.
    const dialog = screen.getByTestId('credentials-delete-dialog');
    expect(dialog.textContent).toContain('Doomed');
  });

  it('calls useDeleteCredential mutate on Revoke confirm', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-x',
          credentialType: 'bearer',
          label: 'Doomed',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credential-delete-cred-x'));
    const dialog = screen.getByTestId('credentials-delete-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteMutate.mock.calls[0][0]).toBe('cred-x');
  });
});
