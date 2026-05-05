/**
 * EndpointsPage tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EndpointsPage } from './EndpointsPage';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: vi.fn(),
  };
});

import { useEndpoints } from '../api/queries';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>
        {ui}
      </FluentProvider>
    </QueryClientProvider>,
  );
}

describe('EndpointsPage', () => {
  it('shows loading state', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    renderWithProviders(<EndpointsPage />);
    expect(screen.getByTestId('endpoints-loading')).toBeInTheDocument();
  });

  it('shows error state', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Failed'),
    });
    renderWithProviders(<EndpointsPage />);
    expect(screen.getByTestId('endpoints-error')).toBeInTheDocument();
  });

  it('renders endpoint cards', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        totalResults: 2,
        endpoints: [
          { id: 'ep-1', name: 'prod', displayName: 'Production', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: {} },
          { id: 'ep-2', name: 'dev', active: false, scimBasePath: '', createdAt: '', updatedAt: '', _links: {} },
        ],
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<EndpointsPage />);
    expect(screen.getByTestId('endpoint-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-ep-2')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('filters endpoints by search', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        totalResults: 2,
        endpoints: [
          { id: 'ep-1', name: 'prod', displayName: 'Production', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: {} },
          { id: 'ep-2', name: 'dev', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: {} },
        ],
      },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<EndpointsPage />);

    const searchInput = screen.getByPlaceholderText('Filter endpoints...');
    await user.type(searchInput, 'prod');

    expect(screen.getByTestId('endpoint-ep-1')).toBeInTheDocument();
    expect(screen.queryByTestId('endpoint-ep-2')).not.toBeInTheDocument();
  });
});
