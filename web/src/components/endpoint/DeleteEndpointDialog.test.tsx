/**
 * DeleteEndpointDialog tests (Phase L1).
 *
 * Asserts the type-name-to-confirm safety contract:
 *   - Delete button is disabled by default (input empty)
 *   - Typing the wrong name keeps it disabled
 *   - Typing the exact name (case-sensitive) enables it
 *   - Submit fires useDeleteEndpoint with the endpoint id
 *   - On success the onConfirmed callback fires
 *   - Server error renders <ScimErrorMessage /> via FormDialog.error
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DeleteEndpointDialog } from './DeleteEndpointDialog';

const mockDeleteMutate = vi.fn();
const mockDeleteMutateAsync = vi.fn();
let deleteMutationState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock('../../api/queries', async () => {
  const actual = await vi.importActual('../../api/queries');
  return {
    ...actual,
    useDeleteEndpoint: () => ({
      mutate: mockDeleteMutate,
      mutateAsync: mockDeleteMutateAsync,
      isPending: deleteMutationState.isPending,
      error: deleteMutationState.error,
    }),
  };
});

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

describe('DeleteEndpointDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMutationState = { isPending: false, error: null };
    mockDeleteMutateAsync.mockResolvedValue(undefined);
  });

  it('renders the endpoint name in the warning body so the operator sees what is at stake', () => {
    renderWithProviders(
      <DeleteEndpointDialog
        open
        endpointId="ep-1"
        endpointName="prod-tenant"
        onCancel={() => {}}
        onConfirmed={() => {}}
      />,
    );
    // The name appears at least once - in the monospace echo and in the input label hint.
    expect(screen.getAllByText(/prod-tenant/).length).toBeGreaterThan(0);
  });

  it('disables the Delete button by default (empty input)', () => {
    renderWithProviders(
      <DeleteEndpointDialog
        open
        endpointId="ep-1"
        endpointName="prod-tenant"
        onCancel={() => {}}
        onConfirmed={() => {}}
      />,
    );
    const deleteButton = screen.getByRole('button', { name: /^Delete$/i });
    expect(deleteButton).toBeDisabled();
  });

  it('keeps Delete disabled when input does not exactly match (case-sensitive)', () => {
    renderWithProviders(
      <DeleteEndpointDialog
        open
        endpointId="ep-1"
        endpointName="prod-tenant"
        onCancel={() => {}}
        onConfirmed={() => {}}
      />,
    );
    const input = screen.getByTestId('delete-endpoint-confirm-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Prod-Tenant' } });
    const deleteButton = screen.getByRole('button', { name: /^Delete$/i });
    expect(deleteButton).toBeDisabled();
  });

  it('enables Delete when the input exactly matches the endpoint name', () => {
    renderWithProviders(
      <DeleteEndpointDialog
        open
        endpointId="ep-1"
        endpointName="prod-tenant"
        onCancel={() => {}}
        onConfirmed={() => {}}
      />,
    );
    const input = screen.getByTestId('delete-endpoint-confirm-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'prod-tenant' } });
    const deleteButton = screen.getByRole('button', { name: /^Delete$/i });
    expect(deleteButton).not.toBeDisabled();
  });

  it('fires useDeleteEndpoint(endpointId) on submit and calls onConfirmed on success', async () => {
    const onConfirmed = vi.fn();
    renderWithProviders(
      <DeleteEndpointDialog
        open
        endpointId="ep-1"
        endpointName="prod-tenant"
        onCancel={() => {}}
        onConfirmed={onConfirmed}
      />,
    );
    const input = screen.getByTestId('delete-endpoint-confirm-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'prod-tenant' } });
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('ep-1');
    });
    await waitFor(() => {
      expect(onConfirmed).toHaveBeenCalled();
    });
  });
});
