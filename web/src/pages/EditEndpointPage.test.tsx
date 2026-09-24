/**
 * EditEndpointPage tests (Phase L1).
 *
 * Simple form for editing displayName + description + active. The
 * profile / preset is locked at creation; per-flag overrides happen
 * in the SettingsTab. Save fires useUpdateEndpointConfig.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EditEndpointPage } from './EditEndpointPage';

const mockNavigate = vi.fn();
const mockHistoryBack = vi.fn();
let mockCanGoBack = true;
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useCanGoBack: () => mockCanGoBack,
    useRouter: () => ({ history: { back: mockHistoryBack } }),
  };
});

const mockUseEndpoint = vi.fn();
const mockUpdateMutateAsync = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoint: (id: string) => mockUseEndpoint(id),
    useUpdateEndpointConfig: () => ({
      mutate: vi.fn(),
      mutateAsync: mockUpdateMutateAsync,
      isPending: false,
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

describe('EditEndpointPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanGoBack = true;
    mockUseEndpoint.mockReturnValue({
      data: {
        id: 'ep-1',
        name: 'prod-tenant',
        displayName: 'Production',
        description: 'Production tenant',
        active: true,
        scimBasePath: '/scim/endpoints/ep-1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
      },
      isLoading: false,
      error: null,
    });
    mockUpdateMutateAsync.mockResolvedValue(undefined);
  });

  it('renders the form pre-filled from useEndpoint', () => {
    renderWithProviders(<EditEndpointPage endpointId="ep-1" />);
    const display = screen.getByTestId('edit-endpoint-displayname-input') as HTMLInputElement;
    const desc = screen.getByTestId('edit-endpoint-description-input') as HTMLInputElement;
    expect(display.value).toBe('Production');
    expect(desc.value).toBe('Production tenant');
  });

  it('Save fires useUpdateEndpointConfig with the changed fields', async () => {
    renderWithProviders(<EditEndpointPage endpointId="ep-1" />);
    fireEvent.change(screen.getByTestId('edit-endpoint-displayname-input'), {
      target: { value: 'Production v2' },
    });
    fireEvent.click(screen.getByTestId('edit-endpoint-save-button'));
    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalled();
    });
    const body = mockUpdateMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(body.displayName).toBe('Production v2');
  });

  it('restores the previous context on save success', async () => {
    renderWithProviders(<EditEndpointPage endpointId="ep-1" />);
    fireEvent.change(screen.getByTestId('edit-endpoint-displayname-input'), {
      target: { value: 'New Name' },
    });
    fireEvent.click(screen.getByTestId('edit-endpoint-save-button'));
    await waitFor(() => {
      expect(mockHistoryBack).toHaveBeenCalledTimes(1);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('restores the previous context on cancel', () => {
    renderWithProviders(<EditEndpointPage endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('edit-endpoint-cancel-button'));

    expect(mockHistoryBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('falls back to endpoint overview when edit is opened as a direct deep link', () => {
    mockCanGoBack = false;
    renderWithProviders(<EditEndpointPage endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('edit-endpoint-cancel-button'));

    expect(mockHistoryBack).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/endpoints/$endpointId',
      params: { endpointId: 'ep-1' },
    });
  });
});
