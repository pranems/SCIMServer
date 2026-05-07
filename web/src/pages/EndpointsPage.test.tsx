/**
 * EndpointsPage tests.
 *
 * Phase A3: free-text filter `q` lives in the URL via
 * endpointsSearchSchema. Tests use renderWithRouter so useSearch and
 * useNavigate resolve.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EndpointsPage } from './EndpointsPage';
import { renderWithRouter } from '../test/router-test-utils';
import { endpointsSearchSchema } from '../routes/search-schemas';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: vi.fn(),
  };
});

import { useEndpoints } from '../api/queries';

function renderWithProviders(
  ui: React.ReactElement,
  initialUrl = '/endpoints',
) {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/endpoints',
    validateSearch: (raw) => endpointsSearchSchema.parse(raw),
  });
}

describe('EndpointsPage', () => {
  it('shows loading state', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    renderWithProviders(<EndpointsPage />);
    expect(await screen.findByTestId('endpoints-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Failed'),
    });
    renderWithProviders(<EndpointsPage />);
    expect(await screen.findByTestId('endpoints-error')).toBeInTheDocument();
  });

  it('renders endpoint cards', async () => {
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
    expect(await screen.findByTestId('endpoint-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-ep-2')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('filters endpoints by search input (URL-driven)', async () => {
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
    await screen.findByTestId('endpoint-ep-1');

    const searchInput = screen.getByPlaceholderText('Filter endpoints...');
    await user.type(searchInput, 'prod');

    await waitFor(() => {
      expect(screen.getByTestId('endpoint-ep-1')).toBeInTheDocument();
      expect(screen.queryByTestId('endpoint-ep-2')).not.toBeInTheDocument();
    });
  });

  it('reads q filter from URL search params', async () => {
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
    renderWithProviders(<EndpointsPage />, '/endpoints?q=dev');
    expect(await screen.findByTestId('endpoint-ep-2')).toBeInTheDocument();
    expect(screen.queryByTestId('endpoint-ep-1')).not.toBeInTheDocument();
  });
});
