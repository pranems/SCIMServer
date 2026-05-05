/**
 * SettingsTab tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SettingsTab } from './SettingsTab';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpoint: vi.fn() };
});

import { useEndpoint } from '../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<SettingsTab endpointId="ep-1" />);
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
  });

  it('renders endpoint name and SCIM path', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        id: 'ep-1', name: 'prod', active: true,
        scimBasePath: '/scim/endpoints/ep-1/v2',
        profileSummary: { activeSettings: { StrictSchemaValidation: true } },
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
        _links: {},
      },
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId="ep-1" />);
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText(/\/scim\/endpoints\/ep-1\/v2/)).toBeInTheDocument();
    expect(screen.getByText('StrictSchemaValidation')).toBeInTheDocument();
  });
});
